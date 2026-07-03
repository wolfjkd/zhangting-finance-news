"""
涨停财经聚合播报 - 桌面端
基于 pywebview 的轻量级桌面新闻推送客户端（开源版）

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
_http.trust_env = False
_http.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
})

# ===== 日志系统 =====
_LOG_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'ZTFINews')
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
logger = logging.getLogger('ztfi')

# ===== 去重持久化（SQLite）=====
_DB_PATH = os.path.join(_LOG_DIR, 'seen_aid.db')

def _init_seen_db():
    conn = sqlite3.connect(_DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS seen_aid (aid TEXT PRIMARY KEY, ts INTEGER)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_ts ON seen_aid(ts)')
    conn.commit()
    conn.close()
    logger.info('去重数据库已初始化: %s', _DB_PATH)

def _persist_seen_aids(aid_list):
    if not aid_list:
        return
    conn = sqlite3.connect(_DB_PATH)
    now = int(time.time())
    conn.executemany('INSERT OR IGNORE INTO seen_aid (aid, ts) VALUES (?, ?)',
                     [(aid, now) for aid in aid_list])
    conn.commit()
    conn.close()

def _get_all_seen_aids():
    conn = sqlite3.connect(_DB_PATH)
    rows = conn.execute('SELECT aid FROM seen_aid').fetchall()
    conn.close()
    return [r[0] for r in rows]

def _cleanup_old_seen_aids(days=7):
    conn = sqlite3.connect(_DB_PATH)
    cutoff = int(time.time()) - days * 86400
    deleted = conn.execute('DELETE FROM seen_aid WHERE ts < ?', (cutoff,)).rowcount
    conn.commit()
    conn.close()
    if deleted > 0:
        logger.info('清理了 %d 条过期去重记录', deleted)

SOURCE_URL = 'https://724.guzhang.com/'

# ===== Windows DWM 标题栏颜色设置 =====
GA_ROOT = 2

def _get_main_hwnd_from_renderer(renderer_hwnd):
    try:
        main_hwnd = ctypes.windll.user32.GetAncestor(renderer_hwnd, GA_ROOT)
        logger.info(f'GetAncestor: renderer={renderer_hwnd:#x} -> main={main_hwnd:#x}')
        return main_hwnd
    except Exception as e:
        logger.warning(f'GetAncestor 失败: {e}')
        return None

def set_titlebar_dark_mode(hwnd, dark=True):
    try:
        dwmapi = ctypes.windll.dwmapi
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
    import time
    time.sleep(1)
    try:
        dark_mode = False
        try:
            config_path = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews', 'settings.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    dark_mode = cfg.get('darkMode', False)
                logger.info(f'从文件读取 darkMode={dark_mode}')
        except Exception as e:
            logger.debug(f'从文件读取设置失败: {e}')

        if not dark_mode:
            try:
                result = window.evaluate_js(
                    "(function() { try { return JSON.parse(localStorage.getItem('ztfi-settings') || '{}').darkMode || false; } catch(e) { return false; } })()"
                )
                if result is True or str(result) == 'true':
                    dark_mode = True
                logger.info(f'从 JS 读取 darkMode={dark_mode}, result={result}')
            except Exception as e:
                logger.debug(f'从 JS 读取设置失败: {e}')

        hwnd = None
        try:
            renderer_hwnd = window.gui.renderer_hwnd
            if renderer_hwnd:
                hwnd = _get_main_hwnd_from_renderer(renderer_hwnd)
        except Exception as e:
            logger.debug(f'获取 renderer_hwnd 失败: {e}')

        if not hwnd:
            hwnd = ctypes.windll.user32.FindWindowW(None, '涨停财经聚合播报 v3.9.7版')

        if not hwnd:
            logger.warning('初始主题应用失败: 未找到窗口句柄')
            return

        success = set_titlebar_dark_mode(hwnd, dark_mode)
        logger.info(f'初始主题应用: dark={dark_mode}, hwnd={hwnd:#x}, success={success}')
    except Exception as e:
        logger.warning(f'初始主题应用失败: {e}')

class Api:
    def __init__(self, window_ref):
        self._window = window_ref
        self._html_cache = None
        self._ws_config = None
        self._token = None
        self._ws = None
        self._ws_thread = None
        self._running = False
        self._data_source_manager = None
        self._main_hwnd = None

    def minimize_window(self):
        self._window.minimize()
        return json.dumps({'status': 'ok'})

    def exit_app(self):
        os._exit(0)

    def get_privacy_policy(self):
        try:
            project_root = os.path.dirname(os.path.abspath(__file__))
            privacy_path = os.path.join(project_root, 'PRIVACY.md')
            with open(privacy_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return json.dumps({'status': 'ok', 'content': content})
        except Exception as e:
            return json.dumps({'status': 'error', 'message': str(e)})

    def toggle_maximize(self):
        if self._window.is_maximized:
            self._window.restore()
        else:
            self._window.maximize()
        return json.dumps({'status': 'ok'})

    def toggle_pin(self, pinned):
        logger.info(f'=== toggle_pin 调用, pinned={pinned} ===')
        try:
            window = self._window()
            if window:
                logger.info(f'获取到 window 对象: {window}')
                logger.info(f'当前 on_top 值: {window.on_top}')
                window.on_top = pinned
                logger.info(f'设置后 on_top 值: {window.on_top}')
                logger.info(f'窗口置顶状态设置成功: {pinned}')
                return json.dumps({'status': 'ok'})
            else:
                logger.error('获取 window 对象失败')
                return json.dumps({'status': 'no_window'})
        except Exception as e:
            logger.error(f'窗口置顶异常: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def resize_window(self, width, height):
        self._window.resize(int(width), int(height))
        return json.dumps({'status': 'ok'})

    def get_window_size(self):
        return json.dumps({
            'width': self._window.width,
            'height': self._window.height
        })

    def _find_hwnd(self):
        if self._main_hwnd:
            if ctypes.windll.user32.IsWindow(self._main_hwnd):
                return self._main_hwnd
            self._main_hwnd = None

        try:
            renderer_hwnd = self._window().gui.renderer_hwnd
            if renderer_hwnd:
                main_hwnd = _get_main_hwnd_from_renderer(renderer_hwnd)
                if main_hwnd:
                    self._main_hwnd = main_hwnd
                    return main_hwnd
        except Exception as e:
            logger.debug(f'从 renderer 获取 HWND 失败: {e}')

        hwnd = ctypes.windll.user32.FindWindowW(None, '涨停财经聚合播报 v3.9.7版')
        if hwnd:
            self._main_hwnd = hwnd
            return hwnd

        return None

    def set_theme(self, theme):
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
        try:
            settings = json.loads(settings_json) if isinstance(settings_json, str) else settings_json
            settings['config_version'] = '3.8.0'
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'settings.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(settings))
            logger.info(f'设置已保存到 {config_path}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存设置失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_settings(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'settings.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        return content
                    return json.dumps({})
            return json.dumps({})
        except Exception as e:
            logger.warning(f'读取设置失败: {e}')
            return json.dumps({})

    def migrate_config_if_needed(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'settings.json')
            current_version = '3.8.0'

            if not os.path.exists(config_path):
                logger.info('配置文件不存在，无需迁移')
                return

            with open(config_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if not content.strip():
                    return
                settings = json.loads(content)

            saved_version = settings.get('config_version', '0.0.0')

            if saved_version == current_version:
                logger.info(f'配置版本已是最新: {current_version}')
                return

            logger.info(f'检测到配置版本升级: {saved_version} → {current_version}')

            settings['config_version'] = current_version

            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(settings))

            logger.info('配置迁移完成')
        except Exception as e:
            logger.error(f'配置迁移失败: {e}')

    def get_seen_aids(self):
        aids = _get_all_seen_aids()
        return json.dumps(aids)

    def persist_seen_aids(self, aid_list):
        try:
            aids = json.loads(aid_list) if isinstance(aid_list, str) else aid_list
            _persist_seen_aids(aids)
            return json.dumps({'status': 'ok', 'count': len(aids)})
        except Exception as e:
            logger.error('持久化aid失败: %s', e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def persist_watchlist(self, watchlist_json):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'watchlist.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(watchlist_json)
            logger.info(f'自选股已保存到 {config_path}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存自选股失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_watchlist(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'watchlist.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        return content
                    return json.dumps([])
            return json.dumps([])
        except Exception as e:
            logger.warning(f'读取自选股失败: {e}')
            return json.dumps([])

    def persist_stock_names(self, stock_names_json):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'stock_names.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(stock_names_json)
            logger.info(f'股票名称映射已保存到 {config_path}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存股票名称映射失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_stock_names(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'stock_names.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        return content
                    return json.dumps({})
            return json.dumps({})
        except Exception as e:
            logger.warning(f'读取股票名称映射失败: {e}')
            return json.dumps({})

    def persist_watchlist_groups(self, groups_json):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'watchlist_groups.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(groups_json)
            logger.info(f'自选股分组已保存到 {config_path}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存自选股分组失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_watchlist_groups(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'watchlist_groups.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        return content
                    return json.dumps([])
            return json.dumps([])
        except Exception as e:
            logger.warning(f'读取自选股分组失败: {e}')
            return json.dumps([])

    def get_window_size(self):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            config_path = os.path.join(config_dir, 'window_size.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        return content
                    return json.dumps({'width': 1200, 'height': 800})
            return json.dumps({'width': 1200, 'height': 800})
        except Exception as e:
            logger.warning(f'读取窗口尺寸失败: {e}')
            return json.dumps({'width': 1200, 'height': 800})

    def set_window_size(self, width, height):
        try:
            config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
            os.makedirs(config_dir, exist_ok=True)
            config_path = os.path.join(config_dir, 'window_size.json')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps({'width': width, 'height': height}))
            logger.info(f'窗口尺寸已保存: {width}x{height}')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.warning(f'保存窗口尺寸失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def resize_window(self, width, height):
        try:
            if self._window:
                self._window.resize(width, height)
                return json.dumps({'status': 'ok'})
            return json.dumps({'status': 'no_window'})
        except Exception as e:
            logger.warning(f'调整窗口大小失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def fetch_initial(self):
        logger.info('开始抓取初始页面: %s', SOURCE_URL)
        try:
            resp = requests.get(SOURCE_URL, timeout=15, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            resp.encoding = 'utf-8'
            html = resp.text

            token_match = re.search(r'encryptedToken\s*=\s*"([^"]+)"', html)
            self._token = token_match.group(1) if token_match else None

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
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except:
                pass
        return json.dumps({'status': 'ok'})

    def load_more(self, oldest_ctime):
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
        w = self._window()
        if w:
            escaped = data.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
            js = f"window._onBackendEvent('{event}', '{escaped}')"
            try:
                w.evaluate_js(js)
            except:
                pass

    def init_data_source_manager(self):
        try:
            from data_source_manager import data_source_manager
            self._data_source_manager = data_source_manager
            data_source_manager.set_message_callback(self._on_data_source_message)
            data_source_manager.start_all_enabled_sources()
            logger.info('数据源管理器初始化完成')
            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.error('初始化数据源管理器失败: %s', e)
            return json.dumps({'status': 'error', 'message': str(e)})

    def _on_data_source_message(self, message):
        try:
            self._notify_js('ws_message', json.dumps(message, ensure_ascii=False))
        except Exception as e:
            logger.error('推送数据源消息失败: %s', e)

    def get_stock_quote(self, code):
        try:
            code = str(code).strip()
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
                'volume': int(float(fields[6])) * 100 if fields[6] else 0,
                'amount': float(fields[37]) * 10000 if len(fields) > 37 and fields[37] else 0,
                'high': float(fields[33]) if fields[33] else 0,
                'low': float(fields[34]) if fields[34] else 0,
                'timestamp': fields[30] if len(fields) > 30 else '',
            }

            if quote['yesterdayClose'] > 0:
                quote['change'] = round(quote['price'] - quote['yesterdayClose'], 4)
                quote['changePercent'] = round(
                    (quote['price'] - quote['yesterdayClose']) / quote['yesterdayClose'] * 100, 2
                )
            else:
                quote['change'] = 0
                quote['changePercent'] = 0

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
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        sources = self._data_source_manager.get_all_sources()
        return json.dumps({'status': 'ok', 'sources': sources}, ensure_ascii=False)

    def enable_data_source(self, source_id):
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        success = self._data_source_manager.enable_source(source_id)
        return json.dumps({'status': 'ok' if success else 'error'})

    def disable_data_source(self, source_id):
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        success = self._data_source_manager.disable_source(source_id)
        return json.dumps({'status': 'ok' if success else 'error'})

    def test_data_source(self, source_id):
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        result = self._data_source_manager.test_source_connection(source_id)
        return json.dumps({'status': 'ok', 'result': result}, ensure_ascii=False)

    def ai_analyze(self, title, content, model_name, api_key, api_url, model_name_param):
        try:
            from ai_analyzer import AIAnalyzer
            analyzer = AIAnalyzer.create(
                model_name=model_name,
                api_key=api_key,
                api_url=api_url,
                model_name_param=model_name_param
            )
            result = analyzer.analyze(title, content)
            if result:
                return json.dumps(result, ensure_ascii=False)
            return json.dumps({'error': '分析结果为空'})
        except Exception as e:
            logger.error(f'AI分析失败: {e}')
            return json.dumps({'error': str(e)})


def get_html_path():
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'renderer', 'index.html')


def main():
    logger.info('=== 涨停财经聚合播报 v3.9.7版（开源版）启动 ===')

    _init_seen_db()
    _cleanup_old_seen_aids(days=7)

    # 读取保存的窗口尺寸
    default_width, default_height = 500, 800
    try:
        config_dir = os.path.join(os.environ.get('APPDATA', ''), 'ZTFINews')
        config_path = os.path.join(config_dir, 'window_size.json')
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                size_data = json.loads(f.read())
                default_width = size_data.get('width', 500)
                default_height = size_data.get('height', 800)
                logger.info(f'读取到窗口尺寸: {default_width}x{default_height}')
    except Exception as e:
        logger.warning(f'读取窗口尺寸失败，使用默认值: {e}')

    window_ref = None

    api = Api(lambda: window_ref)
    api.migrate_config_if_needed()

    window = webview.create_window(
        '涨停财经聚合播报 v3.9.7版',
        url=get_html_path(),
        width=default_width,
        height=default_height,
        min_size=(320, 400),
        resizable=True,
        on_top=False,
        text_select=True,
        js_api=api
    )

    def on_loaded(window):
        nonlocal window_ref
        window_ref = window
        threading.Thread(target=_apply_initial_theme, args=(window,), daemon=True).start()

    window.events.loaded += on_loaded

    try:
        from data_source_manager import data_source_manager
        api._data_source_manager = data_source_manager
        data_source_manager.set_message_callback(api._on_data_source_message)
        threading.Thread(
            target=lambda: (time.sleep(3), data_source_manager.start_all_enabled_sources()),
            daemon=True
        ).start()
        logger.info('数据源管理器自动初始化完成')
    except Exception as e:
        logger.error('数据源管理器自动初始化失败: %s', e)

    webview.start(debug=False)


if __name__ == '__main__':
    main()