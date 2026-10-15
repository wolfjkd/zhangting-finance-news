# -*- coding: utf-8 -*-
"""
海外新闻抓取基类（v4.3.0 结构性重构 · P2/P3）

背景与决策（2026-10-15）：
    data_source_manager.py 原有 9 个海外新闻抓取方法（_fetch_reddit_news /
    _fetch_hacker_news / _fetch_bbc_news / _fetch_google_news /
    _fetch_techcrunch_via_proxy / _fetch_cnbc_news / _fetch_wired_news /
    _fetch_bloomberg_news / _fetch_nitter_twitter_news），合计约 890 行，
    流程高度重复：抓取 → 时效过滤 → 排除词过滤 → 包含词过滤 →
    去重（seen）→ 翻译（失败即丢弃）→ 组装消息 dict。

    本模块将上述公共流程抽为模板方法 `fetch()`，各源只需声明
    FEEDS / PARSE_STYLE / KEY_PREFIX / LABEL 等类属性，或在必要时覆写
    `_scrape()`（如 Google 的动态搜索 URL、Nitter 的多实例轮换）、
    `_parse_feed()`（如 Reddit 的 Atom 结构与逐子版 comefrom）、
    `_content()`（如 Reddit 的作者行、TechCrunch/Bloomberg 的正文摘要）。

设计取舍：
    1. 本模块**不 import data_source_manager**（避免循环依赖），
       所需的外部依赖（HTTP 取数、翻译、aid 生成、关键词表）由调用方
       通过 `build_fetchers(...)` 注入。
    2. 严格保持与原实现一致的**执行顺序**，尤其是"先 `seen[key]=True`
       再翻译"——翻译失败的条目也会被标记已见，不再重复尝试（原行为）。
    3. 时效判断、词表匹配、去重键前缀、条目上限均与原实现逐字对齐。
    4. `_scrape()` 为**生成器**：`fetch()` 命中 MAX_TOTAL_MESSAGES 即 break，
       使 Nitter 等源能像原实现一样提前停止后续网络请求。
"""

import re
import time
import email.utils
import logging
import xml.etree.ElementTree as ET
from urllib.parse import quote as _url_quote

logger = logging.getLogger('ztfi')

_ATOM_NS = '{http://www.w3.org/2005/Atom}'
_IMG_PATTERN = re.compile(r'<img[^>]+src="([^"]+)"')


def _match_keyword(title_lower: str, keyword: str) -> bool:
    """关键词匹配：≤4 字符按单词边界匹配，>4 字符按子串匹配（与原实现一致）"""
    kw_lower = keyword.lower()
    if len(kw_lower) <= 4:
        return re.search(r'\b' + re.escape(kw_lower) + r'\b', title_lower) is not None
    return kw_lower in title_lower


def _elem_text(node, attr: str = None, default: str = '') -> str:
    """安全取 XML 节点的文本/属性并 strip"""
    if node is None:
        return default
    if attr is not None:
        return (node.get(attr) or default).strip()
    return (node.text or default).strip()


