@echo off
rem Opens the Popai Animator installer window (no terminal needed).
cd /d "%~dp0"
start "" powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0scripts\windows\installer-gui.ps1"
