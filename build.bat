@echo off
chcp 65001 >nul
setlocal

echo ==========================================
echo  涨停财经聚合播报 v3.8.0（开源版）构建脚本
echo ==========================================
echo.

cd /d "%~dp0"

:: 检查 Python 环境
echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo   ERROR: 未找到 Python，请确保已安装 Python 并添加到 PATH
    pause
    exit /b 1
)
echo   OK: Python 已找到

:: 清理旧构建
echo.
echo [2/4] 清理旧构建...
if exist "build\" (
    echo   删除 build 目录...
    rd /s /q "build"
)
if exist "dist\涨停财经聚合播报_v3.8.0.exe" (
    echo   删除旧 exe...
    del /q "dist\涨停财经聚合播报_v3.8.0.exe"
)
echo   OK: 旧构建已清理

:: 运行 PyInstaller
echo.
echo [3/4] 运行 PyInstaller...
pyinstaller 涨停财经聚合播报.spec --noconfirm
if errorlevel 1 (
    echo   ERROR: PyInstaller 构建失败
    pause
    exit /b 1
)
echo   OK: PyInstaller 构建完成

:: 重命名 exe（如需要）
if exist "dist\涨停财经聚合播报_v3.8.0.exe" (
    echo.
    echo [4/4] exe 文件已生成: dist\涨停财经聚合播报_v3.8.0.exe
) else (
    echo.
    echo [4/4] WARNING: 未找到预期的 exe 文件，请检查 dist 目录
)

echo.
echo ==========================================
echo  构建完成！
echo ==========================================
echo.
echo  输出文件: dist\涨停财经聚合播报_v3.8.0.exe
echo.
echo  按任意键退出...
pause >nul