class ForeignNewsFetcher:
    """海外新闻抓取基类：统一时效过滤、去重、关键词过滤、翻译与组装流程"""

    # ===== 子类可覆盖的类属性 =====
    SOURCE_NAME: str = ''            # 展示名（日志/默认来源文案），如 "Reddit"
    KEY_PREFIX: str = ''             # 去重键前缀，如 "reddit" / "hn" / "bbc"
    LABEL: str = ''                  # 标题方括号标签，默认取 SOURCE_NAME
    COMEFROM: str = ''               # 消息 comefrom 默认值，默认取 SOURCE_NAME
    FEEDS: tuple = ()                # 入口 URL（可多个）
    PARSE_STYLE: str = 'rss'         # 'rss' | 'atom'
    MAX_ITEMS_PER_FEED: int = 10     # 每个 feed 最多取多少条
    MAX_AGE_HOURS: int = 72          # 时效阈值（小时）
    NEED_TRANSLATION: bool = True    # 是否需要翻译（失败即丢弃）
    MIN_TITLE_LENGTH: int = 0        # 标题最短长度（Google/TechCrunch 为 15）
    RESP_ENCODING: str = ''          # 若非空，则请求后强制设置 resp.encoding
    MAX_TOTAL_MESSAGES: int = 0      # >0 时达到该条数即停止（Nitter 为 20）

    def __init__(self, http_get, translate, translate_raw, make_aid,
                 include_keywords, exclude_keywords):
        """
        :param http_get:      直连优先、代理兜底的外网 GET（原 _get_with_fallback）
        :param translate:     翻译标题函数，返回译文或 None（None 表示翻译失败应丢弃）
        :param translate_raw: 原始翻译函数（不做"失败即丢弃"判定），用于正文摘要
        :param make_aid:      aid 生成函数 (source_id, unique_key) -> str
        :param include_keywords: 包含词表
        :param exclude_keywords: 排除词表
        """
        self._http_get = http_get
        self._translate = translate
        self._translate_raw = translate_raw
        self._make_aid = make_aid
        self._include_keywords = include_keywords
        self._exclude_keywords = exclude_keywords

    # ===== 模板方法（固定流程，子类不覆写）=====
    def fetch(self, seen, limit=None):
        """抓取 → 逐条过滤/去重/翻译 → 返回消息列表"""
        messages = []
        try:
            for raw in self._scrape(limit):
                msg = self._build(raw, seen)
                if msg:
                    messages.append(msg)
                    if self.MAX_TOTAL_MESSAGES and len(messages) >= self.MAX_TOTAL_MESSAGES:
                        break
        except Exception as e:
            logger.warning(f"获取{self.SOURCE_NAME}失败: {e}")
        return messages

    # ===== 抓取：遍历 FEEDS，逐条产出统一 raw item（生成器）=====
    def _scrape(self, limit=None):
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        for url in self._feed_urls():
            try:
                resp = self._http_get(url, timeout=15)
                if self.RESP_ENCODING:
                    resp.encoding = self.RESP_ENCODING
                if getattr(resp, 'status_code', 0) != 200:
                    continue
                for raw in self._parse_feed(url, resp.text, per):
                    raw.setdefault('comefrom', self.COMEFROM)
                    yield raw
            except Exception as e:
                logger.warning(f"获取{self._feed_label(url)}失败: {e}")

    def _feed_urls(self):
        """待抓取 URL 列表，默认取 FEEDS；子类可动态生成（如 Google 的搜索词）"""
        return self.FEEDS

    def _feed_label(self, feed_url) -> str:
        """日志中标识当前 feed，默认用源名；子类可细化（如 Reddit 的子版）"""
        return self.SOURCE_NAME

    def _parse_feed(self, feed_url, text, limit=None):
        """按 PARSE_STYLE 解析；子类可覆写（如 Reddit 的 Atom + 逐子版 comefrom）"""
        if self.PARSE_STYLE == 'atom':
            return self._parse_atom(text, limit)
        return self._parse_rss(text, limit)

    def _parse_rss(self, text, limit=None):
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        root = ET.fromstring(text)
        out = []
        for node in root.findall('.//item')[:per]:
            out.append({
                'title': _elem_text(node.find('title')),
                'link': _elem_text(node.find('link')),
                'pub_date': _elem_text(node.find('pubDate')),
                'description': _elem_text(node.find('description')),
            })
        return out

    def _parse_atom(self, text, limit=None):
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        root = ET.fromstring(text)
        out = []
        for entry in root.findall(f'.//{_ATOM_NS}entry')[:per]:
            out.append({
                'title': _elem_text(entry.find(f'{_ATOM_NS}title')),
                'link': _elem_text(entry.find(f'{_ATOM_NS}link'), 'href'),
                'pub_date': _elem_text(entry.find(f'{_ATOM_NS}updated')),
            })
        return out

    # ===== 单条过滤 → 组装 =====
    def _build(self, raw, seen):
        title = (raw.get('title') or '').strip()
        if not title or len(title) < self.MIN_TITLE_LENGTH:
            return None

        if not self._is_recent(raw.get('pub_date')):
            return None

        title_lower = title.lower()
        if any(ek.lower() in title_lower for ek in self._exclude_keywords):
            return None
        if not any(_match_keyword(title_lower, ik) for ik in self._include_keywords):
            return None

        unique_key = self._make_key(raw)
        if unique_key in seen:
            return None
        # 注意：与原实现一致——先标记已见，再做翻译。翻译失败的条目不再重试。
        seen[unique_key] = True

        translated = self._translate(title) if self.NEED_TRANSLATION else title
        if not translated:
            return None

        return self._assemble(unique_key, translated, raw)

    def _is_recent(self, pub_date) -> bool:
        """时效过滤：无法解析日期时视为有效（与原实现一致）"""
        if not pub_date:
            return True
        try:
            parsed = email.utils.parsedate(pub_date)
            if parsed:
                return time.mktime(parsed) >= time.time() - self.MAX_AGE_HOURS * 3600
        except Exception:
            pass
        return True

    def _make_key(self, raw) -> str:
        """去重键：{prefix}_{link}，无 link 时退化为 {prefix}_{title[:50]}"""
        link = raw.get('link') or ''
        title = (raw.get('title') or '').strip()
        prefix = raw.get('key_prefix') or self.KEY_PREFIX
        if link:
            return f"{prefix}_{link}"
        return f"{prefix}_{title[:50]}"

    def _assemble(self, unique_key, translated_title, raw):
        pub_date = raw.get('pub_date') or ''
        label = raw.get('label') or self.LABEL or self.SOURCE_NAME
        msg = {
            'aid': self._make_aid('foreign_news', unique_key),
            'title': f"[{label}] {translated_title}",
            'content': self._content(raw),
            'comefrom': raw.get('comefrom') or self.COMEFROM or self.SOURCE_NAME,
            'ctime': int(time.time()),
            'ptime': pub_date[:16] if pub_date else '',
            'categoryId': 0,
            'stocks': [],
            'child': [],
        }
        images = raw.get('images')
        if images:
            msg['images'] = images[:3]
        return msg

    def _content(self, raw) -> str:
        """正文内容，默认空；子类可覆写（如 Reddit 的作者行）"""
        return ''


