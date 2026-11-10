# -*- coding: utf-8 -*-
"""
涨停财经聚合播报 · 一键护栏检查（check.py）

来源：2026-11-10 全量代码审核报告的「环境复盘」落地项——
把机械性错误变成确定性检查，别再靠人肉同步。

用法：
    python check.py          # 全部检查，全绿退出码 0，任一失败退出码 1

检查项：
  1. Python 全量语法编译（py_compile，含 SyntaxWarning 报告）
  2. JS 全量语法检查（node --check，renderer 全部 .js）
  3. 模块三方同步：renderer/modules/ ↔ index.html ↔ 打包 spec datas（顺序一致）
  4. bat 文件编码体检：GBK 可解 + CRLF + chcp 936（build.bat / 启动.bat）
  5. 版本号同步：以 version.json 为基准，比对 app.py / index.html /
     spec / build.bat / README.md / VERSION-CONTROL-RULES.md / 启动.bat
"""
import glob
import json
import os
import py_compile
import re
import subprocess
import sys
import warnings

ROOT = os.path.dirname(os.path.abspath(__file__))
FAILS = []
NOTES = []


def fail(msg):
    FAILS.append(msg)
    print(f'  [FAIL] {msg}')


def ok(msg):
    print(f'  [ok]   {msg}')


def note(msg):
    NOTES.append(msg)
    print(f'  [note] {msg}')


def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()


# ---------- 1. Python 语法 ----------
def check_python():
    print('\n== 1. Python 语法编译 ==')
    skip_dirs = {'.venv', 'build', 'dist', '__pycache__', '.git', '.pytest_cache', '.trae', '.rules'}
    py_files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for name in filenames:
            if name.endswith('.py'):
                py_files.append(os.path.join(dirpath, name))
    bad = 0
    warned = []
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        for path in py_files:
            try:
                py_compile.compile(path, doraise=True)
            except py_compile.PyCompileError as e:
                fail(f'Python 编译失败: {os.path.relpath(path, ROOT)} → {e}')
                bad += 1
        warned = [str(w.message) for w in caught if issubclass(w.category, SyntaxWarning)]
    if bad == 0:
        ok(f'Python 编译全过（{len(py_files)} 个文件）')
    for w in set(warned):
        note(f'SyntaxWarning（未来 Python 会变 SyntaxError）: {w}')


# ---------- 2. JS 语法 ----------
def check_js():
    print('\n== 2. JS 语法（node --check）==')
    js_files = sorted(glob.glob(os.path.join(ROOT, 'renderer', '*.js')) +
                      glob.glob(os.path.join(ROOT, 'renderer', 'modules', '*.js')))
    bad = 0
    for path in js_files:
        r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
        if r.returncode != 0:
            fail(f'JS 语法错误: {os.path.relpath(path, ROOT)} → {r.stderr.strip()[:200]}')
            bad += 1
    if bad == 0:
        ok(f'node --check 全过（{len(js_files)} 个文件）')


# ---------- 3. 模块三方同步 ----------
MODULE_RE = re.compile(r'modules/[A-Za-z0-9_-]+\.js')


