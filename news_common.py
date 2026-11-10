"""数据源共享工具（审计 P3：_make_aid 原四份逐字重复，收口一处）。

使用方（akshare_source / wind_source / tushare_source / data_source_manager）以
`from news_common import make_aid as _make_aid` 引用，调用点名称不变。
"""

import hashlib


def make_aid(source_id: str, unique_key: str) -> str:
    """生成唯一 aid（md5 截 12 位），跨数据源共享实现，避免 aid 冲突"""
    h = hashlib.md5(f"{source_id}:{unique_key}".encode()).hexdigest()[:12]
    return f"{source_id}_{h}"
