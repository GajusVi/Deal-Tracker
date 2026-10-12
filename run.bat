@echo off
rem Deal Tracker launcher for Windows. First run creates a local virtualenv.
cd /d "%~dp0"
if not exist .venv (
  echo First run: setting up, this takes a minute...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -r requirements.txt
)
.venv\Scripts\python run.py %*
