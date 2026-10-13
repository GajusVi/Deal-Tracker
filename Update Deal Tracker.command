#!/usr/bin/env bash
# Update Deal Tracker to the latest version and remove old copies. Your data is kept.
cd "$(dirname "$0")"
exec "${PYTHON:-python3}" update.py --pause "$@"
