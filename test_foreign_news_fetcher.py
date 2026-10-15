# -*- coding: utf-8 -*-
"""
foreign_news_fetcher 行为对齐测试

覆盖 9 个海外源抓取器在**不联网**（注入假 HTTP / 假翻译）条件下的核心行为：
时效过滤、排除词/包含词过滤、去重（seen）、翻译失败即丢弃、seen 标记顺序、
Atom 逐子版 comefrom、Google 动态搜索 URL 与标题最短长度、TechCrunch
resp.encoding 与正文摘要、多 feed 条数、Nitter 的 24h 时效 / 多实例 / 图片 /
逐账号标签 / 20 条总量上限 / limit 参数。

运行：python test_foreign_news_fetcher.py   （退出码 0 = 全绿）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import foreign_news_fetcher as fnf  # noqa: E402

INCLUDE = ["China", "chip", "Apple", "NVIDIA", "AI", "export controls"]
EXCLUDE = ["celebrity", "World Cup", "football"]

_failures = []


def check(name, cond, detail=''):
    if cond:
        print(f"  [PASS] {name}")
    else:
        print(f"  [FAIL] {name}" + (f" — {detail}" if detail else ''))
        _failures.append(name)
    return bool(cond)


class FakeResp:
    def __init__(self, text, code=200):
        self.text = text
        self.status_code = code
        self.encoding = None


def fake_translate(title):
    """翻译标题；含 BAD 视为翻译失败（调用方应丢弃）"""
    return None if 'BAD' in title else "[译]" + title


def fake_translate_raw(text):
    return None if ('BAD' in (text or '')) else "[译]" + (text or '')


def fake_make_aid(source, key):
    return f"{source}::h({key})"


def build(cls, handler, include=None, exclude=None):
    return cls(handler, fake_translate, fake_translate_raw, fake_make_aid,
               include or INCLUDE, exclude or EXCLUDE)


def rss(items):
    """items: [(title, link, pubDate, description)]"""
    body = ''.join(
        '<item>'
        f'<title>{t}</title><link>{l}</link><pubDate>{d}</pubDate>'
        f'<description><![CDATA[{desc}]]></description>'
        '</item>'
        for t, l, d, desc in items)
    return f'<rss><channel>{body}</channel></rss>'


def atom(entries):
    """entries: [(title, href, updated, author)]"""
    body = ''.join(
        '<entry>'
        f'<title>{t}</title><link href="{h}"/><updated>{u}</updated>'
        f'<author><name>{a}</name></author>'
        '</entry>'
        for t, h, u, a in entries)
    return f'<feed xmlns="http://www.w3.org/2005/Atom">{body}</feed>'


LONG = 'China chip boom accelerates'          # 25 字符
SHORT = 'chip'                                # < 15


def test_hacker_news():
    print("[1] HackerNewsFetcher（RSS / 时效 / 词表 / 去重 / 翻译失败）")
    feed = rss([
        ('China chip export controls tighten', 'http://x/1', '', ''),
        ('Celebrity gossip roundup', 'http://x/2', '', ''),
        ('Apple supplier expands capacity', 'http://x/3', 'Mon, 01 Jan 2001 00:00:00 GMT', ''),
        ('BAD NVIDIA chip news', 'http://x/4', '', ''),
        ('China chip export controls tighten', 'http://x/1', '', ''),   # 与第 1 条同 link
    ])
    f = build(fnf.HackerNewsFetcher, lambda url, **kw: FakeResp(feed))
    seen = {}
    msgs = f.fetch(seen)
    check('仅 1 条通过（排除词/过时/翻译失败/去重 均被过滤）', len(msgs) == 1, f"实际 {len(msgs)}")
    if msgs:
        m = msgs[0]
        check('title 标签正确', m['title'] == '[Hacker News] [译]China chip export controls tighten', m['title'])
        check('comefrom / content / 默认字段正确',
              m['comefrom'] == 'Hacker News' and m['content'] == ''
              and m['categoryId'] == 0 and m['stocks'] == [] and m['child'] == [])
    check('seen 含 2 键（翻译失败的条目也被标记已见，顺序与原实现一致）',
          set(seen.keys()) == {'hn_http://x/1', 'hn_http://x/4'}, str(set(seen.keys())))


def test_bbc():
    print("[2] BBCFetcher（双 feed 各取前 8）")
    many = ''.join(f'<item><title>China chip story {i}</title>'
                   f'<link>http://b/{i}</link><pubDate></pubDate></item>' for i in range(12))
    many = f'<rss><channel>{many}</channel></rss>'
    feeds = {
        'http://feeds.bbci.co.uk/news/technology/rss.xml': many,
        'http://feeds.bbci.co.uk/news/business/rss.xml': many.replace('http://b/', 'http://c/'),
    }
    f = build(fnf.BBCFetcher, lambda url, **kw: FakeResp(feeds.get(url, '')))
    msgs = f.fetch({})
    check('双 feed 各取前 8 条 = 16 条', len(msgs) == 16, f"实际 {len(msgs)}")
    check('标签 [BBC News] / comefrom BBC News',
          all(m['title'].startswith('[BBC News] ') and m['comefrom'] == 'BBC News' for m in msgs))


def test_reddit():
    print("[3] RedditFetcher（Atom / 逐子版 comefrom / 作者正文）")
    a = atom([('China AI chip rally continues', 'http://r/1', '2026-10-15T10:00:00Z', 'alice'),
              ('Random personal blog post', 'http://r/2', '2026-10-15T10:00:00Z', 'bob')])
    feeds = {
        'https://www.reddit.com/r/technology/hot.rss': a,
        'https://www.reddit.com/r/worldnews/hot.rss': a.replace('http://r/', 'http://w/'),
        'https://www.reddit.com/r/business/hot.rss': '',
    }
    f = build(fnf.RedditFetcher, lambda url, **kw: FakeResp(feeds.get(url, '')))
    msgs = f.fetch({})
    check('通过 2 条（每 feed 1 条，另一条被排除词 personal/blog 命中）', len(msgs) == 2, f"实际 {len(msgs)}")
    check('comefrom 随子版',
          sorted(m['comefrom'] for m in msgs) == ['Reddit r/technology', 'Reddit r/worldnews'])
    check('content = 作者行', all(m['content'].startswith('作者: ') for m in msgs))
    check('标签 [Reddit]', all(m['title'].startswith('[Reddit] ') for m in msgs))


def test_google():
    print("[4] GoogleNewsFetcher（动态搜索 URL / 前 5 词 / 标题≥15 / 中文标签）")
    calls = []

    def handler(url, **kw):
        calls.append((url, kw))
        idx = len(calls) - 1
        return FakeResp(rss([(LONG, f'http://g/{idx}/1', '', ''),
                             (SHORT, f'http://g/{idx}/2', '', ''),
                             ('China semiconductor demand AI', f'http://g/{idx}/3', '', '')]))

    f = build(fnf.GoogleNewsFetcher, handler)
    msgs = f.fetch({})
    check('只取前 5 个搜索词 → 5 次请求', len(calls) == 5, str(len(calls)))
    check('每次请求带 params hl=en-US', all(c[1].get('params') == {'hl': 'en-US'} for c in calls))
    check('URL 含 tbs=qdr:d 且关键词已 URL 编码（空格 → %20）',
          bool(calls) and 'tbs=qdr:d' in calls[0][0] and '%20' in calls[0][0])
    check('每词取前 5 条 → 5×2 = 10 条', len(msgs) == 10, str(len(msgs)))
    check('标题 <15 字符被丢弃', not any(m['title'].endswith('[译]chip') for m in msgs))
    check('标签 [谷歌新闻] / comefrom Google News',
          all(m['title'].startswith('[谷歌新闻] ') and m['comefrom'] == 'Google News' for m in msgs))
    check('去重键前缀 google_', all(m['aid'].startswith('foreign_news::h(google_') for m in msgs))


def test_techcrunch():
    print("[5] TechCrunchFetcher（标题≥15 / resp.encoding / 正文摘要）")
    holder = {}

    def handler(url, **kw):
        holder['resp'] = FakeResp(rss([(LONG, 'http://t/1', '', 'desc one'),
                                       (SHORT, 'http://t/2', '', 'desc two')]))
        return holder['resp']

    f = build(fnf.TechCrunchFetcher, handler)
    msgs = f.fetch({})
    check('请求后 resp.encoding 置为 utf-8', holder['resp'].encoding == 'utf-8', str(holder['resp'].encoding))
    check('短标题被丢弃 → 1 条', len(msgs) == 1, str(len(msgs)))
    check('content = 译文正文摘要', msgs and msgs[0]['content'] == '[译]desc one',
          msgs[0]['content'] if msgs else '')
    check('标签 [TechCrunch]', msgs and msgs[0]['title'].startswith('[TechCrunch] '))


def test_cnbc_and_wired():
    print("[6] CNBCFetcher（双 feed ×8）/ WiredFetcher（单 feed ×8）")
    two = [(f'China chip story {i}', f'http://c/{i}', '', '') for i in range(12)]
    cnbc_feeds = {
        'https://www.cnbc.com/id/19832390/device/rss/rss.html': rss(two),
        'https://www.cnbc.com/id/100003114/device/rss/rss.html': rss(
            [(t, l.replace('/c/', '/d/'), d, x) for t, l, d, x in two]),
    }
    f = build(fnf.CNBCFetcher, lambda url, **kw: FakeResp(cnbc_feeds.get(url, '')))
    msgs = f.fetch({})
    check('CNBC 双 feed ×8 = 16 条', len(msgs) == 16, str(len(msgs)))
    check('CNBC 标签/comefrom', all(m['title'].startswith('[CNBC] ') and m['comefrom'] == 'CNBC' for m in msgs))
    check('CNBC 键前缀 cnbc_', all(m['aid'].startswith('foreign_news::h(cnbc_') for m in msgs))

    f = build(fnf.WiredFetcher, lambda url, **kw: FakeResp(rss(two) if 'wired' in url else ''))
    msgs = f.fetch({})
    check('Wired 单 feed ×8 = 8 条', len(msgs) == 8, str(len(msgs)))
    check('Wired 键前缀 wired_', all(m['aid'].startswith('foreign_news::h(wired_') for m in msgs))


def test_bloomberg():
    print("[7] BloombergFetcher（三 feed ×8 / 正文摘要）")
    feeds = {}
    for i, u in enumerate(fnf.BloombergFetcher.FEEDS):
        feeds[u] = rss([(f'China chip markets report {j}', f'http://b{i}/{j}', '', f'db{i}{j}')
                        for j in range(12)])
    calls = []

    def handler(url, **kw):
        calls.append(url)
        return FakeResp(feeds.get(url, ''))

    f = build(fnf.BloombergFetcher, handler)
    msgs = f.fetch({})
    check('请求 3 个 feed', len(calls) == 3, str(len(calls)))
    check('3 feed ×8 = 24 条', len(msgs) == 24, str(len(msgs)))
    check('content = 译文摘要', all(m['content'].startswith('[译]db') for m in msgs))
    check('标签 [Bloomberg]', all(m['title'].startswith('[Bloomberg] ') for m in msgs))


def test_nitter():
    print("[8] NitterFetcher（24h 时效 / 多实例 / 图片 / 逐账号标签 / 20 条上限 / limit）")
    now_str = 'Thu, 15 Oct 2026 10:00:00 GMT'
    old_str = 'Wed, 14 Oct 2026 00:00:00 GMT'   # 约 34 小时前 → 应被 24h 阈值丢弃
    items = [(f'China AI chip news {i}', f'http://n/{i}', now_str,
              f'<img src="http://i/{i}.jpg"><img src="http://i/{i}b.jpg">') for i in range(10)]
    items.append(('China chip stale news', 'http://n/old', old_str, ''))
    feed = rss(items)
    calls = []

    def handler(url, **kw):
        calls.append(url)
        return FakeResp(feed) if url.startswith('https://nitter.net/') else FakeResp('', 404)

    f = build(fnf.NitterFetcher, handler)
    msgs = f.fetch({})
    check('总量上限 20 条生效', len(msgs) == 20, str(len(msgs)))
    check('24h 时效：34 小时前的条目被丢弃', not any('stale' in m['title'] for m in msgs))
    check('命中上限即提前 break（未请求后续账号）', len(calls) <= 3, str(len(calls)))
    check('逐账号 comefrom / label', all(m['comefrom'].startswith('X/Twitter ')
                                        and m['title'].startswith('[X ') for m in msgs))
    check('前 3 个账号依次出现',
          sorted({m['comefrom'] for m in msgs})
          == ['X/Twitter Elon Musk', 'X/Twitter OpenAI', 'X/Twitter 华尔街日报中文网'])
    check('images 键存在且 ≤3', all('images' in m and len(m['images']) <= 3 for m in msgs))
    check('键前缀 nitter_{account}_', all(m['aid'].startswith('foreign_news::h(nitter_') for m in msgs))

    f2 = build(fnf.NitterFetcher, handler)
    msgs2 = f2.fetch({}, limit=1)
    check('limit=1 生效（每账号 1 条 × 12 账号 = 12，而非 20）', len(msgs2) == 12, str(len(msgs2)))


def main():
    test_hacker_news()
    test_bbc()
    test_reddit()
    test_google()
    test_techcrunch()
    test_cnbc_and_wired()
    test_bloomberg()
    test_nitter()
    print()
    if _failures:
        print(f"[RESULT] 存在失败 ❌ （{len(_failures)} 项）：{_failures}")
        return 1
    print("[RESULT] 全部通过 ✅")
    return 0


if __name__ == '__main__':
    sys.exit(main())
