"""
财经信息聚合播报 - 桌面端
基于 pywebview 的轻量级桌面新闻推送客户端

功能：
- Python 后端抓取网页 + WebSocket 代理
- 前端通过 JS API 接收数据
- 可调窗口大小
- 置顶
"""

import webview
import json
import os
import sys
import threading
import time
import requests
import websocket
import re
import hashlib
import uuid
import logging
import sqlite3
import ctypes
from ctypes import wintypes

# ===== 直连 HTTP Session（不走系统代理）=====
_http = requests.Session()
_http.trust_env = False  # 国内 API 必须直连
_http.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
})

# ===== 日志系统 =====
_LOG_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'GuzhangNews')
os.makedirs(_LOG_DIR, exist_ok=True)
_LOG_FILE = os.path.join(_LOG_DIR, 'app.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.FileHandler(_LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger('guzhang')

# ===== 去重持久化（SQLite）=====
_DB_PATH = os.path.join(_LOG_DIR, 'seen_aid.db')

def _init_seen_db():
    """初始化去重数据库"""
    conn = sqlite3.connect(_DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS seen_aid (aid TEXT PRIMARY KEY, ts INTEGER)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_ts ON seen_aid(ts)')
    conn.commit()
    conn.close()
    logger.info('去重数据库已初始化: %s', _DB_PATH)

def _persist_seen_aids(aid_list):
    """批量持久化已读 aid（前端调用，传入新添加的 aid 列表）"""
    if not aid_list:
        return
    conn = sqlite3.connect(_DB_PATH)
    now = int(time.time())
    conn.executemany('INSERT OR IGNORE INTO seen_aid (aid, ts) VALUES (?, ?)',
                     [(aid, now) for aid in aid_list])
    conn.commit()
    conn.close()

def _get_all_seen_aids():
    """获取所有已读 aid（前端初始化时加载）"""
    conn = sqlite3.connect(_DB_PATH)
    rows = conn.execute('SELECT aid FROM seen_aid').fetchall()
    conn.close()
    return [r[0] for r in rows]

def _cleanup_old_seen_aids(days=7):
    """清理超过 N 天的旧记录，防止数据库无限膨胀"""
    conn = sqlite3.connect(_DB_PATH)
    cutoff = int(time.time()) - days * 86400
    deleted = conn.execute('DELETE FROM seen_aid WHERE ts < ?', (cutoff,)).rowcount
    conn.commit()
    conn.close()
    if deleted > 0:
        logger.info('清理了 %d 条过期去重记录', deleted)
SOURCE_URL = 'https://724.guzhang.com/'

# ===== 授权配置 =====
# trial_days: 试用天数（0 = 不限，直接用激活码）
# salt: 生成激活码用的盐，只有你（开发者）知道，用户拿不到
AUTH_CONFIG = {
    'trial_days': 3,   # 试用天数（首次运行起算）
    'salt': 'wolfjkd-guzhang-2026-secret-salt',  # 【重要】激活码生成盐，只有你知道，泄露=别人能算码
    'version': '1.0',
}

# 本地授权文件路径（固定在 AppData，不随 exe 路径变化，防止移动 exe 刷试用期）
_AUTH_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'GuzhangNews')
os.makedirs(_AUTH_DIR, exist_ok=True)
AUTH_FILE = os.path.join(_AUTH_DIR, 'auth.dat')


def _get_machine_id():
    """生成机器指纹（基于主机名+用户名+MAC地址）"""
    try:
        import platform
        import getpass
        raw = f"{platform.node()}-{getpass.getuser()}-{uuid.getnode()}"
        return hashlib.md5(raw.encode()).hexdigest()[:16].upper()
    except:
        return 'UNKNOWN'


def _generate_license_key(machine_id, days=None):
    """
    开发者用：生成激活码
    machine_id: 机器指纹
    days: 激活天数（None=永久）
    """
    if days:
        seed = f"{machine_id}-{AUTH_CONFIG['salt']}-{days}d"
    else:
        seed = f"{machine_id}-{AUTH_CONFIG['salt']}-perm"
    key = hashlib.sha256(seed.encode()).hexdigest()[:20].upper()
    # 格式：XXXX-XXXX-XXXX-XXXX-XXXX
    return '-'.join([key[i:i+4] for i in range(0, 20, 4)])


def _read_auth():
    """读取本地授权文件"""
    if not os.path.exists(AUTH_FILE):
        return None
    try:
        with open(AUTH_FILE, 'r') as f:
            return json.loads(f.read())
    except:
        return None


def _write_auth(data):
    """写入本地授权文件"""
    try:
        with open(AUTH_FILE, 'w') as f:
            f.write(json.dumps(data))
    except:
        pass


def check_license():
    """
    检查授权状态
    返回：(status, message, expiry_timestamp)
    status: 'trial' / 'licensed' / 'expired' / 'trial_expired'
    """
    machine_id = _get_machine_id()
    auth = _read_auth()

    # 检查激活码
    if auth and auth.get('key'):
        key = auth['key']
        days = auth.get('days')

        # 验证永久码
        if not days:
            expected = _generate_license_key(machine_id, None)
            if key == expected:
                return ('licensed', '永久激活', None)
        else:
            # 验证限期码
            expected = _generate_license_key(machine_id, days)
            if key == expected:
                activated_at = auth.get('activated_at', 0)
                expiry = activated_at + days * 86400
                if time.time() < expiry:
                    remain = int((expiry - time.time()) / 86400)
                    return ('licensed', f'已激活，剩余 {remain} 天', expiry)
                else:
                    return ('trial_expired', '激活码已过期，请续费', None)

        # 码不对，走试用逻辑
        return ('expired', '激活码无效', None)

    # 无激活码 → 试用模式
    if auth and auth.get('trial_start'):
        trial_start = auth['trial_start']
        trial_end = trial_start + AUTH_CONFIG['trial_days'] * 86400
        if time.time() < trial_end:
            remain = int((trial_end - time.time()) / 86400)
            return ('trial', f'试用中，剩余 {remain} 天', trial_end)
        else:
            return ('trial_expired', f'试用期已结束（{AUTH_CONFIG["trial_days"]}天）', None)

    # 首次运行，记录试用开始
    _write_auth({'trial_start': time.time(), 'machine_id': machine_id})
    return ('trial', f'首次使用，{AUTH_CONFIG["trial_days"]}天试用期已开始', time.time() + AUTH_CONFIG['trial_days'] * 86400)


def activate_license(key):
    """用户输入激活码进行激活"""
    machine_id = _get_machine_id()
    key = key.strip().upper()

    # 检查是否是永久码
    if key == _generate_license_key(machine_id, None):
        _write_auth({'key': key, 'machine_id': machine_id})
        return True

    # 检查是否是限期码（7天/30天/90天/365天）
    for days in [7, 30, 90, 180, 365]:
        if key == _generate_license_key(machine_id, days):
            _write_auth({
                'key': key,
                'days': days,
                'activated_at': time.time(),
                'machine_id': machine_id
            })
            return True

    return False


# ===== Windows DWM 标题栏颜色设置 =====
GA_ROOT = 2


def _get_main_hwnd_from_renderer(renderer_hwnd):
    """从浏览器控件句柄获取顶层主窗口句柄"""
    try:
        main_hwnd = ctypes.windll.user32.GetAncestor(renderer_hwnd, GA_ROOT)
        logger.info(f'GetAncestor: renderer={renderer_hwnd:#x} -> main={main_hwnd:#x}')
        return main_hwnd
    except Exception as e:
        logger.warning(f'GetAncestor 失败: {e}')
        return None


def set_titlebar_dark_mode(hwnd, dark=True):
    """通过 Windows DWM API 设置标题栏暗色模式"""
    try:
        dwmapi = ctypes.windll.dwmapi
        # Win10 1903+ 用 20，旧版用 19
        for attr_id in [20, 19]:
            value = ctypes.c_int(1 if dark else 0)
            result = dwmapi.DwmSetWindowAttribute(
                hwnd, attr_id, ctypes.byref(value), ctypes.sizeof(value)
            )
            if result == 0:
                logger.info(f'DwmSetWindowAttribute 成功: hwnd={hwnd:#x}, attr={attr_id}, dark={dark}')
                return True
        logger.warning(f'DwmSetWindowAttribute 失败: hwnd={hwnd:#x}, result={result}')
        return False
    except Exception as e:
        logger.warning(f'设置标题栏暗色模式异常: {e}')
        return False


def _apply_initial_theme(window):
    """启动时应用标题栏主题（双保险：文件 + JS localStorage）"""
    import time
    time.sleep(1)
    try:
        dark_mode = False

        # 方法1: 从配置文件读取
        try:
            config_path = os.path.join(os.environ.get('APPDATA', ''), 'GuzhangNews', 'settings.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    dark_mode = cfg.get('darkMode', False)
                logger.info(f'从文件读取 darkMode={dark_mode}')
        except Exception as e:
            logger.debug(f'从文件读取设置失败: {e}')

        # 方法2: 从 JS localStorage 读取（如果文件读取失败）
        if not dark_mode:
            try:
                result = window.evaluate_js(
                    "(function() { try { return JSON.parse(localStorage.getItem('guzhang-settings') || '{}').darkMode || false; } catch(e) { return false; } })()"
                )
                if result is True or str(result) == 'true':
                    dark_mode = True
                logger.info(f'从 JS 读取 darkMode={dark_mode}, result={result}')
            except Exception as e:
                logger.debug(f'从 JS 读取设置失败: {e}')

        # 查找主窗口句柄
        hwnd = None
        try:
            renderer_hwnd = window.gui.renderer_hwnd
            if renderer_hwnd:
                hwnd = _get_main_hwnd_from_renderer(renderer_hwnd)
        except Exception as e:
            logger.debug(f'获取 renderer_hwnd 失败: {e}')

        if not hwnd:
            hwnd = ctypes.windll.user32.FindWindowW(None, '财经信息聚合播报 v3.6.0版')

        if not hwnd:
            logger.warning('初始主题应用失败: 未找到窗口句柄')
            return

        success = set_titlebar_dark_mode(hwnd, dark_mode)
        logger.info(f'初始主题应用: dark={dark_mode}, hwnd={hwnd:#x}, success={success}')
    except Exception as e:
        logger.warning(f'初始主题应用失败: {e}')


class Api:
    """pywebview JS API，前端通过 window.pywebview.api.xxx 调用"""

    def __init__(self, window_ref):
        self._window = window_ref
        self._html_cache = None
        self._ws_config = None
        self._token = None
        self._ws = None
        self._ws_thread = None
        self._running = False
        self._data_source_manager = None
        self._main_hwnd = None  # 缓存主窗口句柄

    def activate_license(self, key):
        """前端调用：用户输入激活码"""
        if activate_license(key):
            return json.dumps({'status': 'ok'})
        return json.dumps({'status': 'error', 'message': '激活码无效或不匹配本机'}, ensure_ascii=False)

    def minimize_window(self):
        """最小化窗口"""
        self._window.minimize()
        return json.dumps({'status': 'ok'})

    def toggle_maximize(self):
        """切换窗口最大化/还原"""
        if self._window.is_maximized:
            self._window.restore()
        else:
            self._window.maximize()
        return json.dumps({'status': 'ok'})

    def resize_window(self, width, height):
        """调整窗口大小"""
        self._window.resize(int(width), int(height))
        return json.dumps({'status': 'ok'})

    def get_window_size(self):
        """获取窗口当前大小"""
        return json.dumps({
            'width': self._window.width,
            'height': self._window.height
        })

    def _find_hwnd(self):
        """查找并缓存主窗口句柄"""
        if self._main_hwnd:
            # 验证句柄是否仍然有效
            if ctypes.windll.user32.IsWindow(self._main_hwnd):
                return self._main_hwnd
            self._main_hwnd = None

        # 方法1: 从 renderer_hwnd 向上找
        try:
            renderer_hwnd = self._window().gui.renderer_hwnd
            if renderer_hwnd:
                main_hwnd = _get_main_hwnd_from_renderer(renderer_hwnd)
                if main_hwnd:
                    self._main_hwnd = main_hwnd
                    return main_hwnd
        except Exception as e:
            logger.debug(f'从 renderer 获取 HWND 失败: {e}')

        # 方法2: FindWindowW
        hwnd = ctypes.windll.user32.FindWindowW(None, '财经信息聚合播报 v3.6.0版')
        if hwnd:
            self._main_hwnd = hwnd
            return hwnd

        return None

    def set_theme(self, theme):
        """设置主题（影响Windows标题栏颜色）"""
        try:
            import platform
            if platform.system() != 'Windows':
                return json.dumps({'status': 'unsupported'})

            dark = (theme == 'dark')
            hwnd = self._find_hwnd()

            if hwnd:
                success = set_titlebar_dark_mode(hwnd, dark)
                logger.info(f'set_theme: dark={dark}, hwnd={hwnd:#x}, success={success}')
                return json.dumps({'status': 'ok' if success else 'failed'})
            logger.warning('set_theme: 未找到窗口句柄')
            return json.dumps({'status': 'no_hwnd'})
        except Exception as e:
            logger.warning(f'设置主题失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def persist_settings(self, settings_json):
        """前端调用：保存设置到文件（供 Python 端读取主题等）"""
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'GuzhangNews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'settings.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(settings_json)
            logger.info(f'设置已保存到 {config_path}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存设置失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_seen_aids(self):
        """前端初始化时获取所有已读 aid"""
        aids = _get_all_seen_aids()
        return json.dumps(aids)

    def persist_seen_aids(self, aid_list):
        """前端批量持久化新添加的 aid"""
        try:
            aids = json.loads(aid_list) if isinstance(aid_list, str) else aid_list
            _persist_seen_aids(aids)
            return json.dumps({'status': 'ok', 'count': len(aids)})
        except Exception as e:
            logger.error('持久化aid失败: %s', e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def fetch_initial(self):
        """抓取初始页面，返回解析后的新闻列表和 WS 配置"""
        logger.info('开始抓取初始页面: %s', SOURCE_URL)
        try:
            resp = requests.get(SOURCE_URL, timeout=15, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            resp.encoding = 'utf-8'
            html = resp.text

            # 提取 token
            token_match = re.search(r'encryptedToken\s*=\s*"([^"]+)"', html)
            self._token = token_match.group(1) if token_match else None

            # 提取 WS 配置
            config_match = re.search(r'window\.__NEWS_WS_CONFIG__\s*=\s*(\{[^}]+\})', html)
            if config_match:
                try:
                    self._ws_config = json.loads(config_match.group(1))
                except:
                    self._ws_config = None

            logger.info('初始页面抓取成功，token=%s, wsConfig=%s', bool(self._token), bool(self._ws_config))
            return json.dumps({
                'status': 'ok',
                'html': html,
                'token': self._token,
                'wsConfig': self._ws_config
            }, ensure_ascii=False)
        except Exception as e:
            logger.error('初始页面抓取失败: %s', e)
            return json.dumps({
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False)

    def start_ws(self):
        """启动 WebSocket 代理线程"""
        if not self._token or not self._ws_config:
            logger.warning('启动WS失败: 缺少 token 或 wsConfig')
            return json.dumps({'status': 'error', 'message': '缺少 token 或 wsConfig'})
        if self._ws_thread and self._running:
            logger.info('WS已在运行，跳过')
            return json.dumps({'status': 'ok', 'message': '已在运行'})
        self._running = True
        self._ws_thread = threading.Thread(target=self._ws_loop, daemon=True)
        self._ws_thread.start()
        logger.info('WebSocket 代理线程已启动')
        return json.dumps({'status': 'ok'})

    def stop_ws(self):
        """停止 WebSocket"""
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except:
                pass
        return json.dumps({'status': 'ok'})

    def load_more(self, oldest_ctime):
        """加载更早的消息"""
        try:
            resp = requests.post(
                'https://724.guzhang.com/index',
                json={'stime': int(oldest_ctime)},
                timeout=10,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json'
                }
            )
            data = resp.json()
            return json.dumps(data, ensure_ascii=False)
        except Exception as e:
            return json.dumps({'status': 'error', 'message': str(e)})

    def _ws_loop(self):
        """WebSocket 事件循环"""
        cfg = self._ws_config
        scheme = cfg.get('scheme', 'wss')
        host = cfg.get('host', 'swoole2.guzhang.com')
        port = cfg.get('port', 443)
        path = cfg.get('path', '/')
        ws_url = f"{scheme}://{host}:{port}{path}?token={requests.utils.quote(self._token)}"

        delay = 2
        while self._running:
            try:
                self._ws = websocket.WebSocketApp(
                    ws_url,
                    on_open=lambda ws: self._on_ws_open(),
                    on_message=lambda ws, msg: self._on_ws_message(msg),
                    on_error=lambda ws, err: self._on_ws_error(str(err)),
                    on_close=lambda ws, code, msg: self._on_ws_close()
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                logger.error('WebSocket 异常: %s', e)
                self._notify_js('ws_error', str(e))

            if not self._running:
                break
            logger.info('WebSocket 断线，%d秒后重连...', int(delay))
            time.sleep(delay)
            delay = min(delay * 1.5, 30)

    def _on_ws_open(self):
        logger.info('WebSocket 连接已建立')
        self._notify_js('ws_open', '')

    def _on_ws_message(self, raw):
        if raw == 'ping':
            try:
                self._ws.send('pong')
            except:
                pass
            return
        self._notify_js('ws_message', raw)

    def _on_ws_error(self, err):
        logger.warning('WebSocket 错误: %s', err)
        self._notify_js('ws_error', err)

    def _on_ws_close(self):
        logger.info('WebSocket 连接关闭')
        self._notify_js('ws_close', '')

    def _notify_js(self, event, data):
        """向前端推送事件"""
        w = self._window()
        if w:
            escaped = data.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
            js = f"window._onBackendEvent('{event}', '{escaped}')"
            try:
                w.evaluate_js(js)
            except:
                pass

    def init_data_source_manager(self):
        """初始化数据源管理器"""
        try:
            from data_source_manager import data_source_manager
            self._data_source_manager = data_source_manager
            # 设置回调：数据源消息 → 推送到前端（走 ws_message 通道）
            data_source_manager.set_message_callback(self._on_data_source_message)
            data_source_manager.start_all_enabled_sources()
            logger.info('数据源管理器初始化完成')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.error('初始化数据源管理器失败: %s', e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def _on_data_source_message(self, message):
        """数据源消息回调 → 推送到前端"""
        try:
            self._notify_js('ws_message', json.dumps(message, ensure_ascii=False))
        except Exception as e:
            logger.error('推送数据源消息失败: %s', e)

    def get_stock_quote(self, code):
        """获取实时股票行情（腾讯财经 API，直连）"""
        try:
            code = str(code).strip()
            # 转换为腾讯格式
            if code.startswith('6'):
                tdx_code = f'sh{code}'
            elif code.startswith(('0', '3')):
                tdx_code = f'sz{code}'
            elif code.startswith(('8', '4')):
                tdx_code = f'bj{code}'
            else:
                return json.dumps({'status': 'error', 'message': '无法识别的股票代码'})

            url = f'https://qt.gtimg.cn/q={tdx_code}'
            resp = _http.get(url, timeout=5)
            resp.encoding = 'gbk'
            text = resp.text.strip()

            # 解析腾讯行情格式：v_sh600000="1~浦发银行~600000~10.15~..."
            match = re.search(r'v_\w+="([^"]+)"', text)
            if not match:
                return json.dumps({'status': 'error', 'message': '行情数据解析失败'})

            fields = match.group(1).split('~')
            if len(fields) < 35:
                return json.dumps({'status': 'error', 'message': '行情数据不完整'})

            quote = {
                'code': code,
                'name': fields[1],
                'price': float(fields[3]) if fields[3] else 0,
                'yesterdayClose': float(fields[4]) if fields[4] else 0,
                'open': float(fields[5]) if fields[5] else 0,
                'volume': int(float(fields[6])) * 100 if fields[6] else 0,  # 手 → 股
                'amount': float(fields[37]) * 10000 if len(fields) > 37 and fields[37] else 0,  # 万元 → 元
                'high': float(fields[33]) if fields[33] else 0,
                'low': float(fields[34]) if fields[34] else 0,
                'timestamp': fields[30] if len(fields) > 30 else '',
            }

            # 计算涨跌额和涨跌幅
            if quote['yesterdayClose'] > 0:
                quote['change'] = round(quote['price'] - quote['yesterdayClose'], 4)
                quote['changePercent'] = round(
                    (quote['price'] - quote['yesterdayClose']) / quote['yesterdayClose'] * 100, 2
                )
            else:
                quote['change'] = 0
                quote['changePercent'] = 0

            # 市场标识
            if code.startswith('6'):
                quote['market'] = 'SH'
            elif code.startswith(('0', '3')):
                quote['market'] = 'SZ'
            elif code.startswith(('8', '4')):
                quote['market'] = 'BJ'
            else:
                quote['market'] = ''

            return json.dumps({'status': 'ok', 'quote': quote}, ensure_ascii=False)

        except Exception as e:
            logger.error('获取行情失败 %s: %s', code, e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_announcement_detail(self, art_code):
        """获取公告详情正文"""
        try:
            url = 'https://np-cnotice-stock.eastmoney.com/api/content/ann'
            params = {'art_code': art_code, 'client_source': 'web'}
            resp = _http.get(url, params=params, timeout=15)
            data = resp.json()
            content = ''
            if data and data.get('data'):
                content = data['data'].get('notice_content', '')
            return json.dumps({'status': 'ok', 'content': content}, ensure_ascii=False)
        except Exception as e:
            logger.error('获取公告详情失败 %s: %s', art_code, e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_research_detail(self, info_code):
        """获取研报详情（结构化数据，研报正文为PDF无法直接提取）"""
        try:
            url = 'https://reportapi.eastmoney.com/report/list'
            params = {
                'industryCode': '*', 'pageSize': 50, 'industry': '*',
                'rating': '', 'ratingChange': '',
                'beginTime': '2024-01-01', 'endTime': '2026-12-31',
                'pageNo': 1, 'fields': '', 'qType': 0, 'orgCode': '',
            }
            resp = _http.get(url, params=params, timeout=15)
            data = resp.json()
            rows = data.get('data', [])
            content = ''
            for row in rows:
                if row.get('infoCode') == info_code:
                    parts = []
                    if row.get('stockName'):
                        parts.append(f"股票: {row['stockName']}({row.get('stockCode','')})")
                    if row.get('emRatingName'):
                        parts.append(f"评级: {row['emRatingName']}")
                    if row.get('lastEmRatingName') and row.get('lastEmRatingName') != row.get('emRatingName'):
                        parts.append(f"上次评级: {row['lastEmRatingName']}")
                    if row.get('orgSName') or row.get('orgName'):
                        parts.append(f"研究机构: {row.get('orgSName') or row.get('orgName', '')}")
                    if row.get('researcher'):
                        parts.append(f"研究员: {row['researcher']}")
                    if row.get('indvAimPriceT'):
                        parts.append(f"目标价: {row['indvAimPriceT']}")
                    if row.get('indvInduName'):
                        parts.append(f"行业: {row['indvInduName']}")
                    if row.get('publishDate'):
                        parts.append(f"发布日期: {row['publishDate']}")
                    if row.get('attachPages'):
                        parts.append(f"页数: {row['attachPages']}页")
                    if row.get('title'):
                        parts.append(f"\n研报标题: {row['title']}")
                    content = '\n'.join(parts)
                    break
            return json.dumps({'status': 'ok', 'content': content}, ensure_ascii=False)
        except Exception as e:
            logger.error('获取研报详情失败 %s: %s', info_code, e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_data_sources(self):
        """获取所有数据源列表"""
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        
        sources = self._data_source_manager.get_all_sources()
        return json.dumps({'status': 'ok', 'sources': sources}, ensure_ascii=False)

    def enable_data_source(self, source_id):
        """启用数据源"""
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        
        success = self._data_source_manager.enable_source(source_id)
        return json.dumps({'status': 'ok' if success else 'error'})

    def disable_data_source(self, source_id):
        """禁用数据源"""
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        
        success = self._data_source_manager.disable_source(source_id)
        return json.dumps({'status': 'ok' if success else 'error'})

    def test_data_source(self, source_id):
        """测试数据源连接"""
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        
        result = self._data_source_manager.test_source_connection(source_id)
        return json.dumps({'status': 'ok', 'result': result}, ensure_ascii=False)


def get_html_path():
    """获取 HTML 文件路径"""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'renderer', 'index.html')


def main():
    logger.info('=== 财经信息聚合播报 v3.6.0版 启动 ===')

    # 初始化去重数据库 + 清理旧记录
    _init_seen_db()
    _cleanup_old_seen_aids(days=7)

    window_ref = None

    def on_loaded(window):
        nonlocal window_ref
        window_ref = window

    api = Api(lambda: window_ref)

    # 检查授权
    status, message, expiry = check_license()
    logger.info('授权状态: %s - %s', status, message)

    window = webview.create_window(
        '财经信息聚合播报 v3.6.0版',
        url=get_html_path(),
        width=500,
        height=800,
        min_size=(320, 400),
        resizable=True,
        on_top=False,
        text_select=True,
        js_api=api
    )

    window.events.loaded += on_loaded

    # 授权信息注入到前端
    def inject_auth_info(w):
        time.sleep(0.5)
        machine_id = _get_machine_id()
        auth_json = json.dumps({
            'status': status,
            'message': message,
            'expiry': expiry,
            'trialDays': AUTH_CONFIG['trial_days'],
            'version': AUTH_CONFIG['version'],
            'machineId': machine_id,
        }, ensure_ascii=False)
        try:
            w.evaluate_js(f"window._authInfo = {auth_json}; window._onAuthReady && window._onAuthReady();")
        except:
            pass

    # 自动初始化数据源管理器（不再依赖前端手动触发）
    try:
        from data_source_manager import data_source_manager
        api._data_source_manager = data_source_manager
        data_source_manager.set_message_callback(api._on_data_source_message)
        # 启动数据源轮询（延迟3秒，等窗口加载完）
        threading.Thread(
            target=lambda: (time.sleep(3), data_source_manager.start_all_enabled_sources()),
            daemon=True
        ).start()
        logger.info('数据源管理器自动初始化完成')
    except Exception as e:
        logger.error('数据源管理器自动初始化失败: %s', e)

    def on_loaded_with_auth(window):
        nonlocal window_ref
        window_ref = window
        threading.Thread(target=inject_auth_info, args=(window,), daemon=True).start()
        # 从 Python 端直接应用初始主题（不依赖 JS 调用）
        threading.Thread(target=_apply_initial_theme, args=(window,), daemon=True).start()

    window.events.loaded -= on_loaded
    window.events.loaded += on_loaded_with_auth

    webview.start(debug=False)


if __name__ == '__main__':
    main()
