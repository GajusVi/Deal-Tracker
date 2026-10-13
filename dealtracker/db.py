"""SQLite storage: schema, connection handling and small query helpers."""
import json
import os
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    codename        TEXT,
    logo_path       TEXT,
    color           TEXT DEFAULT '#3b5bdb',
    sector          TEXT,
    subsector       TEXT,
    website         TEXT,
    description     TEXT,
    hq_city         TEXT,
    country         TEXT,
    region          TEXT,
    stage           TEXT,
    status          TEXT DEFAULT 'Active',
    priority        TEXT DEFAULT 'Medium',
    deal_type       TEXT,
    source          TEXT,
    advisor         TEXT,
    deal_lead       TEXT,
    currency        TEXT DEFAULT 'USD',
    ev              REAL,
    revenue         REAL,
    ebitda          REAL,
    employees       INTEGER,
    founded_year    INTEGER,
    ownership       TEXT,
    next_step       TEXT,
    next_step_date  TEXT,
    tags            TEXT,
    key_facts       TEXT DEFAULT '{}',
    stage_changed_at TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    from_stage  TEXT,
    to_stage    TEXT NOT NULL,
    changed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    title         TEXT,
    organization  TEXT,
    company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    contact_type  TEXT,
    email         TEXT,
    phone         TEXT,
    linkedin      TEXT,
    city          TEXT,
    country       TEXT,
    strength      INTEGER DEFAULT 3,
    notes         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    role        TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(company_id, contact_id)
);

CREATE TABLE IF NOT EXISTS contact_links (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    to_contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    relation         TEXT,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    meeting_type   TEXT,
    company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    starts_at      TEXT NOT NULL,
    duration_min   INTEGER DEFAULT 60,
    location       TEXT,
    notes          TEXT,
    takeaways      TEXT,
    next_steps     TEXT,
    sentiment      TEXT,
    tags           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_attendees (
    meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, contact_id)
);

CREATE TABLE IF NOT EXISTS documents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    filename       TEXT NOT NULL,
    stored_name    TEXT NOT NULL,
    size           INTEGER,
    version        INTEGER,
    label          TEXT,
    text_content   TEXT,
    analysis       TEXT,
    uploaded_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    entity_type  TEXT NOT NULL,
    entity_id    INTEGER,
    action       TEXT NOT NULL,
    summary      TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_starts ON meetings(starts_at);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
"""

DEFAULT_SETTINGS = {
    "firm_name": "My Fund",
    "base_currency": "USD",
    "stages": [
        "Sourcing", "NDA Signed", "CIM Review", "IOI Submitted",
        "Management Meeting", "LOI", "Due Diligence", "Closed", "Passed",
    ],
    "sectors": [
        "Software & Tech", "Healthcare", "Industrials", "Business Services",
        "Consumer & Retail", "Financial Services", "Energy & Infrastructure",
        "Education", "Media & Telecom", "Transportation & Logistics",
        "Food & Agriculture", "Real Estate",
    ],
    "deal_types": ["Buyout", "Growth Equity", "Add-on", "Minority", "Carve-out", "Recap", "Take-private"],
    "meeting_types": [
        "Management Presentation", "Banker / Advisor Call", "Expert Call",
        "Industry / Market Meeting", "Site Visit", "Investment Committee",
        "Internal", "Conference",
    ],
    "contact_types": [
        "Management", "Banker / Advisor", "Industry Expert", "Co-investor",
        "Lender", "Operating Partner", "LP", "Internal", "Other",
    ],
    "team_members": ["Alex Morgan", "Owen Brooks"],
    "pass_reasons": [
        "Valuation gap", "Business quality", "Market / sector view", "Management concerns",
        "Size / fit with fund", "Customer concentration", "Lost in process", "Timing",
        "Diligence finding", "Other",
    ],
    "cold_days": 60,
    "anthropic_api_key": "",
}

# Columns added after the first release; init_db adds any that an older database lacks.
MIGRATIONS = {
    "companies": [
        ("deal_team", "TEXT"),          # comma-separated names besides the lead
        ("pass_reason", "TEXT"),
        ("pass_notes", "TEXT"),
        ("revisit_date", "TEXT"),
        ("nda_signed_date", "TEXT"),
        ("nda_expiry_date", "TEXT"),
    ],
    "contacts": [
        ("owner", "TEXT"),              # team member who owns the relationship
    ],
}

# Stages that count as "closed out" (not part of the live pipeline).
TERMINAL_STAGES = {"Closed", "Passed"}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def data_dir():
    return current_app.config["DATA_DIR"]


def upload_dir(sub):
    path = os.path.join(data_dir(), "uploads", sub)
    os.makedirs(path, exist_ok=True)
    return path


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DB_PATH"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(path):
    conn = connect(path)
    conn.executescript(SCHEMA)
    for table, cols in MIGRATIONS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols:
            if col not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    for key, value in DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
    conn.commit()
    conn.close()


def rows(cursor):
    return [dict(r) for r in cursor.fetchall()]


def row(cursor):
    r = cursor.fetchone()
    return dict(r) if r else None


def get_settings(db=None):
    db = db or get_db()
    out = {}
    for r in db.execute("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


def set_setting(key, value, db=None):
    db = db or get_db()
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def log_activity(db, action, entity_type, entity_id=None, company_id=None, summary=None):
    db.execute(
        "INSERT INTO activity (company_id, entity_type, entity_id, action, summary, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (company_id, entity_type, entity_id, action, summary, now_iso()),
    )
