# -*- coding: utf-8 -*-
"""
延时推送队列：集中到达的外网资讯先缓存到本地队列，再按 10-20 秒随机间隔逐条推送，
避免语音播报连续跳过多条新闻。

从 data_source_manager.py 抽离（结构性重构任务 5），逻辑逐字保留。
推送出口与运行标志以构造注入方式传入，避免反向 import 造成循环依赖。
"""

import logging
import random
import threading
import time

logger = logging.getLogger(__name__)


class DelayedPushQueue:
    """延时推送队列（队列满时丢弃最旧消息，防止集中推送积压）。"""

    MIN_DELAY_INTERVAL = 10
    MAX_DELAY_INTERVAL = 20
    MAX_QUEUE = 15

    def __init__(self, dispatch, is_running):
        """
        :param dispatch: 消息推送出口，签名 dispatch(message: dict)
        :param is_running: 运行标志回调，签名 is_running() -> bool
        """
        self._dispatch = dispatch
        self._is_running = is_running
        self._queue = []
        self._lock = threading.Lock()
        self._thread = None

    def start(self):
        """启动延时推送线程"""
        if self._thread and self._thread.is_alive():
            return

        def run():
            logger.info("延时推送线程已启动，消息间隔 %d-%d 秒", self.MIN_DELAY_INTERVAL, self.MAX_DELAY_INTERVAL)
            while self._is_running():
                self._process()
                time.sleep(1)

        self._thread = threading.Thread(target=run, daemon=True, name="delay_push")
        self._thread.start()

    def stop(self):
        """停止延时推送线程"""
        if self._thread and self._thread.is_alive():
            logger.info("延时推送线程正在停止...")
            self._thread.join(timeout=5)
            if self._thread.is_alive():
                logger.warning("延时推送线程强制终止")
            else:
                logger.info("延时推送线程已停止")
            self._thread = None

    def enqueue(self, message):
        """将消息加入延时推送队列"""
        with self._lock:
            if len(self._queue) >= self.MAX_QUEUE:
                dropped = self._queue.pop(0)
                logger.debug("延时推送队列已满，丢弃最旧消息: %s", dropped.get("title", "")[:40])
            self._queue.append(message)
            logger.debug("消息加入延时推送队列，当前队列长度: %d", len(self._queue))

    def _process(self):
        """处理延时推送队列，按10-20秒间隔推送消息"""
        with self._lock:
            if not self._queue:
                return
            message = self._queue.pop(0)

        try:
            self._dispatch(message)
            count = len(self._queue)
            if count > 0:
                delay = random.randint(self.MIN_DELAY_INTERVAL, self.MAX_DELAY_INTERVAL)
                logger.info(f"延时推送: 已推送1条，队列剩余{count}条，下次推送等待{delay}秒")
                for _ in range(delay):
                    if not self._is_running():
                        return
                    time.sleep(1)
        except Exception as e:
            logger.error(f"延时推送处理失败: {e}")
