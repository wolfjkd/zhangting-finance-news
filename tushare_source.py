# -*- coding: utf-8 -*-
"""
Tushare 独立数据源 — 权限自适应 + 多接口轮询

功能：
- 首次启动探测 Token 权限，自动选择可用接口
- 日线异动扫描（免费权限）
- 财经新闻/资金流向/龙虎榜/涨停板（高积分权限，按需开启）
- 配置文件：%APPDATA%/ZTFINews/tushare_config.json
"""

import hashlib
import time
import logging
import os
import json
import threading
from typing import Callable, Dict, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_TUSHARE_TOKEN = None
_TUSHARE_PRO = None


def _get_token() -> str:
    """从配置文件读取 Tushare Token"""
    global _TUSHARE_TOKEN
    if _TUSHARE_TOKEN:
        return _TUSHARE_TOKEN
    try:
        config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
        config_path = os.path.join(config_dir, 'tushare_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                _TUSHARE_TOKEN = config.get('token', '')
    except Exception:
        pass
    return _TUSHARE_TOKEN or ''


def _get_pro():
    """获取 Tushare Pro API 实例（缓存）"""
    global _TUSHARE_PRO
    if _TUSHARE_PRO:
        return _TUSHARE_PRO
    token = _get_token()
    if not token:
        return None
    try:
        import tushare as ts
        ts.set_token(token)
        _TUSHARE_PRO = ts.pro_api()
        return _TUSHARE_PRO
    except Exception as e:
        logger.error("初始化 Tushare Pro 失败: %s", e)
        return None


def is_available() -> bool:
    """检查 Tushare 是否可用（有 Token）"""
    return bool(_get_token())


def save_token(token: str) -> bool:
    """保存 Tushare Token"""
    try:
        config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
        os.makedirs(config_dir, exist_ok=True)
        config_path = os.path.join(config_dir, 'tushare_config.json')
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump({'token': token}, f)
        global _TUSHARE_TOKEN, _TUSHARE_PRO
        _TUSHARE_TOKEN = token
        _TUSHARE_PRO = None  # 重置 Pro 实例
        logger.info("Tushare Token 已保存")
        return True
    except Exception as e:
        logger.error("保存 Tushare Token 失败: %s", e)
        return False


def _make_aid(source_id: str, unique_key: str) -> str:
    """生成唯一 aid"""
    h = hashlib.md5(f"{source_id}:{unique_key}".encode()).hexdigest()[:12]
    return f"{source_id}_{h}"


class TushareSource:
    """Tushare 独立数据源

    权限自适应：首次启动时探测可用接口，后续只调用有权限的接口。
    """

    # 可探测的接口列表（按权限从低到高）
    _DETECTABLE_APIS = [
        ('daily', '日线行情', '免费'),
        ('news', '财经新闻', '高积分'),
        ('moneyflow', '资金流向', '高积分'),
        ('top_list', '龙虎榜', '高积分'),
        ('kpl_list', '涨停板', '高积分'),
    ]

    def __init__(self, dispatch_callback: Callable[[Dict], None],
                 seen_ids: set,
                 source_id: str = "tushare"):
        self._dispatch = dispatch_callback
        self._seen_ids = seen_ids
        self._seen_ids_lock = threading.Lock()
        self._source_id = source_id

        # 权限探测结果
        self._available_apis: List[str] = []
        self._permission_detected = False

        # 最近标题列表（用于模糊去重）
        self._recent_titles: List[str] = []

        # 上次扫描日期（日线异动每日只扫一次）
        self._last_scan_date: Optional[str] = None

    def _detect_permissions(self):
        """探测 Token 权限，确定可用接口"""
        pro = _get_pro()
        if not pro:
            logger.warning("Tushare: Token 未配置，跳过权限探测")
            return

        self._available_apis = []
        for api_name, desc, level in self._DETECTABLE_APIS:
            try:
                # 用最小参数测试
                if api_name == 'daily':
                    today = datetime.now().strftime('%Y%m%d')
                    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y%m%d')
                    pro.daily(ts_code='000001.SZ', start_date=yesterday, end_date=today)
                elif api_name == 'news':
                    pro.news(src='sina', start_date=datetime.now().strftime('%Y%m%d'), limit=1)
                elif api_name == 'moneyflow':
                    pro.moneyflow(ts_code='000001.SZ', start_date=datetime.now().strftime('%Y%m%d'), limit=1)
                elif api_name == 'top_list':
                    pro.top_list(trade_date=(datetime.now() - timedelta(days=1)).strftime('%Y%m%d'))
                elif api_name == 'kpl_list':
                    pro.kpl_list(trade_date=(datetime.now() - timedelta(days=1)).strftime('%Y%m%d'))

                self._available_apis.append(api_name)
                logger.info("Tushare: %s (%s) 接口可用", api_name, desc)
            except Exception as e:
                err = str(e)[:80]
                logger.info("Tushare: %s (%s) 接口无权限: %s", api_name, desc, err)

        self._permission_detected = True
        logger.info("Tushare: 权限探测完成，可用接口 %d 个: %s",
                    len(self._available_apis), ', '.join(self._available_apis))

    def fetch_all(self):
        """轮询入口"""
        token = _get_token()
        if not token:
            return

        # 首次启动探测权限
        if not self._permission_detected:
            self._detect_permissions()

        if not self._available_apis:
            logger.warning("Tushare: 无可用接口，跳过")
            return

        # 按接口分发
        for api_name in self._available_apis:
            try:
                if api_name == 'daily':
                    self._scan_daily_anomaly()
                elif api_name == 'news':
                    self._fetch_news()
                elif api_name == 'moneyflow':
                    self._fetch_moneyflow()
                elif api_name == 'top_list':
                    self._fetch_top_list()
                elif api_name == 'kpl_list':
                    self._fetch_kpl_list()
            except Exception as e:
                logger.error("Tushare %s 获取失败: %s", api_name, e)

    def _scan_daily_anomaly(self):
        """日线异动扫描（每日收盘后扫描一次）"""
        today = datetime.now().strftime('%Y%m%d')
        if self._last_scan_date == today:
            return  # 今日已扫描

        # 只在 15:00 后扫描
        now = datetime.now()
        if now.hour < 15:
            return

        pro = _get_pro()
        if not pro:
            return

        try:
            yesterday = (now - timedelta(days=1)).strftime('%Y%m%d')
            df = pro.daily(trade_date=yesterday)
            if df is None or df.empty:
                return

            # 筛选异动：涨停(>=9.8%) 或 跌停(<=-9.8%) 或 大幅波动(>=5%)
            anomalies = df[
                (df['pct_chg'].abs() >= 5) &
                (df['vol'] > 0)
            ].sort_values('pct_chg', ascending=False).head(20)

            for _, row in anomalies.iterrows():
                ts_code = str(row.get('ts_code', ''))
                name = ts_code
                pct = float(row.get('pct_chg', 0))
                close = float(row.get('close', 0))

                # 涨停/跌停判断
                if pct >= 9.8:
                    tag = "涨停"
                elif pct <= -9.8:
                    tag = "跌停"
                elif pct >= 5:
                    tag = "大涨"
                else:
                    tag = "大跌"

                title = f"[{tag}] {name}({ts_code}) {pct:+.2f}% 收盘价:{close:.2f}"
                self._dispatch_with_dedup({
                    'title': title,
                    'content': f"代码: {ts_code}\n涨跌幅: {pct:+.2f}%\n收盘价: {close:.2f}\n成交量: {row.get('vol', 0)}",
                    'comefrom': 'Tushare·日线异动',
                    'ctime': int(time.time()),
                    'ptime': now.strftime('%H:%M:%S'),
                    'source_detail': f'Tushare·{tag}',
                    'stocks': [{'name': name, 'rise': f'{pct:+.2f}%'}],
                })

            self._last_scan_date = today
            logger.info("Tushare: 日线异动扫描完成，发现 %d 条", len(anomalies))
        except Exception as e:
            logger.error("Tushare 日线异动扫描失败: %s", e)

    def _fetch_news(self):
        """获取财经新闻"""
        pro = _get_pro()
        if not pro:
            return

        try:
            df = pro.news(src='sina', start_date=datetime.now().strftime('%Y%m%d'))
            if df is None or df.empty:
                return

            for _, row in df.iterrows():
                title = str(row.get('title', '')).strip()
                content = str(row.get('content', '')).strip()
                pub_time = str(row.get('datetime', ''))
                if not title:
                    continue

                ctime = int(time.time())
                ptime = pub_time[11:19] if len(pub_time) > 19 else datetime.now().strftime('%H:%M:%S')
                try:
                    dt = datetime.strptime(pub_time[:19], '%Y-%m-%d %H:%M:%S')
                    ctime = int(dt.timestamp())
                except Exception:
                    pass

                self._dispatch_with_dedup({
                    'title': title,
                    'content': content[:500],
                    'comefrom': 'Tushare·财经新闻',
                    'ctime': ctime,
                    'ptime': ptime,
                    'source_detail': 'Tushare·新浪',
                })
        except Exception as e:
            logger.error("Tushare 新闻获取失败: %s", e)

    def _fetch_moneyflow(self):
        """获取个股资金流向（当日涨幅前10）"""
        pro = _get_pro()
        if not pro:
            return

        try:
            today = datetime.now().strftime('%Y%m%d')
            df = pro.moneyflow(trade_date=today)
            if df is None or df.empty:
                return

            # 取净流入前10
            if 'net_amount' in df.columns:
                top = df.nlargest(10, 'net_amount')
            elif 'net_mf_amount' in df.columns:
                top = df.nlargest(10, 'net_mf_amount')
            else:
                return

            for _, row in top.iterrows():
                ts_code = str(row.get('ts_code', ''))
                net = float(row.get('net_amount', row.get('net_mf_amount', 0)))
                title = f"[资金流入] {ts_code} 净流入 {net/10000:.2f}万"
                self._dispatch_with_dedup({
                    'title': title,
                    'content': f"代码: {ts_code}\n净流入: {net/10000:.2f}万",
                    'comefrom': 'Tushare·资金流向',
                    'ctime': int(time.time()),
                    'ptime': datetime.now().strftime('%H:%M:%S'),
                    'source_detail': 'Tushare·资金',
                })
        except Exception as e:
            logger.error("Tushare 资金流向获取失败: %s", e)

    def _fetch_top_list(self):
        """获取龙虎榜数据"""
        pro = _get_pro()
        if not pro:
            return

        try:
            trade_date = (datetime.now() - timedelta(days=1)).strftime('%Y%m%d')
            df = pro.top_list(trade_date=trade_date)
            if df is None or df.empty:
                return

            for _, row in df.iterrows():
                ts_code = str(row.get('ts_code', ''))
                name = str(row.get('name', ''))
                reason = str(row.get('reason', ''))
                net = float(row.get('net_amount', 0))
                title = f"[龙虎榜] {name}({ts_code}) {reason}"
                self._dispatch_with_dedup({
                    'title': title,
                    'content': f"代码: {ts_code}\n名称: {name}\n上榜原因: {reason}\n净买入: {net/10000:.2f}万",
                    'comefrom': 'Tushare·龙虎榜',
                    'ctime': int(time.time()),
                    'ptime': datetime.now().strftime('%H:%M:%S'),
                    'source_detail': 'Tushare·龙虎榜',
                    'stocks': [{'name': name, 'rise': ''}],
                })
        except Exception as e:
            logger.error("Tushare 龙虎榜获取失败: %s", e)

    def _fetch_kpl_list(self):
        """获取涨停板数据"""
        pro = _get_pro()
        if not pro:
            return

        try:
            trade_date = (datetime.now() - timedelta(days=1)).strftime('%Y%m%d')
            df = pro.kpl_list(trade_date=trade_date)
            if df is None or df.empty:
                return

            for _, row in df.iterrows():
                ts_code = str(row.get('ts_code', ''))
                name = str(row.get('name', ''))
                reason = str(row.get('reason', ''))
                title = f"[涨停板] {name}({ts_code}) {reason}"
                self._dispatch_with_dedup({
                    'title': title,
                    'content': f"代码: {ts_code}\n名称: {name}\n涨停原因: {reason}",
                    'comefrom': 'Tushare·涨停板',
                    'ctime': int(time.time()),
                    'ptime': datetime.now().strftime('%H:%M:%S'),
                    'source_detail': 'Tushare·涨停',
                    'stocks': [{'name': name, 'rise': '+10%'}],
                })
        except Exception as e:
            logger.error("Tushare 涨停板获取失败: %s", e)

    def _dispatch_with_dedup(self, msg: Dict):
        """去重后分发"""
        title = msg.get('title', '')
        if not title:
            return

        with self._seen_ids_lock:
            dedup_key = title[:100]
            if dedup_key in self._seen_ids:
                return
            self._seen_ids.add(dedup_key)
            self._recent_titles.append(title)
            if len(self._recent_titles) > 100:
                self._recent_titles = self._recent_titles[-100:]

        msg['aid'] = _make_aid(self._source_id, dedup_key)
        self._dispatch(msg)

    def test_connection(self) -> Dict:
        """测试 Tushare 连接"""
        token = _get_token()
        if not token:
            return {"success": False, "message": "未配置 Token"}

        try:
            pro = _get_pro()
            if not pro:
                return {"success": False, "message": "初始化 Tushare Pro 失败"}

            # 测试免费接口
            df = pro.stock_basic()
            if df is not None:
                return {"success": True, "message": f"连接成功，返回 {len(df)} 条股票基础数据"}
            return {"success": False, "message": "API 返回空数据"}
        except Exception as e:
            err = str(e)
            if '权限' in err or 'permission' in err.lower():
                return {"success": False, "message": f"Token 有效但权限不足: {err[:80]}"}
            return {"success": False, "message": f"测试失败: {err[:80]}"}

    def stop(self):
        """停止数据源"""
        logger.info("Tushare 数据源已停止")

    def get_available_apis(self) -> List[str]:
        """获取当前可用的接口列表"""
        if not self._permission_detected:
            self._detect_permissions()
        return self._available_apis.copy()
