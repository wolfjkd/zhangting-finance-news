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
            hwnd = ctypes.windll.user32.FindWindowW(None, '涨停财经聚合播报 v4.0.0版')

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

        hwnd = ctypes.windll.user32.FindWindowW(None, '涨停财经聚合播报 v4.0.0版')
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

    _CURRENT_VERSION = 'v4.0.0'
    _VERSION_JSON_URL = 'https://raw.githubusercontent.com/wolfjkd/ZTFI-News/main/version.json'
    _RELEASES_API_URL = 'https://api.github.com/repos/wolfjkd/ZTFI-News/releases/latest'

    def _compare_versions(self, v1, v2):
        def parse(v):
            parts = v.lstrip('v').split('.')
            return tuple(int(p) if p.isdigit() else 0 for p in parts)
        p1, p2 = parse(v1), parse(v2)
        if p1 < p2:
            return -1
        elif p1 > p2:
            return 1
        return 0

    def _get_github_session(self):
        """获取用于访问 GitHub 的 Session（走代理）"""
        try:
            from data_source_manager import _proxy_session, _proxy_info, _refresh_proxy_session
            # 刷新代理检测
            _refresh_proxy_session()
            if _proxy_info:
                logger.info(f'检查更新: 使用代理 {_proxy_info.get("url", "unknown")}')
                return _proxy_session
        except Exception as e:
            logger.debug(f'获取代理 session 失败: {e}')
        # 回退：创建一个 trust_env=True 的 session（读取系统环境变量代理）
        s = requests.Session()
        s.trust_env = True
        return s

    def _check_update(self):
        try:
            session = self._get_github_session()
            resp = session.get(self._VERSION_JSON_URL, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                latest = data.get('latest_version', '')
                if latest:
                    comparison = self._compare_versions(self._CURRENT_VERSION, latest)
                    if comparison < 0:
                        return {
                            'status': 'update_available',
                            'current_version': self._CURRENT_VERSION,
                            'latest_version': latest,
                            'release_date': data.get('release_date', ''),
                            'changelog': data.get('changelog', []),
                            'urgent': data.get('urgent', False),
                            'urgent_message': data.get('urgent_message', ''),
                            'download_url': data.get('download_url', '')
                        }
                    else:
                        return {'status': 'latest', 'current_version': self._CURRENT_VERSION}
                else:
                    return {'status': 'latest', 'current_version': self._CURRENT_VERSION}
            # 非 200 响应，尝试 Releases API 作为备用
            logger.warning(f'版本 JSON 响应码: {resp.status_code}')
            return self._check_update_via_releases()
        except Exception as e:
            logger.warning(f'检查更新失败（version.json）: {e}')
            # 尝试通过 GitHub Releases API 作为备用
            try:
                return self._check_update_via_releases()
            except Exception as e2:
                logger.warning(f'检查更新失败（Releases API）: {e2}')
                return {'status': 'error', 'message': f'网络连接失败: {e}'}

    def _check_update_via_releases(self):
        """通过 GitHub Releases API 检查更新（备用方案）"""
        try:
            session = self._get_github_session()
            resp = session.get(self._RELEASES_API_URL, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                tag_name = data.get('tag_name', '')
                if tag_name:
                    comparison = self._compare_versions(self._CURRENT_VERSION, tag_name)
                    if comparison < 0:
                        # 获取下载链接
                        download_url = ''
                        for asset in data.get('assets', []):
                            if asset.get('name', '').endswith('.exe'):
                                download_url = asset.get('browser_download_url', '')
                                break
                        return {
                            'status': 'update_available',
                            'current_version': self._CURRENT_VERSION,
                            'latest_version': tag_name,
                            'release_date': data.get('published_at', ''),
                            'changelog': [],
                            'urgent': False,
                            'urgent_message': '',
                            'download_url': download_url
                        }
                    else:
                        return {'status': 'latest', 'current_version': self._CURRENT_VERSION}
            return {'status': 'latest', 'current_version': self._CURRENT_VERSION}
        except Exception as e:
            logger.warning(f'Releases API 检查失败: {e}')
            return {'status': 'error', 'message': f'无法连接 GitHub: {e}'}

    def check_update(self):
        result = self._check_update()
        return json.dumps(result)

    def download_update(self):
        try:
            resp = requests.get(self._RELEASES_API_URL, timeout=10)
            if resp.status_code != 200:
                return json.dumps({'status': 'error', 'message': '无法获取下载链接'})

            data = resp.json()
            download_url = None
            for asset in data.get('assets', []):
                if asset.get('name', '').endswith('.exe'):
                    download_url = asset.get('browser_download_url')
                    break

            if not download_url:
                return json.dumps({'status': 'error', 'message': '未找到可下载的exe文件'})

            exe_dir = os.path.dirname(sys.executable)
            new_exe_name = f'涨停财经聚合播报_{data["tag_name"]}.exe'
            new_exe_path = os.path.join(exe_dir, new_exe_name)

            logger.info(f'开始下载更新: {download_url}')
            logger.info(f'保存路径: {new_exe_path}')

            resp = requests.get(download_url, stream=True, timeout=300)
            total_size = int(resp.headers.get('content-length', 0))
            downloaded_size = 0

            with open(new_exe_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)
                        progress = int(downloaded_size / total_size * 100) if total_size > 0 else 0
                        self._notify_js('update_progress', str(progress))

            logger.info(f'下载完成: {new_exe_name}')

            old_exe_path = sys.executable
            update_bat_path = os.path.join(exe_dir, 'update.bat')
            with open(update_bat_path, 'w', encoding='utf-8') as f:
                f.write(f'@echo off\n')
                f.write(f'timeout /t 3 /nobreak >nul\n')
                f.write(f'del "{old_exe_path}"\n')
                f.write(f'start "" "{new_exe_path}"\n')
                f.write(f'del "%~f0"\n')

            os.startfile(update_bat_path)
            return json.dumps({'status': 'ok', 'message': '更新已下载，即将自动重启'})

        except Exception as e:
            logger.error(f'下载更新失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

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
        logger.info(f'WebSocket 收到消息: {raw[:300]}...')
        self._notify_js('ws_message', raw)

    def _on_ws_error(self, err):
        logger.warning('WebSocket 错误: %s', err)
        self._notify_js('ws_error', err)

    def _on_ws_close(self):
        logger.info('WebSocket 连接关闭')
        self._notify_js('ws_close', '')

    def _notify_js(self, event, data):
        try:
            w = self._window()
            if w:
                if data:
                    escaped = data.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
                    js = f"window._onBackendEvent('{event}', '{escaped}')"
                else:
                    js = f"window._onBackendEvent('{event}', '')"
                w.evaluate_js(js)
                logger.info(f'JS通知已发送: {event}')
            else:
                logger.warning('_notify_js: 窗口未就绪')
        except Exception as e:
            logger.error(f'JS通知发送失败: {e}')

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
            logger.info(f'数据源消息准备推送: source_id={message.get("source_id")}, title={message.get("title", "")[:50]}')
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
        # 传统聚合（ztfi）需要重新启动 WebSocket
        if success and source_id == "ztfi":
            self.start_ws()
        return json.dumps({'status': 'ok' if success else 'error'})

    def disable_data_source(self, source_id):
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        success = self._data_source_manager.disable_source(source_id)
        # 传统聚合（ztfi）需要关闭 WebSocket，否则会继续推送
        if success and source_id == "ztfi":
            self.stop_ws()
        return json.dumps({'status': 'ok' if success else 'error'})

    def test_data_source(self, source_id):
        if not self._data_source_manager:
            return json.dumps({'status': 'error', 'message': '数据源管理器未初始化'})
        result = self._data_source_manager.test_source_connection(source_id)
        return json.dumps({'status': 'ok', 'result': result}, ensure_ascii=False)

    # ===== Tushare 数据源配置 =====
    def get_tushare_config(self):
        """获取 Tushare 配置（Token 脱敏返回）"""
        try:
            from tushare_source import _get_token, is_available
            token = _get_token()
            # 脱敏：仅返回前4位+后4位
            if token and len(token) > 8:
                masked = token[:4] + '*' * (len(token) - 8) + token[-4:]
            else:
                masked = '****' if token else ''
            return json.dumps({
                'status': 'ok',
                'token_masked': masked,
                'has_token': bool(token),
                'is_available': is_available(),
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取 Tushare 配置失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def save_tushare_token(self, token):
        """保存 Tushare Token"""
        try:
            from tushare_source import save_token
            success = save_token(token or '')
            return json.dumps({'status': 'ok' if success else 'error'}, ensure_ascii=False)
        except Exception as e:
            logger.error(f'保存 Tushare Token 失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_tushare_apis(self):
        """获取 Tushare 可用接口列表（实时探测权限）"""
        try:
            from tushare_source import _get_token, TushareSource
            if not _get_token():
                return json.dumps({
                    'status': 'ok',
                    'detected': False,
                    'apis': [],
                    'message': '未配置 Token',
                }, ensure_ascii=False)
            # 创建临时实例探测权限
            tmp = TushareSource(
                dispatch_callback=lambda m: None,
                seen_ids=set(),
                source_id='tushare',
            )
            apis = tmp.get_available_apis()
            api_desc = {
                'daily': '日线行情（免费）',
                'news': '财经新闻（高积分）',
                'moneyflow': '资金流向（高积分）',
                'top_list': '龙虎榜（高积分）',
                'kpl_list': '涨停板（高积分）',
            }
            apis_with_desc = [{'name': a, 'desc': api_desc.get(a, a)} for a in apis]
            return json.dumps({
                'status': 'ok',
                'detected': True,
                'apis': apis_with_desc,
                'message': f'已检测到 {len(apis)} 个可用接口',
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'探测 Tushare 接口失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    # ===== Wind 数据源配置 =====
    def get_wind_config(self):
        """获取 Wind 完整配置（API Key 脱敏）"""
        try:
            from wind_source import load_wind_config, _DAILY_QUOTA_LIMIT
            config = load_wind_config()
            api_key = config.get('api_key', '')
            # 脱敏
            if api_key and len(api_key) > 8:
                masked = api_key[:4] + '*' * (len(api_key) - 8) + api_key[-4:]
            else:
                masked = '****' if api_key else ''
            # 返回（不暴露原始 api_key）
            safe_config = {
                'api_key_masked': masked,
                'has_api_key': bool(api_key),
                'modules': config.get('modules', {}),
                'daily_quota_used': config.get('daily_quota_used', 0),
                'daily_quota_limit': _DAILY_QUOTA_LIMIT,
                'daily_quota_date': config.get('daily_quota_date', ''),
            }
            return json.dumps({'status': 'ok', 'config': safe_config}, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取 Wind 配置失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def save_wind_api_key(self, api_key):
        """保存 Wind API Key（不影响其他配置）"""
        try:
            from wind_source import load_wind_config, save_wind_config
            config = load_wind_config()
            config['api_key'] = api_key or ''
            success = save_wind_config(config)
            return json.dumps({'status': 'ok' if success else 'error'}, ensure_ascii=False)
        except Exception as e:
            logger.error(f'保存 Wind API Key 失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def save_wind_modules(self, modules_json):
        """保存 Wind 模块配置（news/announcements/macro 三个模块的开关与参数）"""
        try:
            from wind_source import load_wind_config, save_wind_config
            config = load_wind_config()
            new_modules = json.loads(modules_json) if isinstance(modules_json, str) else modules_json
            # 合并默认值，避免字段缺失
            default_modules = {
                'news': {'enabled': False, 'keywords': [], 'poll_interval': 120, 'top_k': 5},
                'announcements': {'enabled': False, 'types': ['定报', '重大事项', '分红', '增发', '业绩预告'],
                                  'watch_stocks': [], 'poll_interval': 300},
                'macro': {'enabled': False, 'indicators': ['CPI', 'PPI', 'PMI', '社融'],
                          'poll_interval': 600},
            }
            merged = {}
            for mod_key, mod_default in default_modules.items():
                user_val = new_modules.get(mod_key, {})
                if not isinstance(user_val, dict):
                    user_val = {}
                merged[mod_key] = {**mod_default, **user_val}
            config['modules'] = merged
            success = save_wind_config(config)
            # 更新内存中的 Wind 实例配置
            if success and hasattr(self, '_data_source_manager') and self._data_source_manager:
                if hasattr(self._data_source_manager, '_wind_source') and self._data_source_manager._wind_source:
                    self._data_source_manager._wind_source._config = config
            return json.dumps({'status': 'ok' if success else 'error'}, ensure_ascii=False)
        except Exception as e:
            logger.error(f'保存 Wind 模块配置失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def get_wind_quota(self):
        """获取 Wind 日额度状态"""
        try:
            from wind_source import load_wind_config, _DAILY_QUOTA_LIMIT
            from datetime import datetime as _dt
            config = load_wind_config()
            today = _dt.now().strftime('%Y-%m-%d')
            used = config.get('daily_quota_used', 0) if config.get('daily_quota_date') == today else 0
            return json.dumps({
                'status': 'ok',
                'used': used,
                'limit': _DAILY_QUOTA_LIMIT,
                'remaining': max(0, _DAILY_QUOTA_LIMIT - used),
                'date': today,
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取 Wind 额度失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

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

    # ===== Edge TTS 语音引擎 =====
    def tts_get_voices(self):
        """获取可用的 Edge TTS 音色列表"""
        try:
            from ai_tts import get_engine
            engine = get_engine()
            voices = engine.get_voices()
            return json.dumps({'status': 'ok', 'voices': voices}, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取TTS音色失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def tts_synthesize(self, text, voice='zh-CN-YunyangNeural', rate='+0%', volume='+0%'):
        """文本转语音，返回音频 base64 data URI（避免 file:// 协议被拦截）"""
        try:
            from ai_tts import get_engine
            import base64
            engine = get_engine()
            audio_path = engine.synthesize(text, voice, rate, volume)
            if audio_path and os.path.exists(audio_path):
                with open(audio_path, 'rb') as f:
                    audio_b64 = base64.b64encode(f.read()).decode('utf-8')
                data_uri = f'data:audio/mp3;base64,{audio_b64}'
                return json.dumps({'status': 'ok', 'audio_data': data_uri, 'audio_path': audio_path}, ensure_ascii=False)
            return json.dumps({'status': 'error', 'message': '合成失败'})
        except Exception as e:
            logger.error(f'TTS合成失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    def tts_clear_cache(self):
        """清空 TTS 缓存"""
        try:
            from ai_tts import get_engine
            engine = get_engine()
            engine.clear_cache()
            return json.dumps({'status': 'ok'})
        except Exception as e:
            return json.dumps({'status': 'error', 'message': str(e)})

    # ===== 窗口透明度 =====
    def set_window_opacity(self, opacity):
        """设置窗口透明度 (0-100)"""
        try:
            import ctypes
            hwnd = self._find_hwnd()
            if not hwnd:
                return json.dumps({'status': 'error', 'message': '未找到窗口句柄'})

            # Windows 分层窗口透明度
            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x00080000
            LWA_ALPHA = 0x00000002

            current_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            if not (current_style & WS_EX_LAYERED):
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, current_style | WS_EX_LAYERED)

            alpha = max(30, min(255, int(opacity * 2.55)))  # 0-100 → 30-255（最低30保证可见）
            ctypes.windll.user32.SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)

            return json.dumps({'status': 'ok'})
        except Exception as e:
            logger.error(f'设置窗口透明度失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    # ===== 自选股分时图数据 =====
    def get_stock_minutes(self, code):
        """获取当日分时数据
        
        Args:
            code: 股票代码，如 'sh600000' 或 '600000'
        """
        try:
            import requests as req
            # 标准化代码
            code = code.strip().lower()
            if not code.startswith(('sh', 'sz', 'bj')):
                if code.startswith('6'):
                    code = 'sh' + code
                elif code.startswith(('0', '3')):
                    code = 'sz' + code
                elif code.startswith(('8', '4')):
                    code = 'bj' + code

            # 腾讯分时数据接口
            url = f'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}'
            session = req.Session()
            session.trust_env = False
            resp = session.get(url, timeout=5)
            data = resp.json()

            if data.get('code') != 0:
                return json.dumps({'status': 'error', 'message': '接口返回错误'})

            minute_data = data.get('data', {}).get(code, {})
            if not minute_data:
                return json.dumps({'status': 'error', 'message': '无分时数据'})

            # 解析分时数据
            prices = []
            volumes = []
            times = []
            for entry in minute_data.get('data', []):
                parts = entry.split(' ')
                if len(parts) >= 4:
                    times.append(parts[0])
                    prices.append(float(parts[1]))
                    volumes.append(float(parts[2]))

            # 昨收价
            pre_close = minute_data.get('qt', {}).get(code, [0])[4] if minute_data.get('qt') else 0
            if not pre_close and prices:
                pre_close = prices[0]

            return json.dumps({
                'status': 'ok',
                'code': code,
                'prices': prices,
                'volumes': volumes,
                'times': times,
                'pre_close': float(pre_close) if pre_close else 0
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取分时数据失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    # ===== 股票历史数据（用于ATR计算） =====
    def get_stock_history(self, code, days=20):
        """获取近N日K线数据，用于计算ATR等指标"""
        try:
            import requests as req
            code = code.strip().lower()
            if not code.startswith(('sh', 'sz', 'bj')):
                if code.startswith('6'):
                    code = 'sh' + code
                elif code.startswith(('0', '3')):
                    code = 'sz' + code
                elif code.startswith(('8', '4')):
                    code = 'bj' + code

            url = f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code}_day,{days}-0'
            session = req.Session()
            session.trust_env = False
            resp = session.get(url, timeout=5)
            text = resp.text

            # 腾讯接口返回 JSONP 格式
            import re
            json_match = re.search(r'\{.*\}', text)
            if not json_match:
                return json.dumps({'status': 'error', 'message': '解析失败'})
            data = json.loads(json_match.group())

            kline_data = data.get('data', {}).get(code, {})
            day_data = kline_data.get('qfqday', kline_data.get('day', []))

            result = []
            for row in day_data:
                if len(row) >= 6:
                    result.append({
                        'date': row[0],
                        'open': float(row[1]),
                        'close': float(row[2]),
                        'high': float(row[3]),
                        'low': float(row[4]),
                        'volume': float(row[5])
                    })

            return json.dumps({
                'status': 'ok',
                'code': code,
                'data': result
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取历史数据失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})

    # ===== 五档盘口数据 =====
    def get_stock_orderbook(self, code):
        """获取五档盘口数据"""
        try:
            import requests as req
            code = code.strip().lower()
            if not code.startswith(('sh', 'sz', 'bj')):
                if code.startswith('6'):
                    code = 'sh' + code
                elif code.startswith(('0', '3')):
                    code = 'sz' + code
                elif code.startswith(('8', '4')):
                    code = 'bj' + code

            url = f'https://qt.gtimg.cn/q={code}'
            session = req.Session()
            session.trust_env = False
            resp = session.get(url, timeout=5)
            resp.encoding = 'gbk'
            text = resp.text

            # 解析腾讯行情数据
            # 格式: v_sh600000="1~浦发银行~600000~10.50~10.45~..."
            import re
            match = re.search(r'"([^"]+)"', text)
            if not match:
                return json.dumps({'status': 'error', 'message': '解析失败'})

            fields = match.group(1).split('~')
            if len(fields) < 49:
                return json.dumps({'status': 'error', 'message': '数据字段不足'})

            # 五档买卖盘
            # 买1-5: 9-18, 卖1-5: 19-28
            # 实际腾讯格式: 买1价=9, 买1量=10, 买2价=11, 买2量=12...
            bids = []  # 买盘
            asks = []  # 卖盘
            for i in range(5):
                bid_price = float(fields[9 + i * 2]) if fields[9 + i * 2] else 0
                bid_volume = int(float(fields[10 + i * 2])) if fields[10 + i * 2] else 0
                ask_price = float(fields[19 + i * 2]) if fields[19 + i * 2] else 0
                ask_volume = int(float(fields[20 + i * 2])) if fields[20 + i * 2] else 0
                bids.append({'price': bid_price, 'volume': bid_volume})
                asks.append({'price': ask_price, 'volume': ask_volume})

            return json.dumps({
                'status': 'ok',
                'code': code,
                'name': fields[1],
                'price': float(fields[3]) if fields[3] else 0,
                'pre_close': float(fields[4]) if fields[4] else 0,
                'bids': bids,
                'asks': asks,
                'total_volume': int(float(fields[36])) if len(fields) > 36 and fields[36] else 0,
                'turnover': float(fields[37]) if len(fields) > 37 and fields[37] else 0,
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f'获取盘口数据失败: {e}')
            return json.dumps({'status': 'error', 'message': str(e)})


def get_html_path():
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'renderer', 'index.html')


def main():
    logger.info('=== 涨停财经聚合播报 v4.0.0版（开源版）启动 ===')

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
        '涨停财经聚合播报 v4.0.0版',
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
        threading.Thread(target=_auto_check_update, args=(api,), daemon=True).start()

    def _auto_check_update(api):
        try:
            time.sleep(5)
            result = api._check_update()
            if result['status'] == 'update_available':
                escaped = json.dumps(result, ensure_ascii=False).replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
                api._window().evaluate_js(f"window._onUpdateAvailable('{escaped}')")
        except Exception as e:
            logger.debug(f'自动检查更新失败: {e}')

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