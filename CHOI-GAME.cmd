@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% equ 0 (
  node server.js
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
) else (
  echo Please install Node.js 20 or newer, or use the VS Code Live Server extension.
)
pause
