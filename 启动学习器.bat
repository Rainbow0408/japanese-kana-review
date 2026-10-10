@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 goto try_py
node tools\serve.mjs --open
if errorlevel 1 pause
exit /b

:try_py
py -3 --version >nul 2>&1
if errorlevel 1 goto try_python
start "" /b py -3 -m http.server 8765 --bind 127.0.0.1
goto open_page

:try_python
python --version >nul 2>&1
if errorlevel 1 goto missing_runtime
start "" /b python -m http.server 8765 --bind 127.0.0.1

:open_page
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8765/
exit /b

:missing_runtime
echo Please install Node.js or Python, then run this launcher again.
pause