def check_modules():
    print('\n== 3. 模块三方同步（modules/ ↔ index.html ↔ spec datas）==')
    mods_dir = os.path.join(ROOT, 'renderer', 'modules')
    disk = sorted(os.path.basename(p) for p in glob.glob(os.path.join(mods_dir, '*.js')))

    index_html = read_bytes(os.path.join(ROOT, 'renderer', 'index.html')).decode('utf-8')
    spec_path = os.path.join(ROOT, '涨停财经聚合播报.spec')
    spec_raw = read_bytes(spec_path)
    try:
        spec_text = spec_raw.decode('utf-8')
    except UnicodeDecodeError:
        spec_text = spec_raw.decode('gbk', errors='replace')

    in_html = [os.path.basename(m) for m in MODULE_RE.findall(index_html)]
    in_spec = [os.path.basename(m) for m in MODULE_RE.findall(spec_text)]
    # spec datas 去重（同名条目只算一次，保持顺序）
    seen = set()
    in_spec_unique = [x for x in in_spec if not (x in seen or seen.add(x))]
    seen2 = set()
    in_html_unique = [x for x in in_html if not (x in seen2 or seen2.add(x))]

    miss_html = sorted(set(disk) - set(in_html_unique))
    miss_spec = sorted(set(disk) - set(in_spec_unique))
    ghost_html = sorted(set(in_html_unique) - set(disk))
    ghost_spec = sorted(set(in_spec_unique) - set(disk))
    if miss_html:
        fail(f'index.html 缺少模块: {miss_html}')
    else:
        ok(f'index.html 覆盖全部 {len(in_html_unique)} 个模块')
    if miss_spec:
        fail(f'spec datas 缺少模块: {miss_spec}')
    else:
        ok(f'spec datas 覆盖全部 {len(in_spec_unique)} 个模块')
    if ghost_html:
        fail(f'index.html 引用了不存在的模块: {ghost_html}')
    if ghost_spec:
        fail(f'spec datas 引用了不存在的模块: {ghost_spec}')
    # 顺序说明：PyInstaller datas 只管打包文件，运行时加载顺序由 index.html 决定；
    # head 里的脚本（如 minute-chart.js）在 spec 列表中的位置允许不同。
    if in_html_unique != in_spec_unique:
        note('index.html 与 spec datas 排列顺序不同（不影响运行：以 index.html 为准）')
    else:
        ok('index.html 与 spec datas 模块排列顺序一致')


# ---------- 4. bat 编码体检 ----------
def check_bat():
    print('\n== 4. bat 编码体检（GBK + CRLF + chcp 936）==')
    for name in ('build.bat', '启动.bat'):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            fail(f'缺少 {name}')
            continue
        raw = read_bytes(path)
        bare_lf = raw.replace(b'\r\n', b'').count(b'\n')
        try:
            raw.decode('gbk')
            gbk_ok = True
        except UnicodeDecodeError:
            gbk_ok = False
        has_936 = b'chcp 936' in raw
        if bare_lf:
            fail(f'{name}: 存在裸 LF（{bare_lf} 处），bat 必须 CRLF')
        if not gbk_ok:
            fail(f'{name}: 非 GBK 可解（疑似 UTF-8 存中文），cmd 会乱码')
        if not has_936:
            fail(f'{name}: 未设 chcp 936')
        if not (bare_lf or not gbk_ok or not has_936):
            ok(f'{name}: CRLF / GBK / chcp 936 全过')


# ---------- 5. 版本号同步 ----------
def check_versions():
    print('\n== 5. 版本号同步（基准 = version.json）==')
    try:
        ver = json.loads(read_bytes(os.path.join(ROOT, 'version.json')).decode('utf-8'))['latest_version']
        ok(f'基准版本: {ver}')
    except Exception as e:
        fail(f'version.json 无法读取: {e}')
        return

    expectations = [
        # (文件, 最少出现次数, 说明)
        ('app.py', 5, 'FindWindowW 单实例锁×2 + _CURRENT_VERSION + 启动日志 + webview 标题'),
        ('renderer/index.html', 4, 'title / 标题栏 / 关于页 / 更新弹窗'),
        ('涨停财经聚合播报.spec', 1, 'exe 输出名'),
        ('build.bat', 1, 'exe 输出名'),
        ('README.md', 1, '文档版本'),
        ('VERSION-CONTROL-RULES.md', 1, '规则基线表 §十'),
        ('启动.bat', 1, '头部注释版本'),
    ]
    for rel, min_count, why in expectations:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            fail(f'版本同步：缺少 {rel}')
            continue
        try:
            text = read_bytes(path).decode('utf-8')
        except UnicodeDecodeError:
            text = read_bytes(path).decode('gbk', errors='replace')
        count = text.count(ver)
        if count >= min_count:
            ok(f'{rel}: {ver} ×{count}（{why}）')
        else:
            fail(f'{rel}: {ver} 仅出现 {count} 次，应 ≥{min_count}（{why}）——版本号漏改')


def main():
    print('涨停财经聚合播报 · 护栏检查开始')
    check_python()
    check_js()
    check_modules()
    check_bat()
    check_versions()
    print('\n== 汇总 ==')
    if NOTES:
        for n in NOTES:
            print(f'  [note] {n}')
    if FAILS:
        print(f'  结果: {len(FAILS)} 项失败')
        sys.exit(1)
    print('  结果: 全部通过 ✅')
    sys.exit(0)


if __name__ == '__main__':
    main()
