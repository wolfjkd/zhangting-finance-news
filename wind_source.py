# -*- coding: utf-8 -*-
"""
Wind 独立数据源 — MCP 协议直连 + 4 模块独立轮询

功能：
- 财经新闻 RAG 搜索（用户自定义关键词）
- 上市公司公告订阅
- 宏观经济指标推送
- A股异动行情（可选）
- 本地日额度管理
- 配置文件：%APPDATA%/ZTFINews/wind_config.json

MCP 协议：JSON-RPC 2.0 over HTTP
端点：https://mcp.wind.com.cn/vserver_<server_type>/mcp/
"""

import hashlib
import time
import logging
import os
import json
import threading
import re
from typing import Callable, Dict, List, Optional
from datetime import datetime, timedelta

import requests

logger = logging.getLogger(__name__)

# ===== HTTP Session（直连，不走系统代理）=====
_http = requests.Session()
_http.trust_env = False
_http.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
})

# ===== Wind MCP 端点 =====
_WIND_BASE_URL = 'https://mcp.wind.com.cn'
_WIND_SERVERS = {
    'stock_data': f'{_WIND_BASE_URL}/vserver_stock_data/mcp/',
    'global_stock_data': f'{_WIND_BASE_URL}/vserver_global_stock_data/mcp/',
    'fund_data': f'{_WIND_BASE_URL}/vserver_fund_data/mcp/',
    'index_data': f'{_WIND_BASE_URL}/vserver_index_data/mcp/',
    'bond_data': f'{_WIND_BASE_URL}/vserver_bond_data/mcp/',
    'financial_docs': f'{_WIND_BASE_URL}/vserver_financial_docs/mcp/',
    'economic_data': f'{_WIND_BASE_URL}/vserver_economic_data/mcp/',
    'analytics_data': f'{_WIND_BASE_URL}/vserver_analytics_data/mcp/',
}

# 默认配置
_DEFAULT_CONFIG = {
    "api_key": "",
    "modules": {
        "news": {
            "enabled": False,
            "keywords": [],
            "poll_interval": 120,
            "top_k": 5
        },
        "announcements": {
            "enabled": False,
            "types": ["定报", "重大事项", "分红", "增发", "业绩预告"],
            "watch_stocks": [],
            "poll_interval": 300
        },
        "macro": {
            "enabled": False,
            "indicators": ["CPI", "PPI", "PMI", "社融"],
            "poll_interval": 600
        }
    },
    "daily_quota_used": 0,
    "daily_quota_date": ""
}

# 日额度上限（保守估计）
_DAILY_QUOTA_LIMIT = 500


def _get_config_path() -> str:
    """获取 Wind 配置文件路径"""
    config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
    os.makedirs(config_dir, exist_ok=True)
    return os.path.join(config_dir, 'wind_config.json')


def load_wind_config() -> Dict:
    """加载 Wind 配置"""
    config_path = _get_config_path()
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                # 合并默认值
                result = _DEFAULT_CONFIG.copy()
                result.update(config)
                if 'modules' not in result:
                    result['modules'] = _DEFAULT_CONFIG['modules'].copy()
                else:
                    for mod_key, mod_default in _DEFAULT_CONFIG['modules'].items():
                        if mod_key not in result['modules']:
                            result['modules'][mod_key] = mod_default.copy()
                return result
        except Exception as e:
            logger.error("加载 Wind 配置失败: %s", e)
    return _DEFAULT_CONFIG.copy()


def save_wind_config(config: Dict) -> bool:
    """保存 Wind 配置"""
    try:
        config_path = _get_config_path()
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        logger.info("Wind 配置已保存")
        return True
    except Exception as e:
        logger.error("保存 Wind 配置失败: %s", e)
        return False


def _make_aid(source_id: str, unique_key: str) -> str:
    """生成唯一 aid"""
    h = hashlib.md5(f"{source_id}:{unique_key}".encode()).hexdigest()[:12]
    return f"{source_id}_{h}"


def _parse_sse(text: str) -> Dict:
    """解析 SSE 格式的响应"""
    # 查找 "data: " 行
    for line in text.split('\n'):
        line = line.strip()
        if line.startswith('data:'):
            json_str = line[5:].strip()
            if json_str:
                return json.loads(json_str)
    # 如果没有 SSE 格式，尝试直接解析 JSON
    try:
        return json.loads(text)
    except Exception:
        raise ValueError(f"无法解析响应: {text[:200]}")


