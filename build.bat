@echo off
chcp 936 >nul
set PYTHONUTF8=
set PYTHONIOENCODING=
title 涨停财经聚合播报 v4.4.1 构建
setlocal

echo ==========================================
echo  涨停财经聚合播报 v4.4.1（开源版）构建脚本
echo ==========================================
echo.

cd /d "%~dp0"

echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 goto NO_PY
echo   OK: Python 已找到

echo.
echo [2/4] 清理旧构建...
if exist "build" goto RM_BUILD
goto CK_OLD_EXE

:RM_BUILD
echo   删除 build 目录...
rd /s /q "build"

:CK_OLD_EXE
if not exist "dist\涨停财经聚合播报_v4.4.1.exe" goto CLEAN_DONE
echo   删除旧 exe...
del /q "dist\涨停财经聚合播报_v4.4.1.exe"

:CLEAN_DONE
echo   OK: 旧构建已清理

echo.
echo [3/4] 运行 PyInstaller...
pyinstaller 涨停财经聚合播报.spec --noconfirm
if errorlevel 1 goto BUILD_FAIL
echo   OK: PyInstaller 构建完成

echo.
if not exist "dist\涨停财经聚合播报_v4.4.1.exe" goto NO_EXE
echo [4/4] exe 文件已生成: dist\涨停财经聚合播报_v4.4.1.exe
goto DONE

:NO_EXE
echo [4/4] WARNING: 未找到预期的 exe 文件，请检查 dist 目录

:DONE
echo.
echo ==========================================
echo  构建完成！
echo ==========================================
echo.
echo  输出文件: dist\涨停财经聚合播报_v4.4.1.exe
echo.
echo  按任意键退出...
pause >nul
goto :EOF

:NO_PY
echo   ERROR: 未找到 Python，请确保已安装 Python 并添加到 PATH
pause
goto :EOF

:BUILD_FAIL
echo   ERROR: PyInstaller 构建失败
pause
goto :EOF
