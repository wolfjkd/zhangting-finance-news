# -*- coding: utf-8 -*-
"""
Edge TTS 语音引擎 — 基于微软 Edge 浏览器 TTS 服务

免费、高质量、支持多种中文音色
"""

import asyncio
import os
import tempfile
import hashlib
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Edge TTS 可用中文音色
EDGE_TTS_VOICES = {
    "zh-CN-YunyangNeural": {"name": "云扬（男）", "desc": "新闻播报风格"},
    "zh-CN-YunjianNeural": {"name": "云健（男）", "desc": "沉稳大气"},
    "zh-CN-YunxiaNeural": {"name": "云夏（男）", "desc": "年轻活力"},
    "zh-CN-XiaoxiaoNeural": {"name": "晓晓（女）", "desc": "温柔清晰"},
    "zh-CN-XiaoyiNeural": {"name": "晓伊（女）", "desc": "活泼俏皮"},
    "zh-CN-liaoning-XiaobeiNeural": {"name": "晓北（女·东北）", "desc": "东北口音"},
    "zh-CN-shaanxi-XiaoniNeural": {"name": "晓妮（女·陕西）", "desc": "陕西口音"},
}


class EdgeTTSEngine:
    """Edge TTS 语音合成引擎"""

    def __init__(self):
        self._temp_dir = os.path.join(tempfile.gettempdir(), 'ztfi_tts')
        os.makedirs(self._temp_dir, exist_ok=True)
        self._cache = {}  # 简单缓存：text_hash → file_path
        self._max_cache = 50

    def synthesize(self, text: str, voice: str = "zh-CN-YunyangNeural",
                   rate: str = "+0%", volume: str = "+0%") -> Optional[str]:
        """文本转语音，返回音频文件路径
        
        Args:
            text: 要合成的文本
            voice: 音色 ID（见 EDGE_TTS_VOICES）
            rate: 语速，如 "+0%", "+20%", "-10%"
            volume: 音量，如 "+0%", "+50%"
            
        Returns:
            音频文件路径，失败返回 None
        """
        if not text or not text.strip():
            return None

        # 检查缓存
        cache_key = hashlib.md5(f"{text}:{voice}:{rate}".encode()).hexdigest()
        if cache_key in self._cache:
            cached_path = self._cache[cache_key]
            if os.path.exists(cached_path):
                return cached_path

        # 生成音频
        output_path = os.path.join(self._temp_dir, f"{cache_key}.mp3")

        try:
            import edge_tts

            async def _synthesize():
                communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume)
                await communicate.save(output_path)

            asyncio.run(_synthesize())

            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                # 更新缓存
                self._cache[cache_key] = output_path
                self._cleanup_cache()
                return output_path
            else:
                logger.warning("Edge TTS 生成空文件")
                return None

        except Exception as e:
            logger.error("Edge TTS 合成失败: %s", e)
            return None

    def get_voices(self) -> dict:
        """获取可用音色列表"""
        return EDGE_TTS_VOICES

    def _cleanup_cache(self):
        """清理过期缓存"""
        if len(self._cache) <= self._max_cache:
            return
        # 按修改时间排序，删除最旧的
        sorted_items = sorted(
            self._cache.items(),
            key=lambda x: os.path.getmtime(x[1]) if os.path.exists(x[1]) else 0
        )
        while len(self._cache) > self._max_cache // 2:
            key, path = sorted_items.pop(0)
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass
            self._cache.pop(key, None)

    def clear_cache(self):
        """清空所有缓存"""
        for path in self._cache.values():
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass
        self._cache.clear()
        logger.info("Edge TTS 缓存已清空")


# 全局单例
_engine = None


def get_engine() -> EdgeTTSEngine:
    """获取全局 TTS 引擎实例"""
    global _engine
    if _engine is None:
        _engine = EdgeTTSEngine()
    return _engine
