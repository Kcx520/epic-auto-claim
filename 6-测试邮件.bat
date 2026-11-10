@echo off
chcp 65001 >nul
title Epic Auto Claim - Test Email
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
type "messages\test-email.txt"
echo.
call node claim.js --test-email
echo.
pause
