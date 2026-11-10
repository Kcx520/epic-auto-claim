@echo off
chcp 65001 >nul
title Epic Auto Claim - Install
cd /d "%~dp0"
type "messages\install.txt"
echo.

set "NODE_DIR="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_DIR set "NODE_DIR=%%~dpI"
if not defined NODE_DIR if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs\"
if defined NODE_DIR goto have_node

echo [1/2] Node.js not found. Trying winget ...
where winget >nul 2>nul
if errorlevel 1 goto download_node
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs\"
if defined NODE_DIR goto have_node

:download_node
echo [1/2] Downloading Node.js LTS from nodejs.org ...
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\install-node.ps1"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs\"
if defined NODE_DIR goto have_node
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs\"
if defined NODE_DIR goto have_node
goto no_node

:have_node
set "PATH=%NODE_DIR%;%PATH%"
echo.
echo Node.js version:
node --version
echo.
echo [2/2] Installing dependencies (playwright-core, nodemailer) ...
call npm install --no-audit --no-fund
if errorlevel 1 goto npm_fail

echo.
echo ============================================================
echo   Install finished.
echo   Next step: double-click the LOGIN starter in this folder
echo   (the file whose name starts with "2-"), then see README.md
echo ============================================================
goto end

:no_node
echo.
echo [ERROR] Could not install Node.js automatically.
echo Please install "Node.js LTS" manually from https://nodejs.org/
echo then run this file again.
goto end

:npm_fail
echo.
echo [ERROR] npm install failed.
echo Please check your network or proxy, then run this file again.
goto end

:end
echo.
pause
