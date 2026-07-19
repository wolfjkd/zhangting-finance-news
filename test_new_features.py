"""
涨停财经聚合播报 v3.10.0 — 集成测试
测试后端数据源、去重DB、行情API
所有国内API直连，不走代理
"""

import sys
import os
import json
import time
import re
import hashlib
import unittest
import shutil

sys.path.append(os.path.dirname(os.path.abspath(__file__)))


class TestDataSourceManager(unittest.TestCase):
    """数据源管理器测试"""

    def setUp(self):
        from data_source_manager import DataSourceManager, DataSourceConfig, DataSourceType
        self.manager = DataSourceManager()
        self.manager.running = True  # 允许轮询逻辑运行

    def test_init_default_sources(self):
        """应有4个默认数据源"""
        self.assertEqual(len(self.manager.sources), 4)
        self.assertIn("ztfi", self.manager.sources)
        self.assertIn("eastmoney", self.manager.sources)
        self.assertIn("research", self.manager.sources)
        self.assertIn("northbound", self.manager.sources)

    def test_get_all_sources(self):
        """get_all_sources 返回完整列表"""
        sources = self.manager.get_all_sources()
        self.assertEqual(len(sources), 4)
        for s in sources:
            self.assertIn("id", s)
            self.assertIn("name", s)
            self.assertIn("enabled", s)

    def test_enable_disable_source(self):
        """启用/禁用数据源"""
        self.assertFalse(self.manager.sources["eastmoney"].enabled)
        result = self.manager.enable_source("eastmoney")
        self.assertTrue(result)
        self.assertTrue(self.manager.sources["eastmoney"].enabled)

        result = self.manager.disable_source("eastmoney")
        self.assertTrue(result)
        self.assertFalse(self.manager.sources["eastmoney"].enabled)

    def test_enable_nonexistent_source(self):
        """启用不存在的数据源应失败"""
        result = self.manager.enable_source("fake_source")
        self.assertFalse(result)

    def test_message_callback(self):
        """消息回调机制"""
        received = []
        self.manager.set_message_callback(lambda msg: received.append(msg))
        test_msg = {"aid": "test_123", "title": "测试消息"}
        self.manager._dispatch_message(test_msg)
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["title"], "测试消息")

    def test_no_callback_no_error(self):
        """无回调时不报错，仅打log"""
        test_msg = {"aid": "test_456", "title": "无回调消息"}
        # 不设置回调，直接 dispatch — 应不报错
        self.manager._dispatch_message(test_msg)

    def test_aid_generation(self):
        """aid 唯一性"""
        from data_source_manager import _make_aid
        aid1 = _make_aid("eastmoney", "ART001")
        aid2 = _make_aid("eastmoney", "ART002")
        aid3 = _make_aid("research", "ART001")
        self.assertNotEqual(aid1, aid2)  # 同源不同key
        self.assertNotEqual(aid1, aid3)  # 不同源同key
        self.assertTrue(aid1.startswith("eastmoney_"))

    def test_source_status(self):
        """数据源状态查询"""
        status = self.manager.get_source_status("eastmoney")
        self.assertIsNotNone(status)
        self.assertIn("connected", status)
        self.assertIn("message_count", status)


class TestEastMoneyAnnouncements(unittest.TestCase):
    """东财公告真实API测试"""

    def setUp(self):
        from data_source_manager import DataSourceManager
        self.manager = DataSourceManager()
        self.manager.running = True
        self.manager.sources["eastmoney"].enabled = True
        self.received = []
        self.manager.set_message_callback(lambda msg: self.received.append(msg))

    def test_fetch_eastmoney_announcements(self):
        """真实获取东财公告"""
        self.manager._fetch_eastmoney_announcements()
        # API 应返回至少1条公告
        self.assertGreater(len(self.received), 0)
        msg = self.received[0]
        self.assertIn("aid", msg)
        self.assertIn("title", msg)
        self.assertTrue(msg["title"].startswith("[公告]"))
        self.assertEqual(msg["comefrom"], "东方财富")

    def test_eastmoney_connection(self):
        """连接测试"""
        result = self.manager.test_source_connection("eastmoney")
        self.assertTrue(result["success"])
        self.assertIn("latency", result)


class TestResearchReports(unittest.TestCase):
    """研报真实API测试"""

    def setUp(self):
        from data_source_manager import DataSourceManager
        self.manager = DataSourceManager()
        self.manager.running = True
        self.manager.sources["research"].enabled = True
        self.received = []
        self.manager.set_message_callback(lambda msg: self.received.append(msg))

    def test_fetch_research_reports(self):
        """真实获取研报"""
        self.manager._fetch_research_reports()
        self.assertGreater(len(self.received), 0)
        msg = self.received[0]
        self.assertIn("aid", msg)
        self.assertIn("title", msg)
        self.assertTrue(msg["title"].startswith("[研报]"))
        self.assertEqual(msg["comefrom"], "券商研报")

    def test_research_connection(self):
        """连接测试"""
        result = self.manager.test_source_connection("research")
        self.assertTrue(result["success"])
        self.assertIn("latency", result)


