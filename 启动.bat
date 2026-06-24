@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "C:\Users\wolfj\.workbuddy\binaries\python\versions\3.13.12\pythonw.exe" app.py
