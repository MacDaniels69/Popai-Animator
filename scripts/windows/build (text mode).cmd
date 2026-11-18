@echo off
rem Same build as the installer window, but in a terminal (useful if the window does not open).
title Popai Animator - building the Windows app
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
