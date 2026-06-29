@echo off
:: 涨停财经聚合播报 v3.8.0（开源版）
:: 开发模式启动脚本 - 使用本地 Python 环境运行
:: 打包后的 exe 位于 dist/ 目录

chcp 65001 >nul
cd /d "%~dp0"
start "" "C:\Users\wolfj\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe" app.py