# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('renderer/index.html', 'renderer'),
        ('renderer/style.css', 'renderer'),
        ('renderer/app.js', 'renderer'),
        ('renderer/modules/news-classifier.js', 'renderer/modules'),
        ('renderer/modules/stock-quote.js', 'renderer/modules'),
        ('renderer/modules/history-storage.js', 'renderer/modules'),
        ('renderer/收款码5元.png', 'renderer'),
    ],
    hiddenimports=['websocket', 'websocket._app', 'data_source_manager'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pandas', 'numpy', 'schedule'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='财经新闻聚合播报_v3.6.0',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
