@echo off
title Popai Animator - building the Windows app
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\build.ps1"
