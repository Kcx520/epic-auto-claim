@echo off
chcp 65001 >nul
title Epic Auto Claim - Remove Scheduled Task
cd /d "%~dp0"
type "messages\uninstall-task.txt"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\uninstall-task.ps1"
echo.
pause
