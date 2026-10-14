@echo off
title TechSentinals CRM
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
)
if not exist server\dist\main.js (
  echo Building - first run only...
  call npm run build
)
call npm run migrate
start "" http://localhost:3000
call npm start
pause
