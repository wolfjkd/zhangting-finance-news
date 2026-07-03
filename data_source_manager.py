"""
数据源管理器
集成多个财经数据源，轮询获取公告/研报/北向资金等数据
所有国内 API 直连，不走代理
"""

import json
import time
import hashlib
import threading
import requests
import logging
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger('ztfi')

# ===== 直连 Session（不走系统代理）=====
_session = requests.Session()
_session.trust_env = False  # 不读 HTTP_PROXY/HTTPS_PROXY 环境变量
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://data.eastmoney.com/',
})

# ===== 通用 HTTP 请求封装 =====
def _get_json(url, params=None, timeout=10):
    """直连 GET 请求，返回 JSON 或 None"""
    try:
        resp = _session.get(url, params=params, timeout=timeout)
        resp.encoding = 'utf-8'
        if resp.status_code == 200:
            return resp.json()
        logger.warning("HTTP %s from %s", resp.status_code, url)
    except Exception as e:
        logger.error("请求失败 %s: %s", url, e)
    return None


def _make_aid(source_id: str, unique_key: str) -> str:
    """生成唯一 aid，避免与其他数据源的 aid 冲突"""
    h = hashlib.md5(f"{source_id}:{unique_key}".encode()).hexdigest()[:12]
    return f"{source_id}_{h}"


class DataSourceType(Enum):
    WEBSOCKET = "websocket"
    API = "api"
    CONNECTOR = "connector"


@dataclass
class DataSourceConfig:
    id: str
    name: str
    type: DataSourceType
    enabled: bool
    priority: int
    description: str
    endpoints: Dict[str, str] = None
    connector: str = None
    poll_interval: int = 300