class RedditFetcher(ForeignNewsFetcher):
    """Reddit 高质量财经科技新闻（Atom feed，无需 OAuth）"""

    SOURCE_NAME = 'Reddit'
    KEY_PREFIX = 'reddit'
    FEEDS = (
        'https://www.reddit.com/r/technology/hot.rss',
        'https://www.reddit.com/r/worldnews/hot.rss',
        'https://www.reddit.com/r/business/hot.rss',
    )
    PARSE_STYLE = 'atom'
    MAX_ITEMS_PER_FEED = 10

    def _feed_label(self, feed_url):
        try:
            return f"Reddit r/{feed_url.split('/r/', 1)[1].split('/', 1)[0]}"
        except IndexError:
            return self.SOURCE_NAME

    def _parse_feed(self, feed_url, text, limit=None):
        # comefrom 随子版变化：Reddit r/{sub}
        try:
            sub = feed_url.split('/r/', 1)[1].split('/', 1)[0]
        except IndexError:
            sub = ''
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        root = ET.fromstring(text)
        out = []
        for entry in root.findall(f'.//{_ATOM_NS}entry')[:per]:
            out.append({
                'title': _elem_text(entry.find(f'{_ATOM_NS}title')),
                'link': _elem_text(entry.find(f'{_ATOM_NS}link'), 'href'),
                'pub_date': _elem_text(entry.find(f'{_ATOM_NS}updated')),
                'author': _elem_text(entry.find(f'{_ATOM_NS}author/{_ATOM_NS}name')),
                'comefrom': f'Reddit r/{sub}',
            })
        return out

    def _content(self, raw) -> str:
        return f"作者: {raw.get('author', '')}"


class HackerNewsFetcher(ForeignNewsFetcher):
    """Hacker News 热门科技新闻（frontpage RSS）"""

    SOURCE_NAME = 'Hacker News'
    KEY_PREFIX = 'hn'
    FEEDS = ('https://hnrss.org/frontpage',)
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 10


