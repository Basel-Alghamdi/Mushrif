@echo off
rem Double-click to run Rasd locally: http://localhost:3000
cd /d "%~dp0"
call pnpm install --frozen-lockfile
call pnpm local
pause
