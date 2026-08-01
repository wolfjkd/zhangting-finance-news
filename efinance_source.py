# -*- coding: utf-8 -*-
"""
efinance 备用数据源 — 专注东方财富数据，作为第二降级源

无需 Token，直接调用东方财富接口
"""

import hashlib
import time
import logging
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


def fetch_eastmoney_news() -> List[Dict]:
    """获取东方财富快讯（通过 efinance）"""
    try:
        import efinance as ef
        # efinance 获取新闻
        df = ef.stock.get_news_timely()
        if df is None or df.empty:
            return []
        messages = []
        for _, row in df.iterrows():
            title = str(row.get('title', row.get('新闻标题', ''))).strip()
            content = str(row.get('content', row.get('新闻内容', ''))).strip()
            pub_time = str(row.get('date', row.get('发布时间', '')))
            if not title:
                continue
            messages.append({
                'title': title,
                'content': content[:500],
                'comefrom': '涨停聚合（Beta）·efinance',
                'ctime': int(time.time()),
                'ptime': pub_time[11:19] if len(pub_time) > 19 else '',
                'source_detail': 'efinance',
            })
        logger.info("efinance: 获取 %d 条新闻", len(messages))
        return messages
    except Exception as e:
        logger.error("efinance 获取失败: %s", e)
        return []


def is_available() -> bool:
    """检查 efinance 是否可用"""
    try:
        import efinance
        return True
    except ImportError:
        return False