class BBCFetcher(ForeignNewsFetcher):
    """BBC News 科技 + 财经（双 RSS feed）"""

    SOURCE_NAME = 'BBC News'
    KEY_PREFIX = 'bbc'
    FEEDS = (
        'http://feeds.bbci.co.uk/news/technology/rss.xml',
        'http://feeds.bbci.co.uk/news/business/rss.xml',
    )
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 8


class GoogleNewsFetcher(ForeignNewsFetcher):
    """Google News 关键词搜索（动态生成 URL，前 5 个搜索词，每词取前 5 条）"""

    SOURCE_NAME = 'Google News'
    KEY_PREFIX = 'google'
    LABEL = '谷歌新闻'                 # 原实现标题标签为中文
    COMEFROM = 'Google News'
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 5
    MIN_TITLE_LENGTH = 15
    SEARCH_KEYWORDS = (
        "China supply chain", "Chinese economy", "AI breakthrough",
        "semiconductor chip", "US China trade war", "Chinese stocks market",
        "China government policy", "AI artificial intelligence", "NVIDIA GPU AI",
        "Huawei technology", "global market news", "cybersecurity news",
        "quantum computing", "electric vehicle battery", "IPO stock market",
        "inflation interest rate", "central bank monetary policy",
        "tech company earnings", "acquisition merger M&A", "supply chain manufacturing",
    )

    def _scrape(self, limit=None):
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        for keyword in self.SEARCH_KEYWORDS[:5]:
            try:
                url = (f"https://news.google.com/rss/search?q={_url_quote(keyword)}"
                       f"&tbm=nws&tbs=qdr:d")
                resp = self._http_get(url, params={'hl': 'en-US'}, timeout=15)
                if getattr(resp, 'status_code', 0) != 200:
                    continue
                for raw in self._parse_rss(resp.text, per):
                    raw.setdefault('comefrom', self.COMEFROM)
                    yield raw
            except Exception as e:
                logger.warning(f"获取Google News '{keyword}'失败: {e}")


class TechCrunchFetcher(ForeignNewsFetcher):
    """TechCrunch 科技新闻（单 RSS feed，正文摘要随标题翻译）"""

    SOURCE_NAME = 'TechCrunch'
    KEY_PREFIX = 'techcrunch'
    FEEDS = ('https://techcrunch.com/feed/',)
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 6
    MIN_TITLE_LENGTH = 15
    RESP_ENCODING = 'utf-8'

    def _content(self, raw) -> str:
        translated = self._translate_raw(raw.get('description') or '') or ''
        return translated[:500]


class CNBCFetcher(ForeignNewsFetcher):
    """CNBC 财经科技新闻（双 RSS feed）"""

    SOURCE_NAME = 'CNBC'
    KEY_PREFIX = 'cnbc'
    FEEDS = (
        'https://www.cnbc.com/id/19832390/device/rss/rss.html',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    )
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 8


class WiredFetcher(ForeignNewsFetcher):
    """Wired 科技新闻（单 RSS feed）"""

    SOURCE_NAME = 'Wired'
    KEY_PREFIX = 'wired'
    FEEDS = ('https://www.wired.com/feed/rss',)
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 8


class BloombergFetcher(ForeignNewsFetcher):
    """Bloomberg 彭博社财经科技新闻（三 RSS feed，正文摘要随标题翻译）"""

    SOURCE_NAME = 'Bloomberg'
    KEY_PREFIX = 'bloomberg'
    FEEDS = (
        'https://feeds.bloomberg.com/markets/news.rss',
        'https://feeds.bloomberg.com/technology/news.rss',
        'https://feeds.bloomberg.com/business/news.rss',
    )
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 8

    def _content(self, raw) -> str:
        desc = raw.get('description') or ''
        translated = self._translate_raw(desc) if desc else ''
        return translated[:500] if translated else ''


