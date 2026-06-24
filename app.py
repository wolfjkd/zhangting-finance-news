"""
鼓掌财经聚合消息 - 桌面端
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

    def activate_license(self, key):
        """前端调用：用户输入激活码"""
        if activate_license(key):
            return json.dumps({'status': 'ok'})
        return json.dumps({'status': 'error', 'message': '激活码无效或不匹配本机'}, ensure_ascii=False)

    def fetch_initial(self):
        """抓取初始页面，返回解析后的新闻列表和 WS 配置"""
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

            return json.dumps({
                'status': 'ok',
                'html': html,
                'token': self._token,
                'wsConfig': self._ws_config
            }, ensure_ascii=False)
        except Exception as e:
            return json.dumps({
                'status': 'error',
                'message': str(e)
            }, ensure_ascii=False)

    def start_ws(self):
        """启动 WebSocket 代理线程"""
        if not self._token or not self._ws_config:
            return json.dumps({'status': 'error', 'message': '缺少 token 或 wsConfig'})
        if self._ws_thread and self._running:
            return json.dumps({'status': 'ok', 'message': '已在运行'})
        self._running = True
        self._ws_thread = threading.Thread(target=self._ws_loop, daemon=True)
        self._ws_thread.start()
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
                self._notify_js('ws_error', str(e))

            if not self._running:
                break
            time.sleep(delay)
            delay = min(delay * 1.5, 30)

    def _on_ws_open(self):
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
        self._notify_js('ws_error', err)

    def _on_ws_close(self):
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


def get_html_path():
    """获取 HTML 文件路径"""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'renderer', 'index.html')


def main():
    window_ref = None

    def on_loaded(window):
        nonlocal window_ref
        window_ref = window

    api = Api(lambda: window_ref)

    # 检查授权
    status, message, expiry = check_license()

    window = webview.create_window(
        '实时财经信息聚合 V2.1 wolfjkd制作',
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

    def on_loaded_with_auth(window):
        nonlocal window_ref
        window_ref = window
        threading.Thread(target=inject_auth_info, args=(window,), daemon=True).start()

    window.events.loaded -= on_loaded
    window.events.loaded += on_loaded_with_auth

    webview.start(debug=False)


if __name__ == '__main__':
    main()
