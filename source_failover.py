# -*- coding: utf-8 -*-
"""
多源降级策略 — 自动检测数据源可用性，失败自动切换

降级链：AKShare → Tushare → efinance
"""

import time
import logging
import threading
from typing import Dict, List, Optional, Callable

logger = logging.getLogger(__name__)

# 降级链配置
_SOURCE_CHAIN = {
    "cls_telegraph": ["akshare", "tushare", "efinance"],
    "wallstreet": ["akshare", "tushare"],
    "eastmoney_news": ["akshare", "efinance"],
    "ths_news": ["akshare", "tushare"],
    "cctv_news": ["akshare"],
    "stock_news": ["akshare", "efinance"],
}

# 冷却时间（秒）
_COOLDOWN_DURATION = 300
# 失败阈值
_MAX_FAILURES = 3


class SourceFailover:
    """多数据源降级管理器"""

    def __init__(self):
        self._failure_count: Dict[str, int] = {}
        self._cooldown_until: Dict[str, float] = {}
        self._lock = threading.Lock()

    def get_available_source(self, data_type: str) -> Optional[str]:
        """获取当前可用的数据源
        
        Args:
            data_type: 数据类型，如 'cls_telegraph', 'wallstreet' 等
            
        Returns:
            可用的数据源名称，如 'akshare', 'tushare', 'efinance'
        """
        chain = _SOURCE_CHAIN.get(data_type, [])
        with self._lock:
            for source in chain:
                if self._is_available(source):
                    return source
        return None

    def record_success(self, source: str):
        """记录成功，重置失败计数"""
        with self._lock:
            self._failure_count[source] = 0
            self._cooldown_until.pop(source, None)

    def record_failure(self, source: str):
        """记录失败，超过阈值进入冷却"""
        with self._lock:
            self._failure_count[source] = self._failure_count.get(source, 0) + 1
            count = self._failure_count[source]

            if count >= _MAX_FAILURES:
                self._cooldown_until[source] = time.time() + _COOLDOWN_DURATION
                logger.warning(
                    "数据源 %s 失败 %d 次，进入冷却 %d 秒",
                    source, count, _COOLDOWN_DURATION
                )

    def _is_available(self, source: str) -> bool:
        """检查数据源是否可用（非冷却状态）"""
        cooldown = self._cooldown_until.get(source, 0)
        if time.time() < cooldown:
            return False
        return True

    def get_status(self) -> Dict:
        """获取所有数据源状态"""
        with self._lock:
            status = {}
            now = time.time()
            for source in set(list(self._failure_count.keys()) + list(self._cooldown_until.keys())):
                status[source] = {
                    "failures": self._failure_count.get(source, 0),
                    "in_cooldown": now < self._cooldown_until.get(source, 0),
                    "cooldown_remaining": max(0, int(self._cooldown_until.get(source, 0) - now)),
                }
            return status

    def reset(self):
        """重置所有状态"""
        with self._lock:
            self._failure_count.clear()
            self._cooldown_until.clear()
            logger.info("降级管理器状态已重置")


# 全局单例
_failover = SourceFailover()


def get_failover() -> SourceFailover:
    """获取全局降级管理器实例"""
    return _failover
