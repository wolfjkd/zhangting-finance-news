# -*- coding: utf-8 -*-
"""
翻译服务：多翻译源自动降级 + 限流冷却 + 结果缓存。

从 data_source_manager.py 抽离（结构性重构任务 4），逻辑逐字保留。
依赖以构造注入方式传入（HTTP 取数函数），避免反向 import 造成循环依赖。
"""

import hashlib
import logging
import time

logger = logging.getLogger(__name__)


class TranslationService:
    """英译中翻译服务：google → mymemory → libretranslate 逐级降级。

    - 翻译结果按 md5 缓存（超过 1000 条时截断保留最新 500 条）
    - 每个翻译源独立限流（最小调用间隔）与失败冷却（连续失败 3 次冷却 300 秒）
    - 翻译失败返回原文；translate_title_or_discard 在结果仍非中文时返回 None
    """

    def __init__(self, http_get, http_post):
        self._http_get = http_get
        self._http_post = http_post
        self._cache = {}
        self._status = {
            'google': {'last_call': 0, 'failures': 0, 'cooldown_until': 0},
            'mymemory': {'last_call': 0, 'failures': 0, 'cooldown_until': 0},
            'libretranslate': {'last_call': 0, 'failures': 0, 'cooldown_until': 0},
        }
        self._MIN_CALL_INTERVAL = 2.5
        self._MAX_FAILURES_BEFORE_COOLDOWN = 3
        self._COOLDOWN_DURATION = 300

    # ===== 限流与冷却 =====
    def _wait_translator_cooldown(self, translator_name):
        status = self._status[translator_name]
        now = time.time()
        if now < status['cooldown_until']:
            return False
        if now - status['last_call'] < self._MIN_CALL_INTERVAL:
            sleep_time = self._MIN_CALL_INTERVAL - (now - status['last_call'])
            time.sleep(sleep_time)
        status['last_call'] = time.time()
        return True

    def _record_translator_failure(self, translator_name):
        status = self._status[translator_name]
        status['failures'] += 1
        if status['failures'] >= self._MAX_FAILURES_BEFORE_COOLDOWN:
            status['cooldown_until'] = time.time() + self._COOLDOWN_DURATION
            logger.warning(f"翻译源 {translator_name} 连续失败{status['failures']}次，进入{self._COOLDOWN_DURATION}秒冷却")

    def _record_translator_success(self, translator_name):
        status = self._status[translator_name]
        status['failures'] = 0
        status['cooldown_until'] = 0

    @staticmethod
    def _contains_chinese(text: str) -> bool:
        """判断文本是否包含中文字符"""
        return any('一' <= ch <= '鿿' for ch in text)

    # ===== 对外接口 =====
    def translate_title_or_discard(self, title: str):
        """翻译标题；翻译失败（结果仍为英文）返回 None，调用方应丢弃该消息"""
        translated = self.translate_to_chinese(title)
        if translated and self._contains_chinese(translated):
            return translated
        return None

    def translate_to_chinese(self, text: str) -> str:
        if not text or not isinstance(text, str):
            return text

        text_key = hashlib.md5(text.encode()).hexdigest()
        if text_key in self._cache:
            cached = self._cache[text_key]
            if cached != text:
                return cached

        translators = [
            ('google', self._translate_google_unofficial),
            ('mymemory', self._translate_mymemory),
            ('libretranslate', self._translate_libretranslate),
        ]

        for name, translator in translators:
            try:
                if not self._wait_translator_cooldown(name):
                    continue
                result = translator(text)
                if result and result.strip() and result != text:
                    self._cache[text_key] = result
                    self._record_translator_success(name)
                    return result
                self._record_translator_failure(name)
            except Exception as e:
                logger.debug(f"翻译源 {name} 失败: {e}")
                self._record_translator_failure(name)

        if len(self._cache) > 1000:
            self._cache = dict(list(self._cache.items())[-500:])

        return text

    # ===== 翻译源实现 =====
    def _translate_google_unofficial(self, text: str) -> str:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "en",
            "tl": "zh-CN",
            "dt": "t",
            "q": text[:2000]
        }
        resp = self._http_get(url, params=params, timeout=15)
        if resp.status_code == 200:
            result = resp.json()
            if isinstance(result, list) and len(result) > 0 and isinstance(result[0], list):
                parts = [item[0] for item in result[0] if item[0]]
                translated = ''.join(parts)
                if translated and translated.strip():
                    return translated
        return text

    def _translate_mymemory(self, text: str) -> str:
        url = "https://api.mymemory.translated.net/get"
        params = {"q": text[:2000], "langpair": "en|zh-CN"}
        resp = self._http_get(url, params=params, timeout=10)
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
            "https://api.libretranslate.com",
        ]
        for base_url in endpoints:
            try:
                url = f"{base_url}/translate"
                data = {"q": text[:2000], "source": "en", "target": "zh"}
                resp = self._http_post(url, json=data, timeout=10)
                if resp.status_code == 200:
                    result = resp.json()
                    translated = result.get('translatedText', '')
                    if translated and translated.strip():
                        return translated
            except Exception:
                continue
        return text