class TestNorthboundData(unittest.TestCase):
    """北向资金API测试"""

    def setUp(self):
        from data_source_manager import DataSourceManager
        self.manager = DataSourceManager()
        self.manager.running = True
        self.manager.sources["northbound"].enabled = True
        self.received = []
        self.manager.set_message_callback(lambda msg: self.received.append(msg))

    def test_northbound_connection(self):
        """连接测试"""
        result = self.manager.test_source_connection("northbound")
        # 收盘后可能返回 success=False（无数据），但 API 本身可达
        self.assertIn("success", result)
        self.assertIn("latency", result)

    def test_northbound_fetch_no_crash(self):
        """fetch 不崩溃（收盘后可能0条消息）"""
        self.manager._fetch_northbound_data()
        # 不崩溃就通过，消息数可能是0（收盘/变化不足5亿）


class TestTencentQuoteAPI(unittest.TestCase):
    """腾讯行情API测试"""

    def setUp(self):
        import requests
        self.session = requests.Session()
        self.session.trust_env = False  # 直连
        self.session.headers.update({'User-Agent': 'Mozilla/5.0'})

    def test_quote_sh601868(self):
        """中国能建行情"""
        resp = self.session.get('https://qt.gtimg.cn/q=sh601868', timeout=8)
        resp.encoding = 'gbk'
        self.assertEqual(resp.status_code, 200)

        match = re.search(r'v_\w+="([^"]+)"', resp.text.strip())
        self.assertIsNotNone(match)

        fields = match.group(1).split('~')
        self.assertGreater(len(fields), 35)
        self.assertEqual(fields[1], '中国能建')  # 股票名称
        self.assertGreater(float(fields[3]), 0)  # 现价 > 0

    def test_quote_sz000001(self):
        """平安银行行情"""
        resp = self.session.get('https://qt.gtimg.cn/q=sz000001', timeout=8)
        resp.encoding = 'gbk'
        self.assertEqual(resp.status_code, 200)

        match = re.search(r'v_\w+="([^"]+)"', resp.text.strip())
        self.assertIsNotNone(match)

    def test_quote_multiple(self):
        """批量行情"""
        resp = self.session.get('https://qt.gtimg.cn/q=sh601868,sz000001,sh600036', timeout=8)
        resp.encoding = 'gbk'
        self.assertEqual(resp.status_code, 200)
        # 应返回3条行情
        lines = resp.text.strip().split(';')
        valid_lines = [l for l in lines if '="' in l and l.strip()]
        self.assertGreaterEqual(len(valid_lines), 3)


class TestSeenAidDB(unittest.TestCase):
    """去重数据库测试"""

    def setUp(self):
        import tempfile
        self._test_db = os.path.join(tempfile.gettempdir(), 'test_seen_aid.db')

    def tearDown(self):
        if os.path.exists(self._test_db):
            os.remove(self._test_db)

    def test_init_and_persist(self):
        """初始化 + 持久化 + 查询"""
        import sqlite3
        conn = sqlite3.connect(self._test_db)
        conn.execute('CREATE TABLE IF NOT EXISTS seen_aid (aid TEXT PRIMARY KEY, ts INTEGER)')
        conn.commit()

        # 插入
        now = int(time.time())
        conn.executemany('INSERT OR IGNORE INTO seen_aid (aid, ts) VALUES (?, ?)',
                         [('aid_001', now), ('aid_002', now)])
        conn.commit()

        # 查询
        rows = conn.execute('SELECT aid FROM seen_aid').fetchall()
        self.assertEqual(len(rows), 2)

        # 去重（重复插入不应增加）
        conn.execute('INSERT OR IGNORE INTO seen_aid (aid, ts) VALUES (?, ?)', ('aid_001', now))
        conn.commit()
        rows = conn.execute('SELECT aid FROM seen_aid').fetchall()
        self.assertEqual(len(rows), 2)

        conn.close()

    def test_cleanup_old_records(self):
        """7天清理"""
        import sqlite3
        conn = sqlite3.connect(self._test_db)
        conn.execute('CREATE TABLE IF NOT EXISTS seen_aid (aid TEXT PRIMARY KEY, ts INTEGER)')
        conn.commit()

        now = int(time.time())
        old_ts = now - 8 * 86400  # 8天前
        conn.executemany('INSERT OR IGNORE INTO seen_aid (aid, ts) VALUES (?, ?)',
                         [('old_aid', old_ts), ('new_aid', now)])
        conn.commit()

        # 清理
        cutoff = now - 7 * 86400
        deleted = conn.execute('DELETE FROM seen_aid WHERE ts < ?', (cutoff,)).rowcount
        conn.commit()
        self.assertEqual(deleted, 1)

        rows = conn.execute('SELECT aid FROM seen_aid').fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], 'new_aid')

        conn.close()


if __name__ == '__main__':
    print("=" * 60)
    print("涨停财经聚合播报 v3.10.0 — 集成测试")
    print("=" * 60)
    unittest.main(verbosity=2)
