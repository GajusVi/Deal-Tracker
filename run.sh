#!/usr/bin/env bash
# Deal Tracker launcher for macOS / Linux. First run creates a local virtualenv.
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if [ ! -d .venv ]; then
  echo "First run: setting up (this takes a minute)…"
  "$PY" -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
fi
exec .venv/bin/python run.py "$@"
