@echo off
chcp 65001 >nul
title Epic Auto Claim - Login
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
type "messages\login.txt"
echo.
call node claim.js --login
echo.
echo ============================================================
echo   Login step finished. You can close this window.
echo ============================================================
echo.
pause
