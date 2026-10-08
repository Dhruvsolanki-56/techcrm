@echo off
title TechSentinals CRM
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install --omit=dev
)
start "" http://localhost:3000
node server.js
pause
