"""The updater moves data out of old copies, deletes them and replaces app files."""
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def make_install(path, marker=""):
    (path / "dealtracker").mkdir(parents=True)
    (path / "dealtracker" / "app.py").write_text("# app " + marker)
    (path / "run.py").write_text("")
    (path / "requirements.txt").write_text("")


def make_data(path, companies):
    import sqlite3

    (path / "data").mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path / "data" / "dealtracker.db")
    for t in ("companies", "contacts", "meetings"):
        con.execute(f"CREATE TABLE {t} (id INTEGER PRIMARY KEY, name TEXT)")
    con.executemany("INSERT INTO companies (name) VALUES (?)", [(c,) for c in companies])
    con.commit()
    con.close()


def run_update(app, home, *args, stdin=""):
    env = dict(os.environ, HOME=str(home), USERPROFILE=str(home))
    return subprocess.run([sys.executable, str(app / "update.py"), *args], env=env, input=stdin,
                          capture_output=True, text=True, timeout=60)


def test_update_moves_data_deletes_old_copy_and_replaces_files(tmp_path):
    home = tmp_path / "home"
    old = home / "Downloads" / "Deal-Tracker-main"
    make_install(old, "old")
    make_data(old, ["My Real Deal"])
    clone = home / "Desktop" / "Deal-Tracker"
    make_install(clone)
    (clone / ".git").mkdir()
    app = home / "Downloads" / "Deal-Tracker-main (1)" / "Deal-Tracker-main"
    make_install(app, "current")
    shutil.copy(ROOT / "update.py", app / "update.py")
    (app / "my-notes.txt").write_text("keep me")

    src = tmp_path / "zipsrc" / "Deal-Tracker-main"
    make_install(src, "latest")
    shutil.copy(ROOT / "update.py", src / "update.py")
    (src / "run.sh").write_text("#!/bin/sh\n")
    zip_path = tmp_path / "latest.zip"
    with zipfile.ZipFile(zip_path, "w") as z:
        for f in src.rglob("*"):
            z.write(f, f.relative_to(src.parent))

    r = run_update(app, home, "--yes", "--from-zip", str(zip_path))
    assert r.returncode == 0, r.stdout + r.stderr
    assert not old.exists()                                     # leftover version deleted
    assert clone.exists()                                       # git clones are never deleted
    assert (app / "data" / "dealtracker.db").exists()           # data moved in
    assert "latest" in (app / "dealtracker" / "app.py").read_text()  # app files replaced
    assert (app / "my-notes.txt").read_text() == "keep me"      # user's own files kept
    assert os.access(app / "run.sh", os.X_OK)


def test_newer_data_wins_and_older_data_is_backed_up(tmp_path):
    home = tmp_path / "home"
    old = home / "Downloads" / "Deal-Tracker-old"
    make_install(old)
    make_data(old, ["Old"])
    app = home / "Deal-Tracker"
    make_install(app)
    shutil.copy(ROOT / "update.py", app / "update.py")
    make_data(app, ["Current"])
    os.utime(old / "data" / "dealtracker.db", (1, 1))  # old copy last used long ago

    r = run_update(app, home, "--yes", "--cleanup-only")
    assert r.returncode == 0, r.stdout + r.stderr
    assert not old.exists()
    backups = list((app / "data-backups").iterdir())
    assert len(backups) == 1 and (backups[0] / "dealtracker.db").exists()


def test_declining_changes_nothing(tmp_path):
    home = tmp_path / "home"
    old = home / "Downloads" / "Deal-Tracker-old"
    make_install(old)
    make_data(old, ["Old"])
    app = home / "Deal-Tracker"
    make_install(app)
    shutil.copy(ROOT / "update.py", app / "update.py")
    r = run_update(app, home, "--cleanup-only", stdin="n\n")
    assert r.returncode == 0 and old.exists() and not (app / "data").exists()
