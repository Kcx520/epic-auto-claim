@echo off
chcp 65001 >nul
title Epic Auto Claim - Claim Now
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
type "messages\claim.txt"
echo.
call node claim.js --headed
echo.
pause
