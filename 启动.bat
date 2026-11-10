@echo off
:: 涨停财经聚合播报 v4.4.6（开源版）
:: 开发模式启动脚本 - 使用项目本地 .venv 运行
:: 打包后的 exe 位于 dist/ 目录
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ---------------------------------------------------------------
rem 2026-10-31 修复：原先直接调 PATH 上的 pythonw，那是裸解释器，
rem 没装 pywebview/akshare，双击即闪退。改为候选探测 + 实测 import。
rem 只判断解释器文件存在不算数 —— 解释器在、包没了照样起不来。
rem 2026-11-10 体检：消除跨行括号块（bat 规范），改 call 子过程结构，
rem 判据不变：候选解释器必须实测 import webview, akshare 才算可用。
rem ---------------------------------------------------------------
set "PYW="
if exist ".venv\Scripts\pythonw.exe" call :TRY ".venv\Scripts\python.exe" ".venv\Scripts\pythonw.exe"
if defined PYW goto HAVE_PY

for /f "delims=" %%I in ('where pythonw 2^>nul') do if not defined PYW call :TRY "%%~dpIpython.exe" "%%I"
if not defined PYW goto NOPYTHON

:HAVE_PY
start "" "%PYW%" app.py
goto :eof

:TRY
%1 -c "import webview, akshare" >nul 2>&1 && set "PYW=%~2"
goto :eof

:NOPYTHON
echo.
echo   [错误] 未找到可用的 Python 环境（需要已装 pywebview / akshare）
echo.
echo   已尝试：
echo     1) .venv\Scripts\pythonw.exe
echo     2) PATH 上的 pythonw
echo.
echo   修复：在本目录执行
echo     uv venv --python 3.13
echo     uv pip install -r requirements.txt
echo.
pause
goto :eof
