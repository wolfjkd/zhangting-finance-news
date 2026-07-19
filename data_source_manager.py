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
import os
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger('ztfi')

# ===== 直连 Session（不走系统代理，用于国内 API）=====
_session = requests.Session()
_session.trust_env = False
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://data.eastmoney.com/',
})

# ===== 外网 Session（走本地/系统代理，兼容 Clash/Mihomo/v2ray/sing-box 等）=====
# 常见本地 HTTP/SOCKS 代理端口（Clash/Mihomo/v2rayN/v2ray/Qv2ray/sing-box/SSR 等）
_COMMON_PROXY_PORTS = (
    7897, 7890, 7891, 7892, 7893,  # Clash / Mihomo / Clash Meta
    10808, 10809, 1080, 1081, 1087,  # v2rayN / v2ray / Qv2ray
    20171, 20172,  # sing-box 等常见自定义
    8888, 8889, 8080, 8118,  # 通用 HTTP 代理
    6152, 6153,  # Surge / 部分客户端
)


def _parse_proxy_host_port(proxy_url: str):
    """从代理 URL 或 host:port 解析 (host, port)。"""
    if not proxy_url:
        return None, None
    raw = proxy_url.strip()
    # 去掉协议前缀
    for prefix in ('http://', 'https://', 'socks5://', 'socks5h://', 'socks4://', 'socks://'):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
            break
    # 去掉路径与认证
    raw = raw.split('/')[0]
    if '@' in raw:
        raw = raw.rsplit('@', 1)[-1]
    if raw.startswith('['):
        # IPv6 [host]:port
        try:
            host, port_s = raw[1:].split(']:', 1)
            return host, int(port_s)
        except Exception:
            return None, None
    if ':' in raw:
        host, port_s = raw.rsplit(':', 1)
        try:
            return host, int(port_s)
        except ValueError:
            return None, None
    return None, None


def _port_open(host: str, port: int, timeout: float = 0.6) -> bool:
    """探测本机端口是否可连接。"""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        ok = sock.connect_ex((host, port)) == 0
        sock.close()
        return ok
    except Exception:
        return False


def _read_windows_system_proxy():
    """读取 Windows 系统代理（IE/Internet Settings），兼容 Clash/v2ray 开启系统代理。"""
    if os.name != 'nt':
        return None
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r'Software\Microsoft\Windows\CurrentVersion\Internet Settings'
        )
        try:
            enable, _ = winreg.QueryValueEx(key, 'ProxyEnable')
            if not enable:
                return None
            server, _ = winreg.QueryValueEx(key, 'ProxyServer')
        finally:
            winreg.CloseKey(key)
        if not server:
            return None
        # 可能是 "127.0.0.1:7897" 或 "http=127.0.0.1:7897;https=..."
        server = str(server).strip()
        if '=' in server:
            parts = {}
            for item in server.split(';'):
                item = item.strip()
                if '=' in item:
                    k, v = item.split('=', 1)
                    parts[k.strip().lower()] = v.strip()
            server = parts.get('http') or parts.get('https') or next(iter(parts.values()), '')
        host, port = _parse_proxy_host_port(server)
        if host and port:
            return {'host': host, 'port': port, 'source': 'windows_system', 'url': f'http://{host}:{port}'}
    except Exception as e:
        logger.debug("读取 Windows 系统代理失败: %s", e)
    return None


def _read_env_proxy():
    """读取 HTTP(S)_PROXY / ALL_PROXY 环境变量。"""
    for key in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'):
        val = os.environ.get(key)
        if not val:
            continue
        host, port = _parse_proxy_host_port(val)
        if host and port:
            # 环境变量可能是 socks5://，requests 需 socks 额外依赖；统一用 http 探测，会话仍用原 URL
            scheme = 'http'
            low = val.strip().lower()
            if low.startswith('socks'):
                scheme = low.split('://', 1)[0] if '://' in low else 'socks5'
            return {
                'host': host,
                'port': port,
                'source': f'env:{key}',
                'url': f'{scheme}://{host}:{port}' if '://' not in val else val.strip(),
            }
    return None


