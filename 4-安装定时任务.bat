@echo off
chcp 65001 >nul
title Epic Auto Claim - Install Scheduled Task
cd /d "%~dp0"
type "messages\install-task.txt"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\install-task.ps1"
echo.
pause