class WindSource:
    """Wind 独立数据源

    通过 MCP 协议（JSON-RPC 2.0）直连 Wind 后端。
    支持 4 个独立模块：财经新闻、上市公司公告、宏观经济、A股异动。
    """

    def __init__(self, dispatch_callback: Callable[[Dict], None],
                 seen_ids: set,
                 source_id: str = "wind"):
        self._dispatch = dispatch_callback
        self._seen_ids = seen_ids
        self._seen_ids_lock = threading.Lock()
        self._source_id = source_id
        self._config = load_wind_config()

        # 最近标题列表（用于模糊去重）
        self._recent_titles: List[str] = []

        # 宏观指标上次值（避免重复推送相同数据）
        self._macro_last_values: Dict[str, str] = {}

        # 模块轮询计数器
        self._poll_counter = 0

    def _get_api_key(self) -> str:
        """获取 API Key"""
        return self._config.get('api_key', '') or load_wind_config().get('api_key', '')

    def _check_quota(self) -> bool:
        """检查日额度"""
        today = datetime.now().strftime('%Y-%m-%d')
        quota_date = self._config.get('daily_quota_date', '')
        if quota_date != today:
            # 新的一天，重置额度
            self._config['daily_quota_date'] = today
            self._config['daily_quota_used'] = 0
            save_wind_config(self._config)

        used = self._config.get('daily_quota_used', 0)
        if used >= _DAILY_QUOTA_LIMIT:
            logger.warning("Wind: 日额度已用尽 (%d/%d)", used, _DAILY_QUOTA_LIMIT)
            return False
        return True

    def _increment_quota(self, count: int = 1):
        """增加额度使用计数"""
        self._config['daily_quota_used'] = self._config.get('daily_quota_used', 0) + count
        save_wind_config(self._config)

    def _mcp_call(self, server_type: str, method: str, params: Dict, timeout: int = 30) -> Optional[Dict]:
        """调用 Wind MCP 接口

        Args:
            server_type: 服务器类型（stock_data/financial_docs/economic_data 等）
            method: MCP 方法名（initialize/tools/call）
            params: 方法参数
            timeout: 超时秒数

        Returns:
            MCP 响应结果，失败返回 None
        """
        api_key = self._get_api_key()
        if not api_key:
            logger.warning("Wind: API Key 未配置")
            return None

        endpoint = _WIND_SERVERS.get(server_type)
        if not endpoint:
            logger.error("Wind: 未知 server_type: %s", server_type)
            return None

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
        }

        body = json.dumps({
            'jsonrpc': '2.0',
            'id': int(time.time() * 1000),
            'method': method,
            'params': params,
        })

        try:
            resp = _http.post(endpoint, headers=headers, data=body, timeout=timeout)
            if resp.status_code != 200:
                logger.error("Wind MCP 调用失败: HTTP %d, server=%s", resp.status_code, server_type)
                return None

            payload = _parse_sse(resp.text)
            if payload.get('error'):
                logger.error("Wind MCP 错误: %s, server=%s", payload['error'], server_type)
                return None

            return payload.get('result')
        except Exception as e:
            logger.error("Wind MCP 调用异常: %s, server=%s", e, server_type)
            return None

    def _mcp_initialize_and_call(self, server_type: str, tool_name: str, tool_params: Dict) -> Optional[Dict]:
        """初始化 MCP 连接并调用工具"""
        # 1. 发送 initialize
        init_result = self._mcp_call(server_type, 'initialize', {
            'protocolVersion': '2025-03-26',
            'capabilities': {},
            'clientInfo': {'name': 'ztfi-news', 'version': '4.0.0'},
        }, timeout=15)

        if init_result is None:
            return None

        # 2. 调用工具
        return self._mcp_call(server_type, 'tools/call', {
            'name': tool_name,
            'arguments': tool_params,
        }, timeout=60)

    def fetch_all(self):
        """轮询入口"""
        api_key = self._get_api_key()
        if not api_key:
            return

        if not self._check_quota():
            return

        self._poll_counter += 1
        config = self._config.get('modules', {})

        # 模块1：财经新闻 RAG
        news_cfg = config.get('news', {})
        if news_cfg.get('enabled') and news_cfg.get('keywords'):
            self._fetch_news_rag(news_cfg)

        # 模块2：上市公司公告
        ann_cfg = config.get('announcements', {})
        if ann_cfg.get('enabled'):
            # 每 5 轮抓取一次（公告不需要太频繁）
            if self._poll_counter % 5 == 0:
                self._fetch_announcements(ann_cfg)

        # 模块3：宏观经济指标
        macro_cfg = config.get('macro', {})
        if macro_cfg.get('enabled'):
            # 每 10 轮抓取一次（宏观数据更新慢）
            if self._poll_counter % 10 == 0:
                self._fetch_macro_indicators(macro_cfg)

    def _fetch_news_rag(self, cfg: Dict):
        """财经新闻 RAG 搜索"""
        keywords = cfg.get('keywords', [])
        top_k = cfg.get('top_k', 5)

        for keyword in keywords:
            if not self._check_quota():
                break

            try:
                result = self._mcp_initialize_and_call(
                    'financial_docs',
                    'get_financial_news',
                    {'query': keyword, 'top_k': top_k}
                )

                if not result:
                    continue

                self._increment_quota(1)

                # 解析结果
                content = result.get('content', [])
                if not content:
                    continue

                for item in content:
                    text = item.get('text', '')
                    if not text:
                        continue

                    # 尝试解析 JSON
                    try:
                        news_data = json.loads(text)
                        if isinstance(news_data, list):
                            for news_item in news_data:
                                self._dispatch_news_item(news_item, keyword)
                        elif isinstance(news_data, dict):
                            self._dispatch_news_item(news_data, keyword)
                    except Exception:
                        # 纯文本，直接作为一条消息
                        title = text[:100].split('\n')[0]
                        self._dispatch_with_dedup({
                            'title': f"[Wind·{keyword}] {title}",
                            'content': text[:500],
                            'comefrom': f'Wind·财经新闻',
                            'ctime': int(time.time()),
                            'ptime': datetime.now().strftime('%H:%M:%S'),
                            'source_detail': f'Wind·{keyword}',
                        })

            except Exception as e:
                logger.error("Wind 新闻 RAG 获取失败 (关键词=%s): %s", keyword, e)

    def _dispatch_news_item(self, news_item: Dict, keyword: str):
        """分发单条新闻"""
        title = str(news_item.get('title', news_item.get('Title', ''))).strip()
        content = str(news_item.get('content', news_item.get('Content', news_item.get('summary', '')))).strip()
        pub_time = str(news_item.get('datetime', news_item.get('pub_time', news_item.get('date', ''))))
        source = str(news_item.get('source', news_item.get('Source', 'Wind')))

        if not title:
            return

        ctime = int(time.time())
        ptime = datetime.now().strftime('%H:%M:%S')
        try:
            # 尝试解析时间
            for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y/%m/%d %H:%M:%S']:
                try:
                    dt = datetime.strptime(pub_time[:19], fmt)
                    ctime = int(dt.timestamp())
                    ptime = pub_time[11:19]
                    break
                except Exception:
                    continue
        except Exception:
            pass

        self._dispatch_with_dedup({
            'title': title,
            'content': content[:500],
            'comefrom': f'Wind·财经新闻',
            'ctime': ctime,
            'ptime': ptime,
            'source_detail': f'Wind·{keyword}·{source}',
        })

    def _fetch_announcements(self, cfg: Dict):
        """上市公司公告"""
        types = cfg.get('types', ['定报', '重大事项'])
        watch_stocks = cfg.get('watch_stocks', [])

        # 构建查询关键词
        if watch_stocks:
            query = ' '.join(watch_stocks[:5])  # 最多5只
        else:
            query = ' '.join(types)

        if not self._check_quota():
            return

        try:
            result = self._mcp_initialize_and_call(
                'financial_docs',
                'get_company_announcements',
                {'query': query, 'top_k': 10}
            )

            if not result:
                return

            self._increment_quota(1)

            content = result.get('content', [])
            for item in content:
                text = item.get('text', '')
                if not text:
                    continue

                try:
                    ann_data = json.loads(text)
                    if isinstance(ann_data, list):
                        for ann in ann_data:
                            self._dispatch_announcement(ann)
                    elif isinstance(ann_data, dict):
                        self._dispatch_announcement(ann_data)
                except Exception:
                    title = text[:100].split('\n')[0]
                    self._dispatch_with_dedup({
                        'title': f"[Wind·公告] {title}",
                        'content': text[:500],
                        'comefrom': 'Wind·上市公司公告',
                        'ctime': int(time.time()),
                        'ptime': datetime.now().strftime('%H:%M:%S'),
                        'source_detail': 'Wind·公告',
                    })

        except Exception as e:
            logger.error("Wind 公告获取失败: %s", e)

    def _dispatch_announcement(self, ann: Dict):
        """分发单条公告"""
        title = str(ann.get('title', ann.get('Title', ''))).strip()
        content = str(ann.get('content', ann.get('Content', ann.get('summary', '')))).strip()
        code = str(ann.get('code', ann.get('Code', ann.get('windcode', ''))))
        name = str(ann.get('name', ann.get('Name', '')))
        ann_type = str(ann.get('type', ann.get('Type', '公告')))
        pub_date = str(ann.get('date', ann.get('datetime', ann.get('pub_time', ''))))

        if not title:
            return

        display = f"[{name}({code}) {ann_type}] {title}" if name else title

        ctime = int(time.time())
        ptime = datetime.now().strftime('%H:%M:%S')
        try:
            for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%Y%m%d']:
                try:
                    dt = datetime.strptime(pub_date[:10] if len(pub_date) >= 10 else pub_date, fmt[:len(pub_date)] if len(pub_date) < len(fmt) else fmt)
                    ctime = int(dt.timestamp())
                    if len(pub_date) > 10:
                        ptime = pub_date[11:19]
                    break
                except Exception:
                    continue
        except Exception:
            pass

        self._dispatch_with_dedup({
            'title': display,
            'content': content[:500],
            'comefrom': 'Wind·上市公司公告',
            'ctime': ctime,
            'ptime': ptime,
            'source_detail': f'Wind·{ann_type}',
            'stocks': [{'name': name, 'rise': ''}] if name else [],
        })

    def _fetch_macro_indicators(self, cfg: Dict):
        """宏观经济指标推送"""
        indicators = cfg.get('indicators', [])

        for indicator in indicators:
            if not self._check_quota():
                break

            try:
                result = self._mcp_initialize_and_call(
                    'economic_data',
                    'get_economic_data',
                    {
                        'metricIdsStr': indicator,
                        'freq': '月',
                        'beginDate': (datetime.now() - timedelta(days=90)).strftime('%Y%m%d'),
                        'endDate': datetime.now().strftime('%Y%m%d'),
                    }
                )

                if not result:
                    continue

                self._increment_quota(1)

                content = result.get('content', [])
                for item in content:
                    text = item.get('text', '')
                    if not text:
                        continue

                    try:
                        macro_data = json.loads(text)
                        if isinstance(macro_data, list):
                            for m in macro_data:
                                self._dispatch_macro_item(m, indicator)
                        elif isinstance(macro_data, dict):
                            self._dispatch_macro_item(macro_data, indicator)
                    except Exception:
                        # 纯文本
                        last_val = self._macro_last_values.get(indicator, '')
                        if text != last_val:
                            self._macro_last_values[indicator] = text
                            self._dispatch_with_dedup({
                                'title': f"[Wind·宏观] {indicator}",
                                'content': text[:500],
                                'comefrom': 'Wind·宏观经济',
                                'ctime': int(time.time()),
                                'ptime': datetime.now().strftime('%H:%M:%S'),
                                'source_detail': f'Wind·{indicator}',
                            })

            except Exception as e:
                logger.error("Wind 宏观指标获取失败 (%s): %s", indicator, e)

    def _dispatch_macro_item(self, m: Dict, indicator: str):
        """分发单条宏观指标"""
        value = str(m.get('value', m.get('Value', m.get('data', ''))))
        date = str(m.get('date', m.get('Date', m.get('reportDate', ''))))
        unit = str(m.get('unit', m.get('Unit', '')))

        if not value:
            return

        # 去重：相同指标+相同值不重复推送
        dedup_key = f"{indicator}_{value}_{date}"
        if dedup_key in self._macro_last_values.values():
            return
        self._macro_last_values[indicator] = dedup_key

        title = f"[Wind·宏观] {indicator}: {value}{unit} ({date})"
        self._dispatch_with_dedup({
            'title': title,
            'content': f"指标: {indicator}\n数值: {value}{unit}\n日期: {date}",
            'comefrom': 'Wind·宏观经济',
            'ctime': int(time.time()),
            'ptime': datetime.now().strftime('%H:%M:%S'),
            'source_detail': f'Wind·{indicator}',
        })

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
        """测试 Wind 连接"""
        api_key = self._get_api_key()
        if not api_key:
            return {"success": False, "message": "未配置 API Key"}

        try:
            result = self._mcp_call('stock_data', 'initialize', {
                'protocolVersion': '2025-03-26',
                'capabilities': {},
                'clientInfo': {'name': 'ztfi-news', 'version': '4.0.0'},
            }, timeout=15)

            if result is not None:
                server_info = result.get('serverInfo', {})
                server_name = server_info.get('name', 'Wind MCP')
                return {"success": True, "message": f"连接成功（{server_name}）"}
            return {"success": False, "message": "MCP 响应异常"}
        except Exception as e:
            return {"success": False, "message": f"测试失败: {str(e)[:80]}"}

    def stop(self):
        """停止数据源"""
        logger.info("Wind 数据源已停止")

    def get_quota_status(self) -> Dict:
        """获取额度状态"""
        today = datetime.now().strftime('%Y-%m-%d')
        used = self._config.get('daily_quota_used', 0)
        return {
            "used": used,
            "limit": _DAILY_QUOTA_LIMIT,
            "remaining": max(0, _DAILY_QUOTA_LIMIT - used),
            "date": today,
        }