def _detect_local_proxy():
    """
    检测本地代理是否可用（不限 Clash）。
    优先级：环境变量 → Windows 系统代理 → 常见本地端口探测。
    返回 dict 或 None: {host, port, source, url}
    """
    # 1) 环境变量
    env_proxy = _read_env_proxy()
    if env_proxy and _port_open(env_proxy['host'], env_proxy['port']):
        return env_proxy

    # 2) Windows 系统代理（Clash/Mihomo/v2rayN 开启「系统代理」时）
    sys_proxy = _read_windows_system_proxy()
    if sys_proxy and _port_open(sys_proxy['host'], sys_proxy['port']):
        return sys_proxy

    # 3) 常见本地端口（HTTP 混合端口）
    for port in _COMMON_PROXY_PORTS:
        if _port_open('127.0.0.1', port):
            return {
                'host': '127.0.0.1',
                'port': port,
                'source': 'local_port',
                'url': f'http://127.0.0.1:{port}',
            }

    # 环境变量/系统代理已配置但端口暂时连不上时仍返回配置，便于给出明确错误
    if env_proxy:
        return env_proxy
    if sys_proxy:
        return sys_proxy
    return None


def _create_proxy_session(proxy_info=None):
    """创建走代理的 Session，用于访问外网数据源。"""
    s = requests.Session()
    s.trust_env = True
    s.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
        })
    if proxy_info and proxy_info.get('url'):
        # 显式绑定检测到的代理，避免仅依赖环境变量漏配
        proxy_url = proxy_info['url']
        # socks 需 PySocks；若是 socks 且可能缺依赖，优先用 http 同端口（多数客户端双开）
        if proxy_url.lower().startswith('socks'):
            http_fallback = f"http://{proxy_info['host']}:{proxy_info['port']}"
            s.proxies.update({'http': http_fallback, 'https': http_fallback})
        else:
            s.proxies.update({'http': proxy_url, 'https': proxy_url})
    return s


_proxy_info = _detect_local_proxy()
_proxy_session = _create_proxy_session(_proxy_info)


def _refresh_proxy_session():
    """重新检测代理并刷新外网 Session。"""
    global _proxy_info, _proxy_session
    _proxy_info = _detect_local_proxy()
    _proxy_session = _create_proxy_session(_proxy_info)
    return _proxy_info


def _is_proxy_available():
    """检测代理是否可用（Clash/Mihomo/v2ray/系统代理/环境变量等）。"""
    info = _refresh_proxy_session()
    if not info:
        return False
    return _port_open(info['host'], info['port'])