class NitterFetcher(ForeignNewsFetcher):
    """X(Twitter) 重要账号推文（Nitter 多实例轮换 + 成功率打分 + 图片抽取）"""

    SOURCE_NAME = 'X/Twitter'
    KEY_PREFIX = 'nitter'
    PARSE_STYLE = 'rss'
    MAX_ITEMS_PER_FEED = 8            # 默认 limit=8
    MAX_AGE_HOURS = 24                # 原实现为 24 小时（其余源 72 小时）
    MAX_TOTAL_MESSAGES = 20           # 原实现达 20 条即提前返回

    INSTANCES = (
        'https://nitter.net',
        'https://xcancel.com',
        'https://nitter.privacyredirect.com',
        'https://nitter.kareem.one',
        'https://nitter.catsarch.com',
    )
    ACCOUNTS = {
        "elonmusk": "Elon Musk",
        "OpenAI": "OpenAI",
        "ChineseWSJ": "华尔街日报中文网",
        "bbcchinese": "BBC News 中文",
        "realDonaldTrump": "Donald Trump",
        "aleabitoreddit": "AleaBito",
        "Tesla": "Tesla",
        "SpaceX": "SpaceX",
        "sama": "Sam Altman",
        "claudeai": "Claude AI",
        "fxtrader": "FX Trader",
        "caolei1": "Cao Lei",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 实例健康统计（与原实现一致：成功/失败计数 + 最近成功时间）
        self._instance_stats = {
            inst: {"success": 0, "fail": 0, "last_success": 0} for inst in self.INSTANCES
        }

    def _best_instances(self):
        """按成功率打分排序（失败且 300 秒内无成功则降权），与原实现一致"""
        now = time.time()
        scored = []
        for inst, st in self._instance_stats.items():
            total = st["success"] + st["fail"]
            score = 1.0 if total == 0 else st["success"] / total
            if st["fail"] > 0 and now - st["last_success"] < 300:
                score *= 0.5
            scored.append((score, inst))
        scored.sort(reverse=True, key=lambda x: x[0])
        return [inst for _, inst in scored]

    def _scrape(self, limit=None):
        per = self.MAX_ITEMS_PER_FEED if limit is None else limit
        for instance in self._best_instances():
            for account, nickname in self.ACCOUNTS.items():
                try:
                    url = f"{instance}/{account}/rss"
                    resp = self._http_get(url, timeout=15)
                    if getattr(resp, 'status_code', 0) != 200:
                        self._instance_stats[instance]["fail"] += 1
                        continue
                    self._instance_stats[instance]["success"] += 1
                    self._instance_stats[instance]["last_success"] = time.time()

                    root = ET.fromstring(resp.text)
                    for node in root.findall('.//item')[:per]:
                        desc = _elem_text(node.find('description'))
                        images = _IMG_PATTERN.findall(desc)
                        yield {
                            'title': _elem_text(node.find('title')),
                            'link': _elem_text(node.find('link')),
                            'pub_date': _elem_text(node.find('pubDate')),
                            'description': desc,
                            'images': images[:3] if images else None,
                            'label': f"X {nickname}",
                            'comefrom': f"X/Twitter {nickname}",
                            'key_prefix': f"nitter_{account}",
                        }
                except Exception as e:
                    self._instance_stats[instance]["fail"] += 1
                    logger.warning(f"获取X@{account}失败: {e}")

    def _content(self, raw) -> str:
        desc = raw.get('description') or ''
        translated = self._translate_raw(desc) if desc else ''
        return f"【推文内容】\n{translated[:500]}" if translated else ''


# ===== 注册表：key 为内部短标识，供 data_source_manager 委托调用 =====
FETCHER_CLASSES = {
    'reddit': RedditFetcher,
    'hacker_news': HackerNewsFetcher,
    'bbc': BBCFetcher,
    'google': GoogleNewsFetcher,
    'techcrunch': TechCrunchFetcher,
    'cnbc': CNBCFetcher,
    'wired': WiredFetcher,
    'bloomberg': BloombergFetcher,
    'nitter': NitterFetcher,
}


def build_fetchers(http_get, translate, translate_raw, make_aid,
                   include_keywords, exclude_keywords):
    """构造全部已注册的 fetcher 实例（依赖注入）"""
    return {
        name: cls(http_get, translate, translate_raw, make_aid,
                  include_keywords, exclude_keywords)
        for name, cls in FETCHER_CLASSES.items()
    }
