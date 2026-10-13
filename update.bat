@echo off
rem Update Deal Tracker to the latest version and remove old copies. Your data is kept.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 update.py --pause %* & exit /b) || (python update.py --pause %* & exit /b)