def _proxy_status_message():
    """生成代理检测状态文案（供测试/错误提示）。"""
    info = _proxy_info or _detect_local_proxy()
    if not info:
        return (
            "未检测到本地代理。请开启 Clash / Mihomo / v2rayN 等工具，"
            "并开启系统代理或设置 HTTP 代理（常见端口 7890/7897/10808 等）。"
        )
    reachable = _port_open(info['host'], info['port'])
    label = f"{info['host']}:{info['port']}（{info.get('source', 'unknown')}）"
    if reachable:
        return f"已检测到代理 {label}"
    return f"已配置代理 {label}，但端口不可达，请确认代理客户端已启动"

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
            DataSourceConfig(
                id="dragon_tiger", name="龙虎榜", type=DataSourceType.API,
                enabled=True, priority=3, description="每日龙虎榜数据",
                endpoints={"daily": "https://push2.eastmoney.com/api/qt/clist/get"},
                poll_interval=300
            ),
            DataSourceConfig(
                id="ann_interpret", name="公告解读", type=DataSourceType.API,
                enabled=True, priority=5, description="AI解读公告要点",
                endpoints={"base": "https://np-anotice-stock.eastmoney.com/api/security/ann"},
                poll_interval=300
            ),
            DataSourceConfig(
                id="foreign_news", name="外网资讯", type=DataSourceType.API,
                enabled=False, priority=7, 
                description="汇集外网平台X(Twitter)、Reddit、Google News等一手财经、政策、科技、中国供应链信息源（需自备代理）",
                endpoints={
                    "reddit": "https://www.reddit.com",
                    "google_news": "https://news.google.com",
                    "techcrunch": "https://techcrunch.com/feed/"
                },
                poll_interval=300
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
        elif source_id == "dragon_tiger":
            self._start_poll_thread("dragon_tiger", self._fetch_dragon_tiger_data, source.poll_interval)
        elif source_id == "ann_interpret":
            self._start_poll_thread("ann_interpret", self._fetch_announcement_interpretation, source.poll_interval)
        elif source_id == "foreign_news":
            self._start_poll_thread("foreign_news", self._fetch_foreign_news, source.poll_interval)

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

    # ===== 龙虎榜 =====
    def _fetch_dragon_tiger_data(self):
        """获取每日龙虎榜数据（push2.eastmoney.com，直连）"""
        url = self.sources["dragon_tiger"].endpoints["daily"]
        from datetime import datetime
        params = {
            "pn": "1",
            "pz": "20",
            "po": "1",
            "np": "1",
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": "2",
            "invt": "2",
            "fid": "f62",
            "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
            "fields": "f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f2,f3",
        }
        data = _get_json(url, params)
        if not data or not data.get("data"):
            self.source_status["dragon_tiger"]["error"] = "API 返回异常"
            return

        rows = data.get("data", {}).get("diff", [])
        if not rows:
            return

        messages = []
        seen = self._seen_ids["dragon_tiger"]
        for row in rows:
            sec_code = row.get("f12", "")
            sec_name = row.get("f14", "")
            amount = row.get("f62", 0) or 0
            buy_amount = row.get("f66", 0) or 0
            buy_ratio = row.get("f69", 0) or 0
            sell_amount = row.get("f72", 0) or 0
            sell_ratio = row.get("f75", 0) or 0
            net_amount = row.get("f78", 0) or 0
            net_ratio = row.get("f81", 0) or 0
            change_rate = row.get("f3", 0) or 0
            
            if not sec_code or not sec_name:
                continue
                
            unique_key = f"{sec_code}_{amount}_{net_amount}"
            if unique_key in seen:
                continue
            seen.add(unique_key)
            if len(seen) > 200:
                seen = set(list(seen)[-200:])
                self._seen_ids["dragon_tiger"] = seen

            amount_yi = amount / 100000000
            buy_yi = buy_amount / 100000000
            sell_yi = sell_amount / 100000000
            net_yi = net_amount / 100000000

            if net_yi > 0:
                direction = "净买入"
                sign = "+"
            else:
                direction = "净卖出"
                sign = ""

            title = f"[龙虎榜] {sec_name} {direction}{abs(net_yi):.2f}亿 涨幅{change_rate}%"
            content = f"成交额: {amount_yi:.2f}亿 | 买入: {buy_yi:.2f}亿({buy_ratio}%) | 卖出: {sell_yi:.2f}亿({sell_ratio}%) | 净额: {sign}{net_yi:.2f}亿({net_ratio}%)"

            ctime = int(time.time())

            messages.append({
                "aid": _make_aid("dragon_tiger", unique_key),
                "title": title,
                "content": content,
                "comefrom": "龙虎榜",
                "ctime": ctime,
                "ptime": datetime.now().strftime("%H:%M:%S"),
                "categoryId": 0,
                "stocks": [{"name": sec_name, "rise": str(change_rate) if change_rate else ""}],
                "child": [],
            })

        if messages:
            self._process_source_messages("dragon_tiger", messages)

    # ===== 公告解读 =====
    def _fetch_announcement_interpretation(self):
        """获取公告并自动解读要点（基于东财公告接口，添加AI风格解读）"""
        url = self.sources["ann_interpret"].endpoints["base"]
        params = {
            "sr": -1,
            "page_size": 10,
            "page_index": 1,
            "ann_type": "A",
            "client_source": "web",
            "f_node": 0,
            "s_node": 0,
        }
        data = _get_json(url, params)
        if not data or not data.get("data"):
            self.source_status["ann_interpret"]["error"] = "API 返回异常"
            return

        rows = data.get("data", {}).get("list", [])
        if not rows:
            return

        messages = []
        seen = self._seen_ids["ann_interpret"]
        for row in rows:
            art_code = row.get("art_code", "")
            if not art_code or art_code in seen:
                continue
            seen.add(art_code)
            if len(seen) > 200:
                seen = set(list(seen)[-200:])
                self._seen_ids["ann_interpret"] = seen

            title = row.get("title_ch") or row.get("title") or "无标题公告"
            
            sec_name = ""
            codes = row.get("codes", [])
            if codes and isinstance(codes, list) and len(codes) > 0:
                sec_name = codes[0].get("short_name", "")

            columns = row.get("columns", [])
            ann_type = ""
            if columns and isinstance(columns, list) and len(columns) > 0:
                ann_type = columns[0].get("column_name", "")

            interpretation = self._interpret_announcement(title, ann_type)

            title = f"[解读] {title}"

            ctime = int(time.time())
            display_time = row.get("display_time", "")
            try:
                from datetime import datetime as dt_cls
                if display_time:
                    dt = dt_cls.strptime(display_time[:19], "%Y-%m-%d %H:%M:%S")
                    ctime = int(dt.timestamp())
            except Exception:
                pass

            messages.append({
                "aid": _make_aid("ann_interpret", art_code),
                "art_code": art_code,
                "title": title,
                "content": interpretation,
                "comefrom": "公告解读",
                "ctime": ctime,
                "ptime": display_time[11:19] if len(display_time) > 19 else "",
                "categoryId": 0,
                "stocks": [{"name": sec_name, "rise": ""}] if sec_name else [],
                "child": [],
            })

        if messages:
            self._process_source_messages("ann_interpret", messages)

    def _interpret_announcement(self, title: str, ann_type: str) -> str:
        """简单的公告类型解读"""
        interpretations = {
            "业绩预告": "关注净利润同比增速、业绩变动原因、是否符合市场预期",
            "业绩快报": "业绩快报通常为未经审计数据，正式财报发布时间需关注",
            "分红": "关注每股分红金额、股息率、分红比例是否提高",
            "定增": "关注募资用途、发行价格、锁定期安排、是否摊薄现有股东权益",
            "减持": "关注减持比例、减持方身份、减持原因、对股价的潜在压力",
            "增持": "关注增持金额、增持主体、增持目的、是否有后续增持计划",
            "回购": "关注回购金额上限、用途（注销/股权激励）、期限、价格区间",
            "中标": "关注中标金额占营收比例、项目周期、对公司业绩影响",
            "并购": "关注收购标的估值、支付方式、协同效应、审批进展",
            "战略合作": "关注合作内容、合作方实力、对业务拓展的潜在影响",
            "涨停": "关注涨停原因、封单量、是否属于板块热点、次日持续性",
            "跌停": "关注跌停原因、是否有利空公告、成交量变化",
        }
        
        for key, value in interpretations.items():
            if key in title or key in ann_type:
                return value
        
        return f"公告类型: {ann_type}\n建议关注公告核心内容，评估对公司基本面的影响"

    # ===== 翻译功能 =====
    def _translate_to_chinese(self, text: str) -> str:
        """使用多翻译源将英文翻译成中文（自动降级）"""
        if not text or not isinstance(text, str):
            return text
        
        translators = [
            self._translate_mymemory,
            self._translate_libretranslate,
            self._translate_yandex,
            self._translate_deepl_free,
        ]
        
        for i, translator in enumerate(translators):
            try:
                result = translator(text)
                if result and result != text:
                    return result
            except Exception as e:
                logger.debug(f"翻译源{i+1}失败: {e}")
        
        logger.warning(f"所有翻译源均失败，返回原文")
        return text
    
    def _translate_mymemory(self, text: str) -> str:
        url = "https://api.mymemory.translated.net/get"
        params = {"q": text[:2000], "langpair": "en|zh-CN"}
        resp = _proxy_session.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            if 'responseData' in result and result['responseData']:
                translated = result['responseData'].get('translatedText', '')
                if translated and translated.strip():
                    return translated
        return text
    
    def _translate_libretranslate(self, text: str) -> str:
        endpoints = [
            "https://libretranslate.de",
            "https://translate.argosopentech.com",
        ]
        for base_url in endpoints:
            try:
                url = f"{base_url}/translate"
                data = {"q": text[:2000], "source": "en", "target": "zh"}
                resp = _proxy_session.post(url, json=data, timeout=10)
                if resp.status_code == 200:
                    result = resp.json()
                    translated = result.get('translatedText', '')
                    if translated and translated.strip():
                        return translated
            except Exception:
                continue
        return text
    
    def _translate_yandex(self, text: str) -> str:
        url = "https://translate.yandex.net/api/v1.5/tr.json/translate"
        params = {
            "key": "trnsl.1.1.20240101T000000Z.abcdef1234567890.abcdef1234567890abcdef1234567890",
            "text": text[:2000],
            "lang": "en-zh"
        }
        resp = _proxy_session.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            if 'text' in result and result['text']:
                translated = result['text'][0]
                if translated and translated.strip():
                    return translated
        return text
    
    def _translate_deepl_free(self, text: str) -> str:
        url = "https://api-free.deepl.com/v2/translate"
        params = {
            "auth_key": "bf4c5109-2892-c46b-1234-567890abcdef:fx",
            "text": text[:2000],
            "target_lang": "ZH"
        }
        resp = _proxy_session.post(url, data=params, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            translations = result.get('translations', [])
            if translations:
                translated = translations[0].get('text', '')
                if translated and translated.strip():
                    return translated
        return text

    # ===== 外网资讯综合函数 =====
    def _fetch_foreign_news(self):
        """获取外网资讯（Reddit、Google News、TechCrunch）并翻译为中文"""
        if not _is_proxy_available():
            self.source_status["foreign_news"]["error"] = _proxy_status_message()
            return
        
        messages = []
        seen = self._seen_ids.get("foreign_news", set())
        
        try:
            reddit_msgs = self._fetch_reddit_news(seen)
            google_msgs = self._fetch_google_news(seen)
            tc_msgs = self._fetch_techcrunch_via_proxy(seen)
            
            messages.extend(reddit_msgs)
            messages.extend(google_msgs)
            messages.extend(tc_msgs)
            
            logger.info(f"外网资讯抓取结果 - Reddit: {len(reddit_msgs)}, Google News: {len(google_msgs)}, TechCrunch: {len(tc_msgs)}, 总计: {len(messages)}")
            
            self._seen_ids["foreign_news"] = seen
            if len(seen) > 300:
                seen = set(list(seen)[-300:])
                self._seen_ids["foreign_news"] = seen
            
            if messages:
                self._process_source_messages("foreign_news", messages)
                self.source_status["foreign_news"]["error"] = None
            else:
                logger.info("外网资讯本次抓取无新消息")
        except Exception as e:
            logger.error(f"获取外网资讯失败: {e}")
            self.source_status["foreign_news"]["error"] = str(e)

    def _fetch_reddit_news(self, seen):
        """获取Reddit高质量财经科技新闻（多层筛选）"""
        messages = []
        
        twenty_four_hours_ago = time.time() - 24 * 3600
        
        include_keywords = [
            "China", "Chinese", "Beijing", "Shanghai", "Hong Kong", "Shenzhen",
            "supply chain", "semiconductor", "chip", "AI", "artificial intelligence",
            "tech", "technology", "Biden", "Trump", "trade war", "tariff",
            "IPO", "stock", "market", "economy", "government", "regulation",
            "NVIDIA", "TSMC", "Apple", "Huawei", "Alibaba", "Tencent", "BYD", "JD",
            "manufacturing", "factory", "production", "export", "import",
            "policy", "law", "bill", "congress", "senate", "white house",
            "innovation", "breakthrough", "advance", "cutting-edge",
            "global", "world", "international", "diplomacy"
        ]
        
        exclude_keywords = [
            "crypto", "cryptocurrency", "bitcoin", "ethereum", "blockchain", "NFT",
            "memes", "meme", "gambling", "casino", "sports", "football", "basketball",
            "game", "gaming", "stream", "twitch", "youtube", "tiktok", "social media",
            "celebrity", "entertainment", "movie", "music", "TV",
            "food", "cooking", "restaurant", "travel", "vacation",
            "healthcare", "medicine", "vaccine", "COVID", "pandemic"
        ]
        
        subreddits = ["technology", "worldnews", "business", "stocks"]
        
        for sub in subreddits[:4]:
            try:
                url = f"https://www.reddit.com/r/{sub}/hot.json"
                params = {'limit': 10}
                resp = _proxy_session.get(url, params=params, timeout=15)
                if resp.status_code != 200:
                    continue
                
                data = resp.json()
                if not data.get('data', {}).get('children'):
                    continue
                
                for post in data['data']['children']:
                    p = post['data']
                    title = p.get('title', '')
                    link = p.get('url', '')
                    score = p.get('score', 0)
                    num_comments = p.get('num_comments', 0)
                    created_utc = p.get('created_utc', 0)
                    
                    if not title:
                        continue
                    
                    title_lower = title.lower()
                    
                    if score < 50:
                        continue
                    
                    if created_utc and created_utc < twenty_four_hours_ago:
                        continue
                    
                    unique_key = f"reddit_{link}" if link else f"reddit_{title[:50]}"
                    if unique_key in seen:
                        continue
                    seen.add(unique_key)
                    
                    if any(ek in title_lower for ek in exclude_keywords):
                        continue
                    
                    has_include = any(ik.lower() in title_lower for ik in include_keywords)
                    if not has_include:
                        continue
                    
                    quality_score = score // 100 + num_comments // 10
                    if quality_score < 3:
                        continue
                    
                    translated_title = self._translate_to_chinese(title)
                    
                    messages.append({
                        "aid": _make_aid("foreign_news", unique_key),
                        "title": f"[Reddit] {translated_title}",
                        "content": f"热度: {score} | 评论: {num_comments}",
                        "comefrom": f"Reddit r/{sub}",
                        "ctime": int(time.time()),
                        "ptime": "",
                        "categoryId": 0,
                        "stocks": [],
                        "child": [],
                    })
            except Exception as e:
                logger.warning(f"获取Reddit r/{sub}失败: {e}")
        
        return messages

    def _fetch_google_news(self, seen):
        """获取Google News高质量国际财经科技新闻（关键词搜索+多层筛选）"""
        messages = []
        
        search_keywords = [
            "China supply chain",
            "Chinese economy",
            "China tech news",
            "AI breakthrough",
            "semiconductor chip",
            "US China trade war",
            "Chinese stocks market",
            "China government policy",
            "technology innovation",
            "global economy news"
        ]
        
        include_keywords = [
            "China", "Chinese", "supply chain", "semiconductor", "chip", "AI",
            "technology", "economy", "trade", "policy", "government",
            "innovation", "breakthrough", "market", "stock", "IPO",
            "Biden", "Trump", "congress", "tariff", "export", "import",
            "global", "world", "international", "diplomacy",
            "Huawei", "Alibaba", "Tencent", "BYD", "NVIDIA", "TSMC", "Apple"
        ]
        
        exclude_keywords = [
            "crypto", "cryptocurrency", "bitcoin", "ethereum", "blockchain", "NFT",
            "sports", "football", "basketball", "game", "gaming", "movie", "music",
            "celebrity", "entertainment", "food", "travel", "healthcare", "COVID", "pandemic"
        ]
        
        forty_eight_hours_ago = time.time() - 48 * 3600

        for keyword in search_keywords[:5]:
            try:
                url = f"https://news.google.com/rss/search?q={requests.utils.quote(keyword)}&tbm=nws&tbs=qdr:d"
                params = {'hl': 'en-US'}
                resp = _proxy_session.get(url, params=params, timeout=15)
                if resp.status_code != 200:
                    continue
                
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.text)
                
                items = root.findall('.//item')
                for item in items[:6]:
                    title_elem = item.find('title')
                    link_elem = item.find('link')
                    pub_date_elem = item.find('pubDate')
                    
                    title = title_elem.text.strip() if title_elem is not None else ""
                    link = link_elem.text.strip() if link_elem is not None else ""
                    pub_date = pub_date_elem.text.strip() if pub_date_elem is not None else ""
                    
                    if not title or len(title) < 15:
                        continue
                    
                    title_lower = title.lower()
                    
                    if any(ek in title_lower for ek in exclude_keywords):
                        continue
                    
                    has_include = any(ik.lower() in title_lower for ik in include_keywords)
                    if not has_include:
                        continue
                    
                    if pub_date:
                        try:
                            import email.utils
                            parsed_date = email.utils.parsedate(pub_date)
                            if parsed_date:
                                pub_timestamp = time.mktime(parsed_date)
                                if pub_timestamp < forty_eight_hours_ago:
                                    continue
                        except:
                            pass
                    
                    unique_key = f"google_{link}" if link else f"google_{title[:50]}"
                    if unique_key in seen:
                        continue
                    seen.add(unique_key)
                    
                    translated_title = self._translate_to_chinese(title)
                    
                    messages.append({
                        "aid": _make_aid("foreign_news", unique_key),
                        "title": f"[谷歌新闻] {translated_title}",
                        "content": "",
                        "comefrom": "Google News",
                        "ctime": int(time.time()),
                        "ptime": pub_date[:16] if pub_date else "",
                        "categoryId": 0,
                        "stocks": [],
                        "child": [],
                    })
            except Exception as e:
                logger.warning(f"获取Google News '{keyword}'失败: {e}")
        
        return messages

    def _fetch_techcrunch_via_proxy(self, seen):
        """通过代理获取TechCrunch高质量科技新闻（多层筛选）"""
        messages = []
        
        forty_eight_hours_ago = time.time() - 48 * 3600
        
        include_keywords = [
            "AI", "artificial intelligence", "machine learning", "deep learning",
            "semiconductor", "chip", "CPU", "GPU", "NVIDIA", "Intel", "AMD",
            "China", "Chinese", "Huawei", "Alibaba", "Tencent", "BYD",
            "supply chain", "manufacturing", "factory",
            "innovation", "breakthrough", "advance", "cutting-edge",
            "startup", "IPO", "funding", "investment", "valuation",
            "technology", "tech", "software", "hardware",
            "cloud", "computing", "data center",
            "robotics", "automation", "future", "next generation",
            "self-driving", "autonomous", "EV", "electric vehicle", "charging",
            "service", "platform", "product", "launch", "release",
            "company", "business", "market", "economy",
            "security", "privacy", "hack", "cybersecurity"
        ]
        
        exclude_keywords = [
            "crypto", "cryptocurrency", "bitcoin", "ethereum", "blockchain", "NFT",
            "game", "gaming", "mobile game", "video game",
            "social media", "twitter", "facebook", "instagram", "tiktok",
            "celebrity", "entertainment", "movie", "music",
            "food", "cooking", "travel", "vacation",
            "health", "healthcare", "medicine", "COVID", "pandemic",
            "sports", "football", "basketball",
            "podcast", "video", "youtube", "twitch", "stream"
        ]
        
        try:
            url = "https://techcrunch.com/feed/"
            resp = _proxy_session.get(url, timeout=15)
            resp.encoding = 'utf-8'
            if resp.status_code != 200:
                return messages
            
            import xml.etree.ElementTree as ET
            root = ET.fromstring(resp.text)
            
            items = root.findall('.//item')
            for item in items[:10]:
                title_elem = item.find('title')
                link_elem = item.find('link')
                pub_date_elem = item.find('pubDate')
                description_elem = item.find('description')
                
                title = title_elem.text.strip() if title_elem is not None else ""
                link = link_elem.text.strip() if link_elem is not None else ""
                pub_date = pub_date_elem.text.strip() if pub_date_elem is not None else ""
                description = description_elem.text.strip() if description_elem is not None else ""
                
                if not title or len(title) < 15:
                    continue
                
                title_lower = title.lower()
                
                if any(ek in title_lower for ek in exclude_keywords):
                    continue
                
                has_include = any(ik.lower() in title_lower for ik in include_keywords)
                if not has_include:
                    continue
                
                if pub_date:
                    try:
                        import email.utils
                        parsed_date = email.utils.parsedate(pub_date)
                        if parsed_date:
                            pub_timestamp = time.mktime(parsed_date)
                            if pub_timestamp < forty_eight_hours_ago:
                                continue
                    except:
                        pass
                
                unique_key = f"techcrunch_{link}" if link else f"techcrunch_{title[:50]}"
                if unique_key in seen:
                    continue
                seen.add(unique_key)
                
                translated_title = self._translate_to_chinese(title)
                translated_desc = self._translate_to_chinese(description)
                
                messages.append({
                    "aid": _make_aid("foreign_news", unique_key),
                    "title": f"[TechCrunch] {translated_title}",
                    "content": translated_desc[:500] if translated_desc else "",
                    "comefrom": "TechCrunch",
                    "ctime": int(time.time()),
                    "ptime": pub_date[:16] if pub_date else "",
                    "categoryId": 0,
                    "stocks": [],
                    "child": [],
                })
        except Exception as e:
            logger.warning(f"获取TechCrunch失败: {e}")
        
        return messages

    # ===== 消息处理 =====
    def _process_source_messages(self, source_id: str, messages: List[Dict]):
        if not messages:
            return
        interval = 1.5 if source_id == "foreign_news" else 0.5
        for i, message in enumerate(messages):
            message["source_id"] = source_id
            message["source_name"] = self.sources[source_id].name
            self._dispatch_message(message)
            if i < len(messages) - 1:
                time.sleep(interval)

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
                    has_data = data.get("data") is not None
                    if has_data:
                        return {"success": True, "message": "连接成功（有数据）", "latency": latency}
                    else:
                        return {"success": True, "message": "连接成功（当前无数据，收盘后正常）", "latency": latency}
                return {"success": False, "message": "API 无响应", "latency": latency}
            except Exception as e:
                latency = int((time.time() - t0) * 1000)
                return {"success": False, "message": f"连接失败: {e}", "latency": latency}

        if source_id == "dragon_tiger":
            url = source.endpoints["daily"]
            t0 = time.time()
            data = _get_json(url, {"pn": "1", "pz": "1", "po": "1", "np": "1",
                                   "ut": "bd1d9ddb04089700cf9c27f6f7426281", "fltt": "2",
                                   "invt": "2", "fid": "f62", "fs": "m:0+t:6",
                                   "fields": "f12,f14"}, timeout=8)
            latency = int((time.time() - t0) * 1000)
            if data and data.get("data"):
                return {"success": True, "message": "连接成功", "latency": latency}
            return {"success": False, "message": "API 返回异常", "latency": latency}

        if source_id == "ann_interpret":
            url = source.endpoints["base"]
            t0 = time.time()
            data = _get_json(url, {"sr": -1, "page_size": 1, "page_index": 1,
                                   "ann_type": "A", "client_source": "web",
                                   "f_node": 0, "s_node": 0}, timeout=8)
            latency = int((time.time() - t0) * 1000)
            if data and data.get("data"):
                return {"success": True, "message": "连接成功", "latency": latency}
            return {"success": False, "message": "API 返回异常", "latency": latency}

        if source_id == "foreign_news":
            # 1) 检测代理（Clash/Mihomo/v2rayN/系统代理/环境变量等）
            t0 = time.time()
            if not _is_proxy_available():
                latency = int((time.time() - t0) * 1000)
                return {
                    "success": False,
                    "message": _proxy_status_message(),
                    "latency": latency,
                }
            proxy_msg = _proxy_status_message()
            # 2) 经代理真实请求外网端点（Reddit 或 TechCrunch，任一成功即可）
            errors = []
            try:
                resp = _proxy_session.get(
                    "https://www.reddit.com/r/technology/hot.json",
                    params={"limit": 1},
                    timeout=12,
                    headers={"Accept": "application/json"},
                )
                latency = int((time.time() - t0) * 1000)
                if resp.status_code == 200:
                    return {
                        "success": True,
                        "message": f"连接成功（Reddit）。{proxy_msg}",
                        "latency": latency,
                    }
                errors.append(f"Reddit HTTP {resp.status_code}")
            except Exception as e:
                errors.append(f"Reddit: {e}")

            try:
                resp = _proxy_session.get(
                    source.endpoints.get("techcrunch", "https://techcrunch.com/feed/"),
                    timeout=12,
                )
                latency = int((time.time() - t0) * 1000)
                if resp.status_code == 200 and resp.text:
                    return {
                        "success": True,
                        "message": f"连接成功（TechCrunch）。{proxy_msg}",
                        "latency": latency,
                    }
                errors.append(f"TechCrunch HTTP {resp.status_code}")
            except Exception as e:
                errors.append(f"TechCrunch: {e}")

            latency = int((time.time() - t0) * 1000)
            detail = "；".join(errors[:3]) if errors else "未知错误"
            return {
                "success": False,
                "message": f"代理可用，但外网请求失败：{detail}。{proxy_msg}",
                "latency": latency,
            }

        return {"success": False, "message": "未知数据源类型"}


# 全局实例
data_source_manager = DataSourceManager()
