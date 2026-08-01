# -*- coding: utf-8 -*-
"""
涨停聚合（Beta）数据源 — 基于 AKShare 聚合多家财经资讯

数据源（7个子源，并发抓取）：
  实时源（每轮抓取）：
  1. 财联社电报     (stock_info_global_cls)
  2. 同花顺全球资讯  (stock_info_global_ths)
  3. 新浪财经       (stock_info_global_sina)
  4. 东方财富全球资讯 (stock_info_global_em)
  5. 华尔街见闻     (直连 HTTP)
  低频源（每5轮抓取一次，约200秒）：
  6. 央视新闻       (news_cctv)
  条件源：
  7. 东方财富个股资讯 (stock_news_em) — 需指定自选股代码

推送架构：
  并发抓取 → 统一推送队列（按时间排序） → 节奏释放线程（3-5秒/条）→ 前端

降级链：AKShare → Tushare → efinance
"""

import hashlib
import random
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# ===== AKShare 接口封装 =====

def _fetch_cls_telegraph() -> List[Dict]:
    """财联社全球资讯"""
    import akshare as ak
    try:
        df = ak.stock_info_global_cls()
        messages = []
        for _, row in df.iterrows():
            title = str(row.get('标题', '')).strip()
            content = str(row.get('内容', '')).strip()
            pub_date = str(row.get('发布日期', ''))
            pub_time = str(row.get('发布时间', ''))
            if not title:
                continue
            ctime = _parse_datetime(f"{pub_date} {pub_time}")
            messages.append({
                'title': title,
                'content': content,
                'comefrom': '涨停聚合·财联社',
                'ctime': ctime,
                'ptime': pub_time,
                'source_detail': '财联社电报',
            })
        logger.debug("AKShare 财联社: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("AKShare 财联社获取失败: %s", e)
        return []


def _fetch_ths_news() -> List[Dict]:
    """同花顺全球资讯"""
    import akshare as ak
    try:
        df = ak.stock_info_global_ths()
        messages = []
        for _, row in df.iterrows():
            title = str(row.get('标题', '')).strip()
            content = str(row.get('内容', '')).strip()
            pub_time = str(row.get('发布时间', ''))
            if not title:
                continue
            ctime = _parse_datetime(pub_time)
            messages.append({
                'title': title,
                'content': content,
                'comefrom': '涨停聚合·同花顺',
                'ctime': ctime,
                'ptime': pub_time[11:19] if len(pub_time) > 19 else '',
                'source_detail': '同花顺财经',
            })
        logger.debug("AKShare 同花顺: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("AKShare 同花顺获取失败: %s", e)
        return []


def _fetch_sina_news() -> List[Dict]:
    """新浪财经全球资讯"""
    import akshare as ak
    try:
        df = ak.stock_info_global_sina()
        messages = []
        for _, row in df.iterrows():
            content = str(row.get('内容', '')).strip()
            pub_time = str(row.get('时间', ''))
            if not content:
                continue
            # 新浪没有单独的 title 字段，用内容前80字做标题
            title = content[:80] + ('...' if len(content) > 80 else '')
            ctime = _parse_datetime(pub_time)
            messages.append({
                'title': title,
                'content': content,
                'comefrom': '涨停聚合·新浪财经',
                'ctime': ctime,
                'ptime': pub_time[11:19] if len(pub_time) > 19 else '',
                'source_detail': '新浪财经',
            })
        logger.debug("AKShare 新浪: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("AKShare 新浪获取失败: %s", e)
        return []


def _fetch_em_news() -> List[Dict]:
    """东方财富全球资讯"""
    import akshare as ak
    try:
        df = ak.stock_info_global_em()
        messages = []
        for _, row in df.iterrows():
            title = str(row.get('标题', '')).strip()
            content = str(row.get('摘要', '')).strip()
            pub_time = str(row.get('发布时间', ''))
            if not title:
                continue
            ctime = _parse_datetime(pub_time)
            messages.append({
                'title': title,
                'content': content or title,
                'comefrom': '涨停聚合·东方财富',
                'ctime': ctime,
                'ptime': pub_time[11:19] if len(pub_time) > 19 else '',
                'source_detail': '东方财富',
            })
        logger.debug("AKShare 东方财富: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("AKShare 东方财富获取失败: %s", e)
        return []


def _fetch_wallstreetcn() -> List[Dict]:
    """华尔街见闻快讯（直连 HTTP）"""
    try:
        import requests
        url = 'https://api-one.wallstcn.com/apiv1/content/lives'
        params = {'channel': 'global-channel', 'limit': 30}
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        }
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        if resp.status_code != 200:
            logger.warning("华尔街见闻 HTTP %d", resp.status_code)
            return []
        data = resp.json()
        items = data.get('data', {}).get('items', [])
        messages = []
        for item in items:
            title = str(item.get('title', '')).strip()
            content = str(item.get('content_text', '')).strip()
            display_time = item.get('display_time', 0)
            if not title and not content:
                continue
            if not title:
                title = content[:80] + ('...' if len(content) > 80 else '')
            ctime = int(display_time) if display_time else int(time.time())
            ptime = datetime.fromtimestamp(ctime).strftime('%H:%M:%S')
            messages.append({
                'title': title,
                'content': content[:500] or title,
                'comefrom': '涨停聚合·华尔街见闻',
                'ctime': ctime,
                'ptime': ptime,
                'source_detail': '华尔街见闻',
            })
        logger.debug("华尔街见闻: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("华尔街见闻获取失败: %s", e)
        return []


def _fetch_cctv_news() -> List[Dict]:
    """央视新闻财经要闻（低频，每5轮一次）"""
    import akshare as ak
    try:
        today = datetime.now().strftime("%Y%m%d")
        df = ak.news_cctv(date=today)
        if df.empty:
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
            df = ak.news_cctv(date=yesterday)
        messages = []
        for _, row in df.iterrows():
            title = str(row.get('title', '')).strip()
            content = str(row.get('content', '')).strip()
            date_str = str(row.get('date', ''))
            if not title:
                continue
            ctime = _parse_datetime(date_str)
            ptime = ''
            try:
                if ' ' in date_str:
                    time_part = date_str.split(' ', 1)[1].strip()
                    if ':' in time_part:
                        ptime = time_part[:8]
                elif len(date_str) >= 19:
                    ptime = date_str[11:19]
            except Exception:
                pass
            if not ptime and ctime:
                ptime = datetime.fromtimestamp(ctime).strftime('%H:%M:%S')
            messages.append({
                'title': title,
                'content': content[:500],
                'comefrom': '涨停聚合·央视新闻',
                'ctime': ctime,
                'ptime': ptime,
                'source_detail': '央视新闻',
            })
        logger.debug("AKShare 央视新闻: 获取 %d 条", len(messages))
        return messages
    except Exception as e:
        logger.error("AKShare 央视新闻获取失败: %s", e)
        return []


def _fetch_stock_news(stock_codes: List[str]) -> List[Dict]:
    """东方财富个股资讯（需指定股票代码）"""
    import akshare as ak
    messages = []
    for code in stock_codes:
        try:
            pure_code = code.replace('sh', '').replace('sz', '').replace('bj', '')
            df = ak.stock_news_em(symbol=pure_code)
            for _, row in df.iterrows():
                title = str(row.get('新闻标题', '')).strip()
                content = str(row.get('新闻内容', '')).strip()
                pub_time = str(row.get('发布时间', ''))
                source = str(row.get('文章来源', ''))
                if not title:
                    continue
                ctime = _parse_datetime(pub_time)
                messages.append({
                    'title': title,
                    'content': content[:500],
                    'comefrom': f'涨停聚合·{source}',
                    'ctime': ctime,
                    'ptime': pub_time[11:19] if len(pub_time) > 19 else '',
                    'source_detail': f'东方财富·{source}',
                    'stocks': [{'name': '', 'rise': ''}],
                })
            if len(messages) >= 30:
                break
        except Exception as e:
            logger.debug("AKShare 个股资讯 %s 获取失败: %s", code, e)
            continue
    logger.debug("AKShare 个股资讯: 获取 %d 条", len(messages))
    return messages


# ===== 工具函数 =====

def _parse_datetime(dt_str: str) -> int:
    """解析日期时间字符串为时间戳"""
    if not dt_str:
        return int(time.time())
    dt_str = dt_str.strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%Y%m%d",
        "%Y-%m-%d %H:%M",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(dt_str[:19] if len(dt_str) >= 19 else dt_str, fmt)
            return int(dt.timestamp())
        except ValueError:
            continue
    return int(time.time())


def _make_aid(source_id: str, unique_key: str) -> str:
    """生成唯一 aid"""
    h = hashlib.md5(f"{source_id}:{unique_key}".encode()).hexdigest()[:12]
    return f"{source_id}_{h}"


# ===== 双重去重工具 =====

def _get_bigrams(text: str) -> set:
    """提取文本的 bigram 集合（去掉标点和空格）"""
    import re
    clean = re.sub(r'[\s\u3000,，。.!！?？:：;；、""''「」【】—（）()《》\-]', '', text)
    result = set()
    for i in range(len(clean) - 1):
        result.add(clean[i:i + 2])
    return result


def _title_similarity(a: str, b: str) -> float:
    """计算两个标题的 bigram 相似度（Dice 系数）"""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # 短标题（<=8字）要求更严格
    if len(a) <= 8 or len(b) <= 8:
        return 1.0 if a == b else 0.0
    bg_a = _get_bigrams(a)
    bg_b = _get_bigrams(b)
    if not bg_a or not bg_b:
        return 0.0
    intersection = len(bg_a & bg_b)
    return (2 * intersection) / (len(bg_a) + len(bg_b))


# ===== 数据源主类 =====

class AKShareSource:
    """涨停聚合（Beta）数据源管理器

    推送架构（动态重排 + 超时丢弃语音）：
      并发抓取 → 去重 → 按 ctime 排序 → 统一推送队列
      → 节奏释放线程（每 3-5 秒释放一条）→ dispatch

    动态重排机制：
      新消息入队后，整个队列按 ctime 降序重排，保证最新消息始终先被释放。
      上一轮未释放完的消息，下一轮新消息入队后会重新排序。

    超时丢弃语音机制：
      释放消息时检查入队时间，超过 5 分钟的消息标记 skip_tts=true，
      直接展示在信息流中，不进入语音播报队列，且不等待节奏间隔。
      （避免老消息因被插队而无限阻塞语音播报）
    """

    # 推送队列上限，防止内存膨胀
    MAX_PUSH_QUEUE_SIZE = 80
    # 释放间隔范围（秒）
    PUSH_INTERVAL_MIN = 3
    PUSH_INTERVAL_MAX = 5
    # 超时阈值（秒）：超过此时间未播报的消息，放弃语音播报
    TTS_TIMEOUT = 300  # 5 分钟

    def __init__(self, dispatch_callback: Callable[[Dict], None],
                 seen_ids: set,
                 source_id: str = "akshare_beta"):
        self._dispatch = dispatch_callback
        self._seen_ids = seen_ids
        self._seen_ids_lock = threading.Lock()
        self._source_id = source_id
        self._stock_codes: List[str] = []

        # 双重去重：最近标题列表（用于模糊匹配）
        self._recent_titles: List[str] = []

        # 统一推送队列 + 释放线程
        self._push_queue: List[Dict] = []
        self._push_queue_lock = threading.Lock()
        self._push_thread: Optional[threading.Thread] = None
        self._push_running = False
        self._cctv_counter = 0

        self._start_push_dispatcher()

    def set_stock_codes(self, codes: List[str]):
        """设置自选股代码列表，用于获取关联个股资讯"""
        self._stock_codes = codes

    def _start_push_dispatcher(self):
        """启动节奏释放线程

        释放逻辑：
        1. 从队列头部取出最新消息（ctime 最大）
        2. 检查入队时间，如果超过 TTS_TIMEOUT：
           - 标记 skip_tts=true，立即 dispatch（不播报语音）
           - 不等待节奏间隔，立即取下一条
        3. 如果未超时：
           - 正常 dispatch（含语音播报）
           - 等待 3-5 秒节奏间隔
        """
        if self._push_thread and self._push_thread.is_alive():
            return

        self._push_running = True

        def run():
            logger.info("涨停聚合（Beta）: 节奏释放线程已启动（间隔 %d-%d 秒，超时 %d 秒丢弃语音）",
                        self.PUSH_INTERVAL_MIN, self.PUSH_INTERVAL_MAX, self.TTS_TIMEOUT)
            while self._push_running:
                try:
                    msg = self._pop_next_message()
                    if msg is None:
                        time.sleep(1)
                        continue

                    # 检查是否超时
                    enqueue_time = msg.get('_enqueue_time', 0)
                    wait_time = time.time() - enqueue_time if enqueue_time else 0
                    is_expired = wait_time > self.TTS_TIMEOUT

                    if is_expired:
                        # 超时：标记 skip_tts，只展示不播报
                        msg['skip_tts'] = True
                        msg['_wait_seconds'] = round(wait_time, 1)
                        self._do_dispatch(msg)
                        logger.info("涨停聚合（Beta）: 超时消息直接展示（等待 %d秒）: %s",
                                    int(wait_time), msg.get('title', '')[:50])
                        # 不等待，立即取下一条
                        continue
                    else:
                        # 正常释放
                        self._do_dispatch(msg)
                        # 等待节奏间隔
                        interval = random.randint(self.PUSH_INTERVAL_MIN, self.PUSH_INTERVAL_MAX)
                        for _ in range(interval):
                            if not self._push_running:
                                break
                            time.sleep(1)
                except Exception as e:
                    logger.error("涨停聚合（Beta）: 释放线程异常: %s", e)
                    time.sleep(2)

        self._push_thread = threading.Thread(target=run, daemon=True, name="akshare-push-dispatcher")
        self._push_thread.start()

    def stop(self):
        """停止释放线程"""
        self._push_running = False
        if self._push_thread and self._push_thread.is_alive():
            self._push_thread.join(timeout=5)
            logger.info("涨停聚合（Beta）: 节奏释放线程已停止")

    def _pop_next_message(self) -> Optional[Dict]:
        """从推送队列取出下一条（最新优先，按 ctime 降序）"""
        with self._push_queue_lock:
            if not self._push_queue:
                return None
            msg = self._push_queue.pop(0)
            return msg

    def _do_dispatch(self, msg: Dict):
        """执行单条消息的 dispatch"""
        try:
            self._dispatch(msg)
        except Exception as e:
            logger.error("涨停聚合（Beta）: dispatch 异常: %s", e)

    def _enqueue_messages(self, messages: List[Dict]):
        """将消息加入推送队列（线程安全 + 动态重排）

        动态重排机制：
        1. 新消息标记 _enqueue_time（入队时间戳）
        2. 加入队列后，整个队列按 ctime 降序重排
        3. 这保证最新消息始终在队列头部，优先被释放
        4. 上一轮未释放完的消息，下一轮新消息入队后会重新排序

        队列上限保护：超出 MAX_PUSH_QUEUE_SIZE 时丢弃最旧的消息。
        """
        if not messages:
            return
        now = time.time()
        for msg in messages:
            msg['_enqueue_time'] = now

        with self._push_queue_lock:
            self._push_queue.extend(messages)
            # 动态重排：按 ctime 降序，最新优先
            self._push_queue.sort(key=lambda x: x.get('ctime', 0), reverse=True)
            # 丢弃最旧的
            overflow = len(self._push_queue) - self.MAX_PUSH_QUEUE_SIZE
            if overflow > 0:
                self._push_queue = self._push_queue[:self.MAX_PUSH_QUEUE_SIZE]
                logger.warning("涨停聚合（Beta）: 推送队列溢出，丢弃 %d 条旧消息", overflow)
            queue_size = len(self._push_queue)
        logger.debug("涨停聚合（Beta）: 入队 %d 条，队列待推送 %d 条",
                     len(messages), queue_size)

    def fetch_all(self):
        """获取所有子源数据（单次轮询，并发抓取）

        流程：
        1. 构建抓取任务列表
        2. 并发抓取各子源
        3. 去重 + 补齐公共字段
        4. 加入统一推送队列，由释放线程按节奏推送
        """
        # 1. 构建抓取任务列表
        tasks = [
            ('财联社', _fetch_cls_telegraph),
            ('同花顺', _fetch_ths_news),
            ('新浪财经', _fetch_sina_news),
            ('东方财富', _fetch_em_news),
            ('华尔街见闻', _fetch_wallstreetcn),
        ]

        # 低频源：每5轮抓取一次（约200秒）
        self._cctv_counter += 1
        if self._cctv_counter >= 5:
            self._cctv_counter = 0
            tasks.append(('央视新闻', _fetch_cctv_news))

        # 条件源：有自选股时抓取
        if self._stock_codes:
            stock_codes = self._stock_codes[:5]
            tasks.append(('个股资讯', lambda: _fetch_stock_news(stock_codes)))

        # 2. 并发抓取各子源（30 秒超时保护，防止某子源卡死整个轮询线程）
        all_messages = []
        with ThreadPoolExecutor(max_workers=min(8, len(tasks))) as executor:
            future_map = {
                executor.submit(self._fetch_with_dedup, fn, name): name
                for name, fn in tasks
            }
            try:
                for future in as_completed(future_map, timeout=30):
                    sub_name = future_map[future]
                    try:
                        msgs = future.result()
                        all_messages.extend(msgs)
                    except Exception as e:
                        logger.error("涨停聚合（Beta）%s 并发获取异常: %s", sub_name, e)
            except TimeoutError:
                # 部分子源抓取超时，记录并跳过未完成的
                pending = [name for f, name in future_map.items() if not f.done()]
                logger.warning("涨停聚合（Beta）: 部分子源抓取超时（30秒），跳过: %s",
                               ', '.join(pending))
                for f in future_map:
                    if not f.done():
                        f.cancel()

        if not all_messages:
            return

        # 3. 公共字段补齐
        for msg in all_messages:
            msg['aid'] = _make_aid(self._source_id,
                                    msg['title'] + str(msg.get('ctime', '')))
            msg['source_id'] = self._source_id
            msg['source_name'] = '涨停聚合（Beta）'
            msg['categoryId'] = 0
            msg['stocks'] = msg.get('stocks', [])
            msg['child'] = []

        # 4. 加入统一推送队列
        self._enqueue_messages(all_messages)

        queue_size = len(self._push_queue)
        logger.info("涨停聚合（Beta）: 抓取 %d 条，队列待推送 %d 条",
                    len(all_messages), queue_size)

    def _fetch_with_dedup(self, fetch_fn, sub_source_name: str) -> List[Dict]:
        """获取数据并双重去重（线程安全）

        双重去重机制：
        第一重：精确匹配 — title[:100] 在 _seen_ids 中（快速过滤完全重复）
        第二重：模糊匹配 — bigram 相似度 >= 0.7（过滤"差几个字"的相似消息）

        模糊去重维护一个最近标题列表 _recent_titles，
        每次新消息与列表中的标题比较，命中则丢弃。
        """
        try:
            raw_messages = fetch_fn()
        except Exception as e:
            logger.error("涨停聚合（Beta）%s 获取失败: %s", sub_source_name, e)
            return []

        new_messages = []
        with self._seen_ids_lock:
            for msg in raw_messages:
                title = msg['title']
                if not title:
                    continue

                # 第一重：精确去重
                dedup_key = title[:100]
                if dedup_key in self._seen_ids:
                    continue

                # 第二重：模糊去重（bigram 相似度）
                if self._is_similar_to_recent(title):
                    logger.debug("涨停聚合（Beta）: 模糊去重命中 '%s'", title[:50])
                    continue

                # 通过双重去重，加入集合和最近列表
                self._seen_ids.add(dedup_key)
                self._recent_titles.append(title)
                # 限制最近标题列表长度
                if len(self._recent_titles) > 100:
                    self._recent_titles = self._recent_titles[-100:]
                new_messages.append(msg)

        return new_messages

    def _is_similar_to_recent(self, title: str, threshold: float = 0.7) -> bool:
        """检查标题是否与最近已推送的标题相似（bigram 相似度）

        阈值 0.7 比前端的 0.55 更严格，避免误杀不同事件。
        """
        if not hasattr(self, '_recent_titles'):
            self._recent_titles = []
            return False
        for recent in self._recent_titles:
            if _title_similarity(title, recent) >= threshold:
                return True
        return False

    def fetch_cls_only(self):
        """仅获取财联社电报（用于高频轮询）"""
        cls_msgs = self._fetch_with_dedup(_fetch_cls_telegraph, '财联社')
        for msg in cls_msgs:
            msg['aid'] = _make_aid(self._source_id,
                                    msg['title'] + str(msg.get('ctime', '')))
            msg['source_id'] = self._source_id
            msg['source_name'] = '涨停聚合（Beta）'
            msg['categoryId'] = 0
            msg['stocks'] = msg.get('stocks', [])
            msg['child'] = []
        self._enqueue_messages(cls_msgs)
        if cls_msgs:
            logger.info("涨停聚合（Beta）·财联社: 入队 %d 条", len(cls_msgs))

    def cleanup_seen_ids(self, max_size: int = 500):
        """清理 seen_ids 和 recent_titles，防止无限增长（线程安全）"""
        with self._seen_ids_lock:
            if len(self._seen_ids) > max_size:
                to_keep = list(self._seen_ids)[-max_size // 2:]
                self._seen_ids.clear()
                self._seen_ids.update(to_keep)
                logger.info("涨停聚合（Beta）: seen_ids 清理至 %d 条", len(self._seen_ids))
            # 清理最近标题列表
            if len(self._recent_titles) > 100:
                self._recent_titles = self._recent_titles[-100:]
