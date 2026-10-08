@echo off
title TechSentinals CRM - DEMO DATA
cd /d "%~dp0"
if not exist demo-data call node scripts\seed-demo.js
set CRM_DATA_DIR=demo-data
set PORT=3001
start "" http://localhost:3001
node server.js
pause
