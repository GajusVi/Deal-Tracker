#!/usr/bin/env python3
"""Update Deal Tracker to the latest version and remove old copies.

Double-click "Update Deal Tracker.command" (macOS) or update.bat (Windows), or run ./update.sh.

1. Looks for other Deal Tracker folders (Downloads, Desktop, Documents, and next to
   this one), brings the most recently used data into this copy and deletes the old
   folders after asking. Data that isn't kept is saved to data-backups/ first.
2. Downloads the latest version from GitHub and replaces the app files in this folder.
   Your data/ folder, data-backups/ and any files of your own are never touched.

Options: --yes (don't ask), --cleanup-only (skip the download),
         --from-zip PATH (update from a ZIP you already downloaded).
"""
import argparse
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

REPO = "https://github.com/GajusVi/Deal-Tracker"
ZIP_URL = f"{REPO}/archive/refs/heads/main.zip"
APP = Path(__file__).resolve().parent

# Never removed or replaced by an update.
KEEP = {"data", "data-backups", ".venv", ".git"}
# Top-level entries that belong to the app (in addition to whatever the new ZIP contains).
APP_ENTRIES = {
    "dealtracker", "static", "samples", "docs", "tests", "run.py", "run.sh", "run.bat",
    "Start Deal Tracker.command", "update.py", "update.sh", "update.bat", "Update Deal Tracker.command",
    "requirements.txt", "README.md", ".gitignore", "__pycache__", ".pytest_cache",
}


def say(msg=""):
    print(msg, flush=True)


def ask(question, yes, default=True):
    if yes:
        return True
    hint = "[Y/n]" if default else "[y/N]"
    try:
        answer = input(f"{question} {hint} ").strip().lower()
    except EOFError:
        return default
    return default if not answer else answer in ("y", "yes")


def is_install(p):
    return (p / "dealtracker" / "app.py").is_file() and (p / "run.py").is_file()


