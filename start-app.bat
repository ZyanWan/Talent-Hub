@echo off
rem One-click start: backend (launcher.py) + frontend auto-rebuild (vite build --watch)
rem Close the two opened windows to stop.
cd /d "%~dp0"
start "Talent Hub - Backend" powershell -NoExit -Command "python launcher.py"
start "Talent Hub - Frontend Watch" powershell -NoExit -Command "cd frontend; npm run build -- --watch"
echo Started. Browser should open at http://127.0.0.1:8765/
echo Close the two windows to stop.