class DataSourceManager:
    """数据源管理器 — 轮询多个 API，发现新消息后回调推送"""

    def __init__(self):
        self.sources: Dict[str, DataSourceConfig] = {}
        self.source_status: Dict[str, Dict] = {}
        self.running = False
        self.poll_threads: Dict[str, threading.Thread] = {}

        # 消息回调 — 由 app.py 的 Api 类设置
        self._message_callback: Optional[Callable[[Dict], None]] = None

        # 各数据源的已推送 ID 集合（去重）
        self._seen_ids: Dict[str, set] = {}

        # 北向资金上次推送值（变化超阈值才推）
        self._northbound_last_net: Optional[float] = None

        self._init_default_sources()

    # ===== 回调 =====
    def set_message_callback(self, callback: Callable[[Dict], None]):
        """设置消息推送回调（app.py 调用，把消息推到前端）"""
        self._message_callback = callback

    def _dispatch_message(self, message: Dict):
        """分发消息到前端"""
        if self._message_callback:
            try:
                self._message_callback(message)
            except Exception as e:
                logger.error("推送消息失败: %s", e)
        else:
            logger.debug("无回调，消息丢弃: %s", message.get('title', ''))

    # ===== 默认数据源 =====
    def _init_default_sources(self):
        default_sources = [
            DataSourceConfig(
                id="ztfi", name="实时聚合", type=DataSourceType.WEBSOCKET,
                enabled=True, priority=1, description="实时聚合消息"
            ),
            DataSourceConfig(
                id="eastmoney", name="东方财富公告", type=DataSourceType.API,
                enabled=True, priority=2, description="东财重要公告",
                endpoints={"announcements": "https://np-anotice-stock.eastmoney.com/api/security/ann"},
                poll_interval=300
            ),
            DataSourceConfig(
                id="research", name="券商研报", type=DataSourceType.API,
                enabled=False, priority=4, description="研报评级变动",
                endpoints={"reports": "https://reportapi.eastmoney.com/report/list"},
                poll_interval=600
            ),
            DataSourceConfig(
                id="northbound", name="北向资金", type=DataSourceType.API,
                enabled=True, priority=6, description="实时北向资金流向",
                endpoints={"realtime": "https://push2delay.eastmoney.com/api/qt/kamt.rtmin/get"},
                poll_interval=60
            ),
        ]
        for source in default_sources:
            self.sources[source.id] = source
            self.source_status[source.id] = {
                "connected": False, "last_update": None, "error": None, "message_count": 0
            }
            self._seen_ids[source.id] = set()

        self._load_source_enabled_states()

    def _get_source_config_path(self):
        import os
        config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
        return os.path.join(config_dir, 'data_sources.json')

    def _load_source_enabled_states(self):
        try:
            config_path = self._get_source_config_path()
            current_version = '3.8.3'

            if not os.path.exists(config_path):
                return

            with open(config_path, 'r', encoding='utf-8') as f:
                saved = json.loads(f.read())

            if 'version' in saved:
                saved_version = saved['version']
                if saved_version != current_version:
                    logger.info(f"数据源配置版本升级: {saved_version} → {current_version}")
            else:
                logger.info("检测到旧版数据源配置，进行迁移")

            for sid, state in saved.items():
                if sid == 'version':
                    continue
                if sid in self.sources:
                    if isinstance(state, dict):
                        self.sources[sid].enabled = state.get('enabled', self.sources[sid].enabled)
                    else:
                        self.sources[sid].enabled = state
                    logger.info(f"恢复数据源 {sid} 状态: {'启用' if self.sources[sid].enabled else '禁用'}")
        except Exception as e:
            logger.warning(f"加载数据源配置失败: {e}")

    def _save_source_enabled_states(self):
        try:
            import os
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = self._get_source_config_path()
            saved = {'version': '3.8.3'}
            saved.update({sid: {'enabled': s.enabled} for sid, s in self.sources.items()})
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(saved))
            logger.info("数据源配置已保存")
        except Exception as e:
            logger.warning(f"保存数据源配置失败: {e}")

    # ===== 启停 =====
    def enable_source(self, source_id: str) -> bool:
        if source_id not in self.sources:
            return False
        self.sources[source_id].enabled = True
        self._save_source_enabled_states()
        self._start_source(source_id)
        return True

    def disable_source(self, source_id: str) -> bool:
        if source_id not in self.sources:
            return False
        self.sources[source_id].enabled = False
        self._save_source_enabled_states()
        self._stop_source(source_id)
        return True

    def _start_source(self, source_id: str):
        source = self.sources[source_id]
        if not source.enabled:
            return
        try:
            if source.type == DataSourceType.API:
                self._start_api_source(source_id)
            self.source_status[source_id]["connected"] = True
            self.source_status[source_id]["error"] = None
            logger.info("数据源 %s 已启动", source.name)
        except Exception as e:
            self.source_status[source_id]["error"] = str(e)
            logger.error("启动数据源 %s 失败: %s", source.name, e)

    def _stop_source(self, source_id: str):
        self.source_status[source_id]["connected"] = False
        logger.info("数据源 %s 已停止", source_id)

    def _start_api_source(self, source_id: str):
        source = self.sources[source_id]
        if source_id == "eastmoney":
            self._start_poll_thread("eastmoney", self._fetch_eastmoney_announcements, source.poll_interval)
        elif source_id == "research":
            self._start_poll_thread("research", self._fetch_research_reports, source.poll_interval)
        elif source_id == "northbound":
            self._start_poll_thread("northbound", self._fetch_northbound_data, source.poll_interval)

    def _start_poll_thread(self, source_id: str, fetch_fn, interval: int):
        """启动轮询线程"""
        def poll():
            # 首次立即执行一次
            while self.running and self.sources.get(source_id) and self.sources[source_id].enabled:
                try:
                    fetch_fn()
                except Exception as e:
                    logger.error("%s 轮询失败: %s", source_id, e)
                # 等待 interval 秒，每秒检查 running 状态
                for _ in range(interval):
                    if not self.running or not self.sources.get(source_id, None) or not self.sources[source_id].enabled:
                        return
                    time.sleep(1)

        thread = threading.Thread(target=poll, daemon=True, name=f"poll-{source_id}")
        thread.start()
        self.poll_threads[source_id] = thread

    # ===== 东方财富公告 =====
    def _fetch_eastmoney_announcements(self):
        """获取东财重要公告（np-anotice-stock，直连）"""
        url = self.sources["eastmoney"].endpoints["announcements"]
        params = {
            "sr": -1,
            "page_size": 20,
            "page_index": 1,
            "ann_type": "A",
            "client_source": "web",
            "f_node": 0,
            "s_node": 0,
        }
        data = _get_json(url, params)
        if not data or not data.get("data"):
            self.source_status["eastmoney"]["error"] = "API 返回异常"
            return

        rows = data.get("data", {}).get("list", [])
        if not rows:
            return

        messages = []
        seen = self._seen_ids["eastmoney"]
        for row in rows:
            art_code = row.get("art_code", "")
            if not art_code or art_code in seen:
                continue
            seen.add(art_code)
            if len(seen) > 200:
                seen = set(list(seen)[-200:])
                self._seen_ids["eastmoney"] = seen

            title = row.get("title_ch") or row.get("title") or "无标题公告"
            notice_date = row.get("notice_date", "")
            display_time = row.get("display_time", "")

            # 提取股票名称
            sec_name = ""
            sec_code = ""
            codes = row.get("codes", [])
            if codes and isinstance(codes, list) and len(codes) > 0:
                sec_name = codes[0].get("short_name", "")
                sec_code = codes[0].get("stock_code", "")

            # 提取公告类型
            columns = row.get("columns", [])
            ann_type = ""
            if columns and isinstance(columns, list) and len(columns) > 0:
                ann_type = columns[0].get("column_name", "")

            content_parts = []
            if sec_name:
                content_parts.append(f"股票: {sec_name}({sec_code})")
            if ann_type:
                content_parts.append(f"类型: {ann_type}")
            if notice_date:
                content_parts.append(f"日期: {notice_date}")

            ctime = int(time.time())
            try:
                if display_time:
                    from datetime import datetime
                    dt = datetime.strptime(display_time[:19], "%Y-%m-%d %H:%M:%S")
                    ctime = int(dt.timestamp())
            except Exception:
                pass

            messages.append({
                "aid": _make_aid("eastmoney", art_code),
                "art_code": art_code,  # 留给前端请求详情用
                "title": f"[公告] {title}",
                "content": " | ".join(content_parts) if content_parts else "",
                "comefrom": "东方财富",
                "ctime": ctime,
                "ptime": display_time[11:19] if len(display_time) > 19 else "",
                "categoryId": 0,
                "stocks": [{"name": sec_name, "rise": ""}] if sec_name else [],
                "child": [],
            })

        if messages:
            self._process_source_messages("eastmoney", messages)

    # ===== 券商研报 =====
    def _fetch_research_reports(self):
        """获取券商研报评级变动（reportapi，直连）"""
        url = self.sources["research"].endpoints["reports"]
        # 查最近 7 天的研报
        from datetime import datetime, timedelta
        end_date = datetime.now().strftime("%Y-%m-%d")
        begin_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        params = {
            "industryCode": "*",
            "pageSize": 20,
            "industry": "*",
            "rating": "",
            "ratingChange": "",
            "beginTime": begin_date,
            "endTime": end_date,
            "pageNo": 1,
            "fields": "",
            "qType": 0,
            "orgCode": "",
        }
        data = _get_json(url, params)
        if not data:
            self.source_status["research"]["error"] = "API 返回异常"
            return

        rows = data.get("data", [])
        if not rows:
            return

        messages = []
        seen = self._seen_ids["research"]
        for row in rows:
            info_code = row.get("infoCode", "")
            if not info_code or info_code in seen:
                continue
            seen.add(info_code)
            if len(seen) > 200:
                seen = set(list(seen)[-200:])
                self._seen_ids["research"] = seen

            title = row.get("title", "无标题研报")
            sec_name = row.get("stockName", "")
            sec_code = row.get("stockCode", "")
            rating = row.get("emRatingName", "")
            last_rating = row.get("lastEmRatingName", "")
            org_name = row.get("orgSName") or row.get("orgName", "")
            researcher = row.get("researcher", "")
            publish_date = row.get("publishDate", "")
            target_price = row.get("indvAimPriceT", "")
            industry = row.get("indvInduName", "")

            # 评级变动突出显示
            if last_rating and rating and last_rating != rating:
                title = f"[研报] {sec_name} 评级变动 {last_rating}→{rating} | {title}"
            elif rating and sec_name:
                title = f"[研报] {sec_name} {rating} | {title}"
            else:
                title = f"[研报] {title}"

            content_parts = []
            if sec_name:
                content_parts.append(f"股票: {sec_name}({sec_code})")
            if rating:
                content_parts.append(f"评级: {rating}")
            if last_rating and last_rating != rating:
                content_parts.append(f"上次: {last_rating}")
            if org_name:
                content_parts.append(f"机构: {org_name}")
            if researcher:
                content_parts.append(f"研究员: {researcher}")
            if target_price:
                content_parts.append(f"目标价: {target_price}")
            if industry:
                content_parts.append(f"行业: {industry}")
            if publish_date:
                content_parts.append(f"日期: {publish_date}")

            ctime = int(time.time())
            try:
                if publish_date:
                    from datetime import datetime as dt_cls
                    d = dt_cls.strptime(str(publish_date)[:19], "%Y-%m-%d %H:%M:%S")
                    ctime = int(d.timestamp())
            except Exception:
                pass

            messages.append({
                "aid": _make_aid("research", info_code),
                "info_code": info_code,  # 留给前端请求详情用
                "title": title,
                "content": " | ".join(content_parts) if content_parts else "",
                "comefrom": "券商研报",
                "ctime": ctime,
                "ptime": str(publish_date)[11:19] if len(str(publish_date)) > 19 else "",
                "categoryId": 0,
                "stocks": [{"name": sec_name, "rise": ""}] if sec_name else [],
                "child": [],
            })

        if messages:
            self._process_source_messages("research", messages)

    # ===== 北向资金 =====
    def _fetch_northbound_data(self):
        """获取北向资金实时数据（push2delay，直连）"""
        url = self.sources["northbound"].endpoints["realtime"]
        data = _get_json(url, timeout=8)
        if not data:
            self.source_status["northbound"]["error"] = "API 无响应"
            return

        d = data.get("data")
        if not d:
            return

        # push2delay 返回字段：
        # f1=日期, f2=时间, f3=沪股通净买入(万), f4=深股通净买入(万)
        # f5=北向合计净买入(万), f6=沪股通余额, f7=深股通余额
        date_str = str(d.get("f1", ""))
        time_str = str(d.get("f2", ""))
        sh_net = d.get("f3", 0) or 0   # 沪股通净买入（万元）
        sz_net = d.get("f4", 0) or 0   # 深股通净买入（万元）
        total_net = d.get("f5", 0) or 0  # 北向合计净买入（万元）

        # 转为亿元
        sh_yi = sh_net / 10000
        sz_yi = sz_net / 10000
        total_yi = total_net / 10000

        # 变化超 5 亿才推送（避免每分钟轰炸）
        if self._northbound_last_net is not None:
            diff = abs(total_yi - self._northbound_last_net)
            if diff < 5:
                return

        self._northbound_last_net = total_yi

        # 方向
        if total_yi > 0:
            direction = "净流入"
            sign = "+"
        else:
            direction = "净流出"
            sign = ""

        title = f"[北向资金] {direction}{abs(total_yi):.2f}亿元 沪股通{sign}{sh_yi:.2f}亿 深股通{sign}{sz_yi:.2f}亿"

        content = f"日期: {date_str} {time_str}\n沪股通净买入: {sh_yi:.2f}亿元\n深股通净买入: {sz_yi:.2f}亿元\n北向合计: {total_yi:.2f}亿元"

        ctime = int(time.time())
        try:
            from datetime import datetime
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")
            ctime = int(dt.timestamp())
        except Exception:
            pass

        message = {
            "aid": _make_aid("northbound", f"{date_str}_{time_str}"),
            "title": title,
            "content": content,
            "comefrom": "北向资金",
            "ctime": ctime,
            "ptime": time_str,
            "categoryId": 0,
            "stocks": [],
            "child": [],
        }

        self._process_source_messages("northbound", [message])

    # ===== 消息处理 =====
    def _process_source_messages(self, source_id: str, messages: List[Dict]):
        if not messages:
            return
        for message in messages:
            message["source_id"] = source_id
            message["source_name"] = self.sources[source_id].name
            self._dispatch_message(message)

        count = len(messages)
        self.source_status[source_id]["message_count"] += count
        self.source_status[source_id]["last_update"] = time.time()
        logger.info("%s 推送 %d 条消息", source_id, count)

    # ===== 全局启停 =====
    def start_all_enabled_sources(self):
        self.running = True
        enabled = [(sid, s) for sid, s in self.sources.items() if s.enabled and s.type != DataSourceType.WEBSOCKET]
        enabled.sort(key=lambda x: x[1].priority)
        for source_id, _ in enabled:
            self._start_source(source_id)

    def stop_all_sources(self):
        self.running = False
        for source_id in self.sources:
            self._stop_source(source_id)

    # ===== 查询接口 =====
    def get_source_status(self, source_id: str) -> Optional[Dict]:
        return self.source_status.get(source_id)

    def get_all_source_status(self) -> Dict[str, Dict]:
        return self.source_status

    def get_enabled_sources(self) -> List[Dict]:
        return [{"id": sid, **s.__dict__, "status": self.source_status[sid]}
                for sid, s in self.sources.items() if s.enabled]

    def get_all_sources(self) -> List[Dict]:
        result = []
        for sid, s in self.sources.items():
            d = {"id": sid, "name": s.name, "type": s.type.value if isinstance(s.type, DataSourceType) else s.type,
                 "enabled": s.enabled, "priority": s.priority, "description": s.description,
                 "poll_interval": s.poll_interval, "status": self.source_status[sid]}
            result.append(d)
        return result

    def update_source_config(self, source_id: str, config: Dict) -> bool:
        if source_id not in self.sources:
            return False
        source = self.sources[source_id]
        for key, value in config.items():
            if hasattr(source, key):
                setattr(source, key, value)
        if source.enabled:
            self._stop_source(source_id)
            self._start_source(source_id)
        return True

    def test_source_connection(self, source_id: str) -> Dict:
        """测试数据源连接（真实请求）"""
        if source_id not in self.sources:
            return {"success": False, "message": f"数据源 {source_id} 不存在"}

        source = self.sources[source_id]
        if source.type == DataSourceType.WEBSOCKET:
            return {"success": True, "message": "WebSocket 数据源由主程序管理", "latency": 0}

        if source_id == "eastmoney":
            url = source.endpoints["announcements"]
            t0 = time.time()
            data = _get_json(url, {"sr": -1, "page_size": 1, "page_index": 1,
                                   "ann_type": "A", "client_source": "web",
                                   "f_node": 0, "s_node": 0}, timeout=8)
            latency = int((time.time() - t0) * 1000)
            if data and data.get("data"):
                return {"success": True, "message": "连接成功", "latency": latency}
            return {"success": False, "message": "API 返回异常", "latency": latency}

        if source_id == "research":
            url = source.endpoints["reports"]
            t0 = time.time()
            data = _get_json(url, {"industryCode": "*", "pageSize": 1, "industry": "*",
                                   "pageNo": 1, "qType": 0, "beginTime": "2026-01-01",
                                   "endTime": "2026-12-31"}, timeout=8)
            latency = int((time.time() - t0) * 1000)
            if data and data.get("data"):
                return {"success": True, "message": "连接成功", "latency": latency}
            return {"success": False, "message": "API 返回异常", "latency": latency}

        if source_id == "northbound":
            url = source.endpoints["realtime"]
            t0 = time.time()
            try:
                data = _get_json(url, timeout=8)
                latency = int((time.time() - t0) * 1000)
                if data:
                    # API 可达即视为成功，收盘后 data 字段可能为空但不代表接口故障
                    has_data = data.get("data") is not None
                    if has_data:
                        return {"success": True, "message": "连接成功（有数据）", "latency": latency}
                    else:
                        return {"success": True, "message": "连接成功（当前无数据，收盘后正常）", "latency": latency}
                return {"success": False, "message": "API 无响应", "latency": latency}
            except Exception as e:
                latency = int((time.time() - t0) * 1000)
                return {"success": False, "message": f"连接失败: {e}", "latency": latency}

        return {"success": False, "message": "未知数据源类型"}


# 全局实例
data_source_manager = DataSourceManager()