def data_info(p):
    """None when the folder has no data; otherwise last-changed time and record counts."""
    data = p / "data"
    db = data / "dealtracker.db"
    if not db.is_file():
        return None
    files = [f for f in data.rglob("*") if f.is_file()]
    info = {"mtime": max(f.stat().st_mtime for f in files), "counts": {}}
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        for t in ("companies", "contacts", "meetings"):
            info["counts"][t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        con.close()
    except sqlite3.Error:
        info["counts"] = None  # unreadable: treat as real data, never discard it
    if info["counts"] is not None and not any(info["counts"].values()):
        return None  # started once, nothing added
    return info


def describe(info):
    if not info:
        return "no data"
    when = datetime.fromtimestamp(info["mtime"]).strftime("%d %b %Y %H:%M")
    if info["counts"] is None:
        return f"data last changed {when}"
    c = info["counts"]
    return f"{c['companies']} companies, {c['contacts']} contacts, {c['meetings']} meetings · last changed {when}"


def search_roots():
    home = Path.home()
    roots = [APP.parent, home / "Downloads", home / "Desktop", home / "Documents", home]
    one_drive = os.environ.get("OneDrive")
    if one_drive:
        roots += [Path(one_drive) / "Desktop", Path(one_drive) / "Documents"]
    out = []
    for r in roots:
        try:
            r = r.resolve()
        except OSError:
            continue
        if r.is_dir() and r not in out:
            out.append(r)
    return out


def subdirs(p):
    try:
        return [c for c in p.iterdir() if c.is_dir() and "deal" in c.name.lower()]
    except OSError:
        return []


def find_old_copies():
    found = []
    for root in search_roots():
        for d in subdirs(root):
            for cand in [d] + subdirs(d):  # e.g. Downloads/Deal-Tracker-main (1)/Deal-Tracker-main
                try:
                    cand = cand.resolve()
                except OSError:
                    continue
                if cand == APP or APP in cand.parents or cand in APP.parents or cand in found:
                    continue
                if is_install(cand):
                    found.append(cand)
    return found


def app_running():
    try:
        urllib.request.urlopen("http://127.0.0.1:5050/api/meta", timeout=1)
        return True
    except Exception:
        return False


def force_remove(path):
    def onerror(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, onerror=onerror)
    elif path.exists() or path.is_symlink():
        os.chmod(path, stat.S_IWRITE)
        path.unlink()


def backup_data(src, label):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = APP / "data-backups" / f"{stamp}-{label}"
    shutil.copytree(src / "data", dest)
    return dest


def tidy_old_copies(olds, yes):
    mine = data_info(APP)
    infos = {o: data_info(o) for o in olds}
    say(f"Found {len(olds)} other Deal Tracker folder(s):")
    for o in olds:
        note = "  (git clone, will be left alone)" if (o / ".git").exists() else ""
        say(f"  • {o}\n      {describe(infos[o])}{note}")
    say(f"This folder: {APP}\n      {describe(mine)}")
    say()

    candidates = ([(APP, mine)] if mine else []) + [(o, i) for o, i in infos.items() if i]
    keep_from = max(candidates, key=lambda c: c[1]["mtime"])[0] if candidates else None
    to_backup = [p for p, _ in candidates if p != keep_from]
    to_delete = [o for o in olds if not (o / ".git").exists()]

    if keep_from and keep_from != APP:
        say(f"The most recent data is in {keep_from}. It will be moved into this folder.")
    for p in to_backup:
        say(f"Data in {p} will be saved to data-backups/ so nothing is lost.")
    if to_delete:
        say("These folders will be deleted:")
        for o in to_delete:
            say(f"  ✕ {o}")
    if not (to_delete or (keep_from and keep_from != APP)):
        return
    if not ask("Go ahead?", yes):
        say("Old copies left as they are.\n")
        return

    for p in to_backup:
        say(f"Saved {p.name} data to {backup_data(p, p.name.replace(' ', '_'))}")
    if keep_from and keep_from != APP:
        if (APP / "data").exists():
            force_remove(APP / "data")
        shutil.copytree(keep_from / "data", APP / "data")
        say(f"Moved data from {keep_from} into this folder.")
    for o in to_delete:
        try:
            force_remove(o)
            say(f"Deleted {o}")
        except OSError as exc:
            say(f"Could not delete {o}: {exc}. Close any window using it and delete it by hand.")
    say()


def download(url, dest):
    try:
        with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
        return
    except Exception as exc:
        first_error = exc
    # Some Python installs (often on macOS) lack root certificates; fall back to the OS tools.
    if shutil.which("curl"):
        if subprocess.run(["curl", "-fsSL", "-o", str(dest), url]).returncode == 0:
            return
    if os.name == "nt":
        ps = f"Invoke-WebRequest -UseBasicParsing -Uri '{url}' -OutFile '{dest}'"
        if subprocess.run(["powershell", "-NoProfile", "-Command", ps]).returncode == 0:
            return
    raise RuntimeError(f"Download failed: {first_error}")


def update_from_zip(zip_path):
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
        tops = [p for p in Path(tmp).iterdir() if p.is_dir()]
        new = tops[0] if len(tops) == 1 and not is_install(Path(tmp)) else Path(tmp)
        if not is_install(new):
            raise RuntimeError("The download doesn't look like Deal Tracker. Nothing was changed.")
        if data_info(APP):
            backup_data(APP, "before-update")
        incoming = {p.name for p in new.iterdir()} - KEEP
        for name in (APP_ENTRIES | incoming) - KEEP:
            target = APP / name
            if target.exists() or target.is_symlink():
                force_remove(target)
        for name in sorted(incoming):
            src = new / name
            if src.is_dir():
                shutil.copytree(src, APP / name)
            else:
                shutil.copy2(src, APP / name)
    for f in list(APP.glob("*.sh")) + list(APP.glob("*.command")):
        f.chmod(f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def prune_backups(keep=10):
    folder = APP / "data-backups"
    if folder.is_dir():
        for old in sorted(p for p in folder.iterdir() if p.is_dir())[:-keep]:
            force_remove(old)


def refresh_dependencies():
    venv = APP / ".venv"
    if not venv.is_dir():
        return
    py = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    ok = py.exists() and subprocess.run(
        [str(py), "-m", "pip", "install", "--quiet", "-r", str(APP / "requirements.txt")]).returncode == 0
    if not ok:
        force_remove(venv)  # rebuilt automatically on the next start
        say("Dependencies will be reinstalled the next time you start Deal Tracker.")


def main():
    ap = argparse.ArgumentParser(description="Update Deal Tracker and remove old copies.")
    ap.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    ap.add_argument("--cleanup-only", action="store_true", help="only tidy old copies, don't download")
    ap.add_argument("--from-zip", help="update from a ZIP you already downloaded")
    ap.add_argument("--pause", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    say("Deal Tracker updater\n")
    if not is_install(APP):
        say(f"{APP} doesn't look like a Deal Tracker folder. Nothing was changed.")
        return 1
    if app_running():
        say("Deal Tracker is still running. Close its terminal window, then run the update again.")
        return 1

    olds = find_old_copies()
    if olds:
        tidy_old_copies(olds, args.yes)
    else:
        say("No old copies found.\n")

    if not args.cleanup_only:
        try:
            if (APP / ".git").is_dir() and shutil.which("git") and not args.from_zip:
                say("Updating with git…")
                if subprocess.run(["git", "-C", str(APP), "pull", "--ff-only"]).returncode != 0:
                    say("git pull didn't complete. Resolve it in the folder, then run the update again.")
                    return 1
            else:
                if args.from_zip:
                    zip_path = Path(args.from_zip).expanduser().resolve()
                else:
                    say(f"Downloading the latest version from {REPO} …")
                    zip_path = Path(tempfile.mkdtemp()) / "deal-tracker.zip"
                    download(ZIP_URL, zip_path)
                update_from_zip(zip_path)
            say("App files updated. Your data was kept.")
            refresh_dependencies()
        except Exception as exc:
            say(f"Update failed: {exc}")
            say("Your data is safe in the data folder. Check your internet connection and try again.")
            return 1
    prune_backups()
    say("\nDone. Start Deal Tracker as usual.")
    return 0


if __name__ == "__main__":
    code = main()
    if "--pause" in sys.argv:
        try:
            input("\nPress Enter to close.")
        except EOFError:
            pass
    sys.exit(code)
