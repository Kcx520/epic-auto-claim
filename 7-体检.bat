@echo off
chcp 65001 >nul
title Epic Auto Claim - Check
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
type "messages\check.txt"
echo.
call node claim.js --check
echo.
pause
