"""Flask application: JSON API + static single-page UI."""
import csv
import io
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from . import db as dbm
from .db import get_db, log_activity, now_iso, row, rows
from .extractor import analyze_pages, extract_pages, fact_updates
from .geo import ALL_COUNTRIES, REGIONS, region_for
from . import insights
from .seed import demo_counts
from .models_parser import parse_model

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")

LOGO_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
DOC_KINDS = {"cim", "teaser", "model", "nda", "diligence", "other"}

COMPANY_FIELDS = {
    "name": str, "codename": str, "color": str, "sector": str, "subsector": str, "website": str,
    "description": str, "hq_city": str, "country": str, "region": str, "stage": str, "status": str,
    "priority": str, "deal_type": str, "source": str, "advisor": str, "deal_lead": str, "currency": str,
    "ev": float, "revenue": float, "ebitda": float, "employees": int, "founded_year": int,
    "ownership": str, "next_step": str, "next_step_date": str, "tags": str, "deal_team": str,
    "pass_reason": str, "pass_notes": str, "revisit_date": str, "nda_signed_date": str, "nda_expiry_date": str,
}
CONTACT_FIELDS = {
    "name": str, "title": str, "organization": str, "company_id": int, "contact_type": str,
    "email": str, "phone": str, "linkedin": str, "city": str, "country": str, "strength": int, "notes": str,
    "owner": str,
}
MEETING_FIELDS = {
    "title": str, "meeting_type": str, "company_id": int, "starts_at": str, "duration_min": int,
    "location": str, "notes": str, "takeaways": str, "next_steps": str, "sentiment": str, "tags": str,
}


def _coerce(data, spec):
    out = {}
    for k, typ in spec.items():
        if k not in data:
            continue
        v = data[k]
        if v is None or (isinstance(v, str) and v.strip() == ""):
            out[k] = None
            continue
        try:
            if typ is int:
                out[k] = int(float(v))
            elif typ is float:
                out[k] = float(str(v).replace(",", ""))
            else:
                out[k] = str(v).strip()
        except (TypeError, ValueError):
            abort(400, f"Invalid value for {k}")
    return out


def _utc(value):
    """Normalise an ISO datetime (local-naive, Z or offset) to UTC '+00:00' text so string ordering works."""
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        abort(400, "Invalid date/time")
    if d.tzinfo is None:
        d = d.astimezone()  # naive = local time of this machine
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _err(msg, code=400):
    return jsonify({"error": msg}), code


def create_app(data_dir=None):
    app = Flask(__name__, static_folder=None)
    data_dir = data_dir or os.environ.get("DEALTRACKER_DATA") or os.path.join(ROOT, "data")
    os.makedirs(data_dir, exist_ok=True)
    app.config.update(
        DATA_DIR=data_dir,
        DB_PATH=os.path.join(data_dir, "dealtracker.db"),
        MAX_CONTENT_LENGTH=250 * 1024 * 1024,
        JSON_SORT_KEYS=False,
    )
    dbm.init_db(app.config["DB_PATH"])
    app.teardown_appcontext(dbm.close_db)

    with app.app_context():
        _cleanup_orphans()

    @app.errorhandler(400)
    @app.errorhandler(404)
    @app.errorhandler(413)
    def _http_error(e):
        if request.path.startswith("/api/"):
            return jsonify({"error": getattr(e, "description", str(e))}), e.code
        return e

    # ------------------------------------------------------------------ static
    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    @app.get("/static/<path:p>")
    def static_files(p):
        resp = send_from_directory(STATIC, p)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/files/logos/<name>")
    def logo_file(name):
        resp = send_from_directory(dbm.upload_dir("logos"), name)
        resp.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    # -------------------------------------------------------------------- meta
    @app.get("/api/meta")
    def meta():
        s = dbm.get_settings()
        key = s.pop("anthropic_api_key", "")
        from .ai import api_key_from

        return jsonify({
            "settings": s,
            "has_stored_api_key": bool(key),
            "ai_enabled": bool(api_key_from({"anthropic_api_key": key})),
            "ai_from_env": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "regions": list(REGIONS),
            "countries": [{"name": c, "region": region_for(c)} for c in ALL_COUNTRIES],
            "terminal_stages": sorted(dbm.TERMINAL_STAGES),
            "data_dir": app.config["DATA_DIR"],
            "demo": demo_counts(get_db()),
        })

    @app.put("/api/settings")
    def put_settings():
        data = request.get_json(force=True) or {}
        db = get_db()
        allowed = set(dbm.DEFAULT_SETTINGS)
        for k, v in data.items():
            if k not in allowed:
                continue
            if k == "cold_days":
                try:
                    v = max(7, int(v))
                except (TypeError, ValueError):
                    return _err("cold_days must be a number of days")
            if k in ("stages", "sectors", "deal_types", "meeting_types", "contact_types", "pass_reasons"):
                if not isinstance(v, list) or not v or not all(isinstance(x, str) and x.strip() for x in v):
                    return _err(f"{k} must be a list of names")
                v = [x.strip() for x in v]
            if k == "team_members":
                if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                    return _err("team_members must be a list of names")
                v = [x.strip() for x in v if x.strip()]
            dbm.set_setting(k, v, db)
        db.commit()
        return meta()

    # --------------------------------------------------------------- dashboard
    @app.get("/api/dashboard")
    def dashboard():
        db = get_db()
        s = dbm.get_settings(db)
        stages = s["stages"]
        comps = [_decorate_company(c) for c in rows(db.execute("SELECT * FROM companies"))]
        live = [c for c in comps if c["stage"] not in dbm.TERMINAL_STAGES and c["status"] != "Passed"]

        by_stage = []
        for st in stages:
            cs = [c for c in comps if c["stage"] == st]
            by_stage.append({"stage": st, "count": len(cs), "ev": sum(c["ev"] or 0 for c in cs)})

        def group(key, items):
            out = {}
            for c in items:
                k = c.get(key) or "Unassigned"
                o = out.setdefault(k, {"name": k, "count": 0, "ev": 0})
                o["count"] += 1
                o["ev"] += c["ev"] or 0
            return sorted(out.values(), key=lambda x: (-x["count"], x["name"]))

        today = date.today().isoformat()
        since30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        meetings_30 = db.execute("SELECT COUNT(*) FROM meetings WHERE starts_at >= ? AND starts_at <= ?",
                                 (since30, now_iso())).fetchone()[0]
        upcoming_meetings = rows(db.execute(
            "SELECT m.id, m.title, m.starts_at, m.meeting_type, m.company_id, c.name AS company_name, "
            "c.color AS company_color, c.logo_path AS company_logo FROM meetings m "
            "LEFT JOIN companies c ON c.id = m.company_id WHERE m.starts_at >= ? ORDER BY m.starts_at LIMIT 8",
            (now_iso()[:16],),
        ))
        for m in upcoming_meetings:
            m["company_logo_url"] = _logo_url(m.pop("company_logo"))
        next_steps = sorted(
            [{"company_id": c["id"], "company_name": c["name"], "color": c["color"], "logo_url": c["logo_url"],
              "next_step": c["next_step"], "date": c["next_step_date"], "overdue": bool(c["next_step_date"] and c["next_step_date"] < today)}
             for c in live if c["next_step"]],
            key=lambda x: x["date"] or "9999",
        )[:10]

        months = []
        d = date.today().replace(day=1)
        for _ in range(12):
            months.append(d.strftime("%Y-%m"))
            d = (d - timedelta(days=1)).replace(day=1)
        months.reverse()
        mcount = {r[0]: r[1] for r in db.execute(
            "SELECT substr(starts_at,1,7) AS ym, COUNT(*) FROM meetings GROUP BY ym")}
        added = {r[0]: r[1] for r in db.execute(
            "SELECT substr(created_at,1,7) AS ym, COUNT(*) FROM companies GROUP BY ym")}

        return jsonify({
            "kpis": {
                "live_deals": len(live),
                "pipeline_ev": sum(c["ev"] or 0 for c in live),
                "pipeline_revenue": sum(c["revenue"] or 0 for c in live),
                "pipeline_ebitda": sum(c["ebitda"] or 0 for c in live),
                "total_companies": len(comps),
                "closed": sum(1 for c in comps if c["stage"] == "Closed"),
                "passed": sum(1 for c in comps if c["stage"] == "Passed" or c["status"] == "Passed"),
                "meetings_30d": meetings_30,
                "contacts": db.execute("SELECT COUNT(*) FROM contacts").fetchone()[0],
                "high_priority": sum(1 for c in live if c["priority"] == "High"),
            },
            "by_stage": by_stage,
            "by_sector": group("sector", live),
            "by_region": group("region", live),
            "by_country": group("country", live)[:10],
            "upcoming_meetings": upcoming_meetings,
            "next_steps": next_steps,
            "activity_by_month": [{"month": m, "meetings": mcount.get(m, 0), "companies": added.get(m, 0)} for m in months],
            "recent_activity": _activity(limit=14),
            "attention": insights.attention(db, s)[:12],
            "intermediaries": insights.intermediaries(db, stages)[:8],
            "knowledge": _avg([kn["score"] for cid, kn in insights.knowledge(db, live).items()]),
            "team": insights.team_overview(db, s),
            "base_currency": s.get("base_currency", "USD"),
        })

    # --------------------------------------------------------------- companies
    @app.get("/api/companies")
    def list_companies():
        db = get_db()
        q = request.args.get("q", "").strip()
        sql = "SELECT * FROM companies WHERE 1=1"
        args = []
        if q:
            sql += " AND (name LIKE ? OR codename LIKE ? OR description LIKE ? OR tags LIKE ? OR sector LIKE ? OR country LIKE ?)"
            args += [f"%{q}%"] * 6
        for f in ("stage", "sector", "region", "country", "status", "priority", "deal_type"):
            v = request.args.get(f)
            if v:
                sql += f" AND {f} = ?"
                args.append(v)
        sql += " ORDER BY updated_at DESC"
        comps = [_decorate_company(c) for c in rows(db.execute(sql, args))]
        stats = {r["company_id"]: r for r in rows(db.execute(
            "SELECT company_id, COUNT(*) AS n, MAX(starts_at) AS last FROM meetings "
            "WHERE company_id IS NOT NULL GROUP BY company_id"))}
        ccount = {r[0]: r[1] for r in db.execute(
            "SELECT company_id, COUNT(DISTINCT contact_id) FROM ("
            " SELECT company_id, contact_id FROM company_contacts"
            " UNION SELECT company_id, id FROM contacts WHERE company_id IS NOT NULL) GROUP BY company_id")}
        dcount = {r[0]: r[1] for r in db.execute(
            "SELECT company_id, COUNT(*) FROM documents WHERE company_id IS NOT NULL GROUP BY company_id")}
        kn = insights.knowledge(db, comps)
        for c in comps:
            c["knowledge"] = kn[c["id"]]["score"]
            st = stats.get(c["id"])
            c["meeting_count"] = st["n"] if st else 0
            c["last_meeting_at"] = st["last"] if st else None
            c["contact_count"] = ccount.get(c["id"], 0)
            c["document_count"] = dcount.get(c["id"], 0)
        return jsonify(comps)

    @app.post("/api/companies")
    def create_company():
        data = request.get_json(force=True) or {}
        fields = _coerce(data, COMPANY_FIELDS)
        if not fields.get("name"):
            return _err("Company name is required")
        db = get_db()
        s = dbm.get_settings(db)
        # Creating from a CIM: fill any field the user left blank from the accepted facts.
        doc_id = data.get("cim_document_id")
        accepted = data.get("accepted_facts")
        if doc_id and accepted:
            for k, v in _coerce(fact_updates(accepted), COMPANY_FIELDS).items():
                if fields.get(k) in (None, "") and v not in (None, ""):
                    fields[k] = v
        fields = {k: v for k, v in fields.items() if v is not None}
        if not fields.get("stage"):
            fields["stage"] = s["stages"][0]
        if not fields.get("color"):
            fields["color"] = "#3b5bdb"
        if fields.get("country") and not fields.get("region"):
            fields["region"] = region_for(fields["country"])
        ts = now_iso()
        fields.update(created_at=ts, updated_at=ts, stage_changed_at=ts)
        cols = ", ".join(fields)
        cur = db.execute(f"INSERT INTO companies ({cols}) VALUES ({', '.join('?' * len(fields))})", list(fields.values()))
        cid = cur.lastrowid
        db.execute("INSERT INTO stage_history (company_id, from_stage, to_stage, changed_at) VALUES (?,?,?,?)",
                   (cid, None, fields["stage"], ts))
        log_activity(db, "created", "company", cid, cid, f"Added {fields['name']} to the pipeline")

        # Optional: attach a CIM analyzed before the company existed and store its facts.
        if doc_id:
            doc = row(db.execute("SELECT * FROM documents WHERE id = ? AND company_id IS NULL", (doc_id,)))
            if doc:
                db.execute("UPDATE documents SET company_id = ? WHERE id = ?", (cid, doc_id))
                analysis = json.loads(doc["analysis"] or "{}")
                if accepted is not None:
                    _store_key_facts(db, cid, accepted, analysis, doc_id)
                log_activity(db, "uploaded", "document", doc_id, cid, f"CIM attached: {doc['filename']}")
        db.commit()
        return jsonify(_get_company(cid)), 201

    @app.get("/api/companies/<int:cid>")
    def get_company(cid):
        c = _get_company(cid)
        if not c:
            abort(404, "Company not found")
        return jsonify(c)

    @app.patch("/api/companies/<int:cid>")
    def update_company(cid):
        db = get_db()
        old = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not old:
            abort(404, "Company not found")
        fields = _coerce(request.get_json(force=True) or {}, COMPANY_FIELDS)
        if "name" in fields and not fields["name"]:
            return _err("Company name is required")
        if fields.get("country") and "region" not in fields:
            fields["region"] = region_for(fields["country"]) or old["region"]
        _apply_update(db, cid, old, fields)
        db.commit()
        return jsonify(_get_company(cid))

    @app.post("/api/companies/<int:cid>/undo-stage")
    def undo_stage(cid):
        """Revert the most recent stage move, as if it never happened (backs the Undo toast)."""
        db = get_db()
        c = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not c:
            abort(404, "Company not found")
        last = row(db.execute("SELECT * FROM stage_history WHERE company_id = ? ORDER BY changed_at DESC, id DESC LIMIT 1", (cid,)))
        if not last or last["to_stage"] != c["stage"] or not last["from_stage"]:
            return _err("Nothing to undo")
        prev = row(db.execute("SELECT changed_at FROM stage_history WHERE company_id = ? AND id != ? ORDER BY changed_at DESC, id DESC LIMIT 1",
                              (cid, last["id"])))
        body = request.get_json(silent=True) or {}
        fields = {"stage": last["from_stage"], "stage_changed_at": prev["changed_at"] if prev else c["created_at"]}
        if body.get("status") in ("Active", "Passed", "On hold", "Closed"):
            fields["status"] = body["status"]
        db.execute("DELETE FROM stage_history WHERE id = ?", (last["id"],))
        db.execute("DELETE FROM activity WHERE id = (SELECT id FROM activity WHERE company_id = ? AND action = 'stage' ORDER BY id DESC LIMIT 1)", (cid,))
        db.execute(f"UPDATE companies SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", [*fields.values(), cid])
        db.commit()
        return jsonify(_get_company(cid))

    @app.delete("/api/companies/<int:cid>")
    def delete_company(cid):
        db = get_db()
        c = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not c:
            abort(404, "Company not found")
        for d in rows(db.execute("SELECT stored_name FROM documents WHERE company_id = ?", (cid,))):
            _remove_file("docs", d["stored_name"])
        if c["logo_path"]:
            _remove_file("logos", c["logo_path"])
        db.execute("DELETE FROM companies WHERE id = ?", (cid,))
        log_activity(db, "deleted", "company", cid, None, f"Removed {c['name']}")
        db.commit()
        return jsonify({"ok": True})

    @app.post("/api/companies/<int:cid>/logo")
    def upload_logo(cid):
        db = get_db()
        c = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not c:
            abort(404, "Company not found")
        f = request.files.get("file")
        if not f or not f.filename:
            return _err("No file uploaded")
        ext = os.path.splitext(f.filename.lower())[1]
        if ext not in LOGO_EXT:
            return _err("Logo must be PNG, JPG, GIF, SVG or WEBP")
        name = f"{uuid.uuid4().hex}{ext}"
        f.save(os.path.join(dbm.upload_dir("logos"), name))
        if c["logo_path"]:
            _remove_file("logos", c["logo_path"])
        db.execute("UPDATE companies SET logo_path = ?, updated_at = ? WHERE id = ?", (name, now_iso(), cid))
        log_activity(db, "updated", "company", cid, cid, "Logo updated")
        db.commit()
        return jsonify(_get_company(cid))

    @app.delete("/api/companies/<int:cid>/logo")
    def delete_logo(cid):
        db = get_db()
        c = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not c:
            abort(404, "Company not found")
        if c["logo_path"]:
            _remove_file("logos", c["logo_path"])
        db.execute("UPDATE companies SET logo_path = NULL, updated_at = ? WHERE id = ?", (now_iso(), cid))
        db.commit()
        return jsonify(_get_company(cid))

    @app.post("/api/companies/<int:cid>/apply-facts")
    def apply_facts(cid):
        db = get_db()
        old = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
        if not old:
            abort(404, "Company not found")
        data = request.get_json(force=True) or {}
        facts = data.get("facts") or []
        doc_id = data.get("document_id")
        analysis = {}
        if doc_id:
            d = row(db.execute("SELECT analysis FROM documents WHERE id = ?", (doc_id,)))
            analysis = json.loads(d["analysis"] or "{}") if d else {}
        updates = _coerce(fact_updates(facts), COMPANY_FIELDS)
        if data.get("only_empty"):
            updates = {k: v for k, v in updates.items() if old.get(k) in (None, "")}
        _apply_update(db, cid, old, updates, summary="Applied CIM facts")
        _store_key_facts(db, cid, facts, analysis, doc_id)
        db.commit()
        return jsonify(_get_company(cid))

    # --------------------------------------------------------------- documents
    @app.post("/api/companies/<int:cid>/documents")
    def upload_document(cid):
        db = get_db()
        if not row(db.execute("SELECT id FROM companies WHERE id = ?", (cid,))):
            abort(404, "Company not found")
        doc = _save_document(db, cid, request.form.get("kind", "other"), request.form.get("label"))
        db.commit()
        return jsonify(doc), 201

    @app.post("/api/cim/analyze")
    def analyze_cim():
        db = get_db()
        doc = _save_document(db, None, "cim", None)
        db.commit()
        return jsonify(doc), 201

    @app.get("/api/documents/<int:did>")
    def get_document(did):
        d = _get_document(did)
        if not d:
            abort(404, "Document not found")
        return jsonify(d)

    @app.get("/api/documents/<int:did>/download")
    def download_document(did):
        d = row(get_db().execute("SELECT * FROM documents WHERE id = ?", (did,)))
        if not d:
            abort(404, "Document not found")
        path = os.path.join(dbm.upload_dir("docs"), d["stored_name"])
        if not os.path.exists(path):
            abort(404, "File missing on disk")
        inline = request.args.get("inline") == "1" and d["filename"].lower().endswith(".pdf")
        return send_file(path, as_attachment=not inline, download_name=d["filename"])

    @app.post("/api/documents/<int:did>/reanalyze")
    def reanalyze_document(did):
        db = get_db()
        d = row(db.execute("SELECT * FROM documents WHERE id = ?", (did,)))
        if not d:
            abort(404, "Document not found")
        path = os.path.join(dbm.upload_dir("docs"), d["stored_name"])
        analysis = json.loads(d["analysis"] or "{}")
        use_ai = request.args.get("engine") == "claude"
        if use_ai:
            from .ai import analyze_with_claude, api_key_from

            s = dbm.get_settings(db)
            key = api_key_from(s)
            if not key:
                return _err("Add an Anthropic API key in Settings (or set ANTHROPIC_API_KEY) to use Claude.")
            pages = extract_pages(path, d["filename"])
            try:
                analysis["ai"] = analyze_with_claude(path, d["filename"], pages, key, s["sectors"])
            except Exception as exc:  # surface API errors to the UI
                return _err(f"Claude analysis failed: {exc}", 502)
            analysis["ai"]["analyzed_at"] = now_iso()
        else:
            pages = extract_pages(path, d["filename"])
            ai = analysis.get("ai")
            analysis = analyze_pages(pages, d["filename"], dbm.get_settings(db)["sectors"])
            if ai:
                analysis["ai"] = ai
        db.execute("UPDATE documents SET analysis = ? WHERE id = ?", (json.dumps(analysis), did))
        db.commit()
        return jsonify(_get_document(did))

    @app.patch("/api/documents/<int:did>")
    def update_document(did):
        db = get_db()
        data = request.get_json(force=True) or {}
        d = row(db.execute("SELECT * FROM documents WHERE id = ?", (did,)))
        if not d:
            abort(404, "Document not found")
        label = data.get("label", d["label"])
        kind = data.get("kind", d["kind"])
        if kind not in DOC_KINDS:
            return _err("Unknown document type")
        db.execute("UPDATE documents SET label = ?, kind = ? WHERE id = ?", (label, kind, did))
        db.commit()
        return jsonify(_get_document(did))

    @app.delete("/api/documents/<int:did>")
    def delete_document(did):
        db = get_db()
        d = row(db.execute("SELECT * FROM documents WHERE id = ?", (did,)))
        if not d:
            abort(404, "Document not found")
        _remove_file("docs", d["stored_name"])
        db.execute("DELETE FROM documents WHERE id = ?", (did,))
        log_activity(db, "deleted", "document", did, d["company_id"], f"Deleted {d['filename']}")
        db.commit()
        return jsonify({"ok": True})

    # ---------------------------------------------------------------- contacts
    @app.get("/api/contacts")
    def list_contacts():
        db = get_db()
        q = request.args.get("q", "").strip()
        sql = ("SELECT ct.*, c.name AS company_name, c.color AS company_color, "
               "(SELECT COUNT(*) FROM meeting_attendees ma WHERE ma.contact_id = ct.id) AS meeting_count, "
               "(SELECT MAX(m.starts_at) FROM meetings m JOIN meeting_attendees ma ON ma.meeting_id = m.id "
               " WHERE ma.contact_id = ct.id AND m.starts_at <= ?) AS last_met "
               "FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id WHERE 1=1")
        args = [now_iso()]
        if q:
            sql += " AND (ct.name LIKE ? OR ct.organization LIKE ? OR ct.title LIKE ? OR ct.email LIKE ? OR c.name LIKE ?)"
            args += [f"%{q}%"] * 5
        if request.args.get("type"):
            sql += " AND ct.contact_type = ?"
            args.append(request.args["type"])
        if request.args.get("company_id"):
            sql += (" AND (ct.company_id = ? OR ct.id IN "
                    "(SELECT contact_id FROM company_contacts WHERE company_id = ?))")
            args += [request.args["company_id"]] * 2
        sql += " ORDER BY ct.name COLLATE NOCASE"
        return jsonify(rows(db.execute(sql, args)))

    @app.post("/api/contacts")
    def create_contact():
        data = request.get_json(force=True) or {}
        fields = _coerce(data, CONTACT_FIELDS)
        if not fields.get("name"):
            return _err("Contact name is required")
        db = get_db()
        ts = now_iso()
        fields.update(created_at=ts, updated_at=ts)
        cur = db.execute(f"INSERT INTO contacts ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                         list(fields.values()))
        ctid = cur.lastrowid
        if data.get("link_company_id"):
            db.execute("INSERT OR IGNORE INTO company_contacts (company_id, contact_id, role, created_at) VALUES (?,?,?,?)",
                       (data["link_company_id"], ctid, data.get("role"), ts))
        log_activity(db, "created", "contact", ctid, fields.get("company_id") or data.get("link_company_id"),
                     f"New contact {fields['name']}" + (f" ({fields['organization']})" if fields.get("organization") else ""))
        db.commit()
        return jsonify(_get_contact(ctid)), 201

    @app.get("/api/contacts/<int:ctid>")
    def get_contact(ctid):
        c = _get_contact(ctid)
        if not c:
            abort(404, "Contact not found")
        return jsonify(c)

    @app.patch("/api/contacts/<int:ctid>")
    def update_contact(ctid):
        db = get_db()
        if not row(db.execute("SELECT id FROM contacts WHERE id = ?", (ctid,))):
            abort(404, "Contact not found")
        fields = _coerce(request.get_json(force=True) or {}, CONTACT_FIELDS)
        if "name" in fields and not fields["name"]:
            return _err("Contact name is required")
        if fields:
            fields["updated_at"] = now_iso()
            db.execute(f"UPDATE contacts SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                       [*fields.values(), ctid])
            db.commit()
        return jsonify(_get_contact(ctid))

    @app.delete("/api/contacts/<int:ctid>")
    def delete_contact(ctid):
        db = get_db()
        db.execute("DELETE FROM contacts WHERE id = ?", (ctid,))
        db.commit()
        return jsonify({"ok": True})

    @app.post("/api/contacts/<int:ctid>/links")
    def add_link(ctid):
        data = request.get_json(force=True) or {}
        other = data.get("to_contact_id")
        if not other or int(other) == ctid:
            return _err("Pick another contact")
        db = get_db()
        db.execute("INSERT INTO contact_links (from_contact_id, to_contact_id, relation, created_at) VALUES (?,?,?,?)",
                   (ctid, int(other), data.get("relation") or "Knows", now_iso()))
        db.commit()
        return jsonify(_get_contact(ctid)), 201

    @app.delete("/api/links/<int:lid>")
    def delete_link(lid):
        db = get_db()
        db.execute("DELETE FROM contact_links WHERE id = ?", (lid,))
        db.commit()
        return jsonify({"ok": True})

    @app.post("/api/companies/<int:cid>/contacts")
    def link_company_contact(cid):
        data = request.get_json(force=True) or {}
        db = get_db()
        ctid = data.get("contact_id")
        if not ctid:
            return _err("contact_id is required")
        db.execute("INSERT INTO company_contacts (company_id, contact_id, role, created_at) VALUES (?,?,?,?) "
                   "ON CONFLICT(company_id, contact_id) DO UPDATE SET role = excluded.role",
                   (cid, ctid, data.get("role"), now_iso()))
        db.commit()
        return jsonify(_get_company(cid)), 201

    @app.delete("/api/companies/<int:cid>/contacts/<int:ctid>")
    def unlink_company_contact(cid, ctid):
        db = get_db()
        db.execute("DELETE FROM company_contacts WHERE company_id = ? AND contact_id = ?", (cid, ctid))
        db.execute("UPDATE contacts SET company_id = NULL WHERE id = ? AND company_id = ?", (ctid, cid))
        db.commit()
        return jsonify(_get_company(cid))

    # ---------------------------------------------------------------- meetings
    @app.get("/api/meetings")
    def list_meetings():
        db = get_db()
        sql = ("SELECT m.*, c.name AS company_name, c.color AS company_color, c.logo_path AS company_logo "
               "FROM meetings m LEFT JOIN companies c ON c.id = m.company_id WHERE 1=1")
        args = []
        q = request.args.get("q", "").strip()
        if q:
            sql += " AND (m.title LIKE ? OR m.notes LIKE ? OR m.takeaways LIKE ? OR m.tags LIKE ? OR c.name LIKE ?)"
            args += [f"%{q}%"] * 5
        for f, col in (("company_id", "m.company_id"), ("type", "m.meeting_type")):
            if request.args.get(f):
                sql += f" AND {col} = ?"
                args.append(request.args[f])
        if request.args.get("contact_id"):
            sql += " AND m.id IN (SELECT meeting_id FROM meeting_attendees WHERE contact_id = ?)"
            args.append(request.args["contact_id"])
        sql += " ORDER BY m.starts_at DESC"
        ms = rows(db.execute(sql, args))
        att = {}
        for r in db.execute("SELECT ma.meeting_id, ct.id, ct.name, ct.organization FROM meeting_attendees ma "
                            "JOIN contacts ct ON ct.id = ma.contact_id"):
            att.setdefault(r[0], []).append({"id": r[1], "name": r[2], "organization": r[3]})
        for m in ms:
            m["company_logo_url"] = _logo_url(m.pop("company_logo"))
            m["attendees"] = att.get(m["id"], [])
        return jsonify(ms)

    @app.post("/api/meetings")
    def create_meeting():
        data = request.get_json(force=True) or {}
        fields = _coerce(data, MEETING_FIELDS)
        if not fields.get("title"):
            return _err("Meeting title is required")
        if not fields.get("starts_at"):
            return _err("Meeting date is required")
        fields["starts_at"] = _utc(fields["starts_at"])
        db = get_db()
        ts = now_iso()
        fields.update(created_at=ts, updated_at=ts)
        cur = db.execute(f"INSERT INTO meetings ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                         list(fields.values()))
        mid = cur.lastrowid
        _set_attendees(db, mid, data.get("attendee_ids"))
        log_activity(db, "created", "meeting", mid, fields.get("company_id"),
                     f"{fields.get('meeting_type') or 'Meeting'}: {fields['title']}")
        db.commit()
        return jsonify(_get_meeting(mid)), 201

    @app.get("/api/meetings/<int:mid>")
    def get_meeting(mid):
        m = _get_meeting(mid)
        if not m:
            abort(404, "Meeting not found")
        return jsonify(m)

    @app.patch("/api/meetings/<int:mid>")
    def update_meeting(mid):
        db = get_db()
        old = row(db.execute("SELECT * FROM meetings WHERE id = ?", (mid,)))
        if not old:
            abort(404, "Meeting not found")
        data = request.get_json(force=True) or {}
        fields = _coerce(data, MEETING_FIELDS)
        if "starts_at" in fields:
            if not fields["starts_at"]:
                return _err("Meeting date is required")
            fields["starts_at"] = _utc(fields["starts_at"])
        if fields:
            fields["updated_at"] = now_iso()
            db.execute(f"UPDATE meetings SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                       [*fields.values(), mid])
        _set_attendees(db, mid, data.get("attendee_ids"))
        log_activity(db, "updated", "meeting", mid, fields.get("company_id", old["company_id"]),
                     f"Updated notes: {fields.get('title', old['title'])}")
        db.commit()
        return jsonify(_get_meeting(mid))

    @app.delete("/api/meetings/<int:mid>")
    def delete_meeting(mid):
        db = get_db()
        db.execute("DELETE FROM meetings WHERE id = ?", (mid,))
        db.commit()
        return jsonify({"ok": True})

    # ------------------------------------------------------------ graph/search
    @app.get("/api/companies/similar")
    def similar():
        return jsonify(insights.similar_companies(get_db(), request.args.get("name", ""),
                                                  exclude_id=request.args.get("exclude", type=int)))

    @app.get("/api/team")
    def team():
        db = get_db()
        return jsonify(insights.team_overview(db, dbm.get_settings(db)))

    @app.get("/api/handover")
    def handover():
        member = request.args.get("member", "").strip()
        if not member:
            return _err("Choose a team member")
        return jsonify(insights.handover(get_db(), member))

    @app.post("/api/handover/reassign")
    def reassign():
        data = request.get_json(force=True) or {}
        src, dst = (data.get("from") or "").strip(), (data.get("to") or "").strip()
        if not src or not dst or src == dst:
            return _err("Choose who is handing over and who is taking over")
        db = get_db()
        moved = 0
        for c in rows(db.execute("SELECT id, name, deal_lead, deal_team FROM companies")):
            team = [t.strip() for t in (c["deal_team"] or "").split(",") if t.strip()]
            changed = False
            if (c["deal_lead"] or "") == src:
                c["deal_lead"], changed = dst, True
            if src in team:
                team = [dst if t == src else t for t in team]
                changed = True
            team = [t for t in dict.fromkeys(team) if t != c["deal_lead"]]
            if changed:
                db.execute("UPDATE companies SET deal_lead = ?, deal_team = ?, updated_at = ? WHERE id = ?",
                           (c["deal_lead"], ", ".join(team) or None, now_iso(), c["id"]))
                log_activity(db, "handover", "company", c["id"], c["id"], f"Handed over from {src} to {dst}")
                moved += 1
        contacts = db.execute("UPDATE contacts SET owner = ?, updated_at = ? WHERE owner = ?", (dst, now_iso(), src)).rowcount
        db.commit()
        return jsonify({"deals": moved, "contacts": contacts})

    @app.get("/api/graph")
    def graph():
        return jsonify(_graph(request.args.get("company_id", type=int)))

    @app.get("/api/activity")
    def activity():
        return jsonify(_activity(limit=request.args.get("limit", 50, type=int),
                                 company_id=request.args.get("company_id", type=int)))

    @app.get("/api/search")
    def search():
        q = request.args.get("q", "").strip()
        if len(q) < 2:
            return jsonify([])
        db = get_db()
        like = f"%{q}%"
        out = []
        for c in rows(db.execute("SELECT id, name, codename, sector, color, logo_path, stage FROM companies "
                                 "WHERE name LIKE ? OR codename LIKE ? OR description LIKE ? OR tags LIKE ? LIMIT 8",
                                 (like,) * 4)):
            out.append({"type": "company", "id": c["id"], "title": c["name"],
                        "subtitle": " · ".join(x for x in (c["codename"], c["sector"], c["stage"]) if x),
                        "color": c["color"], "logo_url": _logo_url(c["logo_path"])})
        for c in rows(db.execute("SELECT id, name, title, organization FROM contacts "
                                 "WHERE name LIKE ? OR organization LIKE ? OR email LIKE ? LIMIT 6", (like,) * 3)):
            out.append({"type": "contact", "id": c["id"], "title": c["name"],
                        "subtitle": " · ".join(x for x in (c["title"], c["organization"]) if x)})
        for m in rows(db.execute("SELECT id, title, starts_at, notes, takeaways FROM meetings "
                                 "WHERE title LIKE ? OR notes LIKE ? OR takeaways LIKE ? "
                                 "ORDER BY starts_at DESC LIMIT 6", (like,) * 3)):
            out.append({"type": "meeting", "id": m["id"], "title": m["title"],
                        "subtitle": (m["starts_at"] or "")[:10] + _excerpt((m["notes"] or "") + " " + (m["takeaways"] or ""), q)})
        for d in rows(db.execute("SELECT d.id, d.filename, d.company_id, d.text_content, c.name AS cname FROM documents d "
                                 "LEFT JOIN companies c ON c.id = d.company_id "
                                 "WHERE d.company_id IS NOT NULL AND (d.filename LIKE ? OR d.text_content LIKE ?) LIMIT 6",
                                 (like,) * 2)):
            out.append({"type": "document", "id": d["id"], "company_id": d["company_id"], "title": d["filename"],
                        "subtitle": (d["cname"] or "") + _excerpt(d["text_content"] or "", q)})
        return jsonify(out)

    # ------------------------------------------------------------------ export
    @app.get("/api/export/companies.csv")
    def export_csv():
        comps = [_decorate_company(c) for c in rows(get_db().execute("SELECT * FROM companies ORDER BY name"))]
        kn = insights.knowledge(get_db(), comps)
        for c in comps:
            c["knowledge"] = kn[c["id"]]["score"]
        cols = ["id", "name", "codename", "stage", "status", "priority", "sector", "subsector", "deal_type",
                "country", "region", "hq_city", "currency", "ev", "revenue", "ebitda", "ebitda_margin", "ev_ebitda",
                "employees", "founded_year", "ownership", "advisor", "source", "deal_lead", "deal_team", "website",
                "nda_signed_date", "nda_expiry_date", "pass_reason", "pass_notes", "revisit_date", "knowledge",
                "next_step", "next_step_date", "tags", "created_at", "updated_at"]
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(comps)
        return app.response_class(buf.getvalue(), mimetype="text/csv",
                                  headers={"Content-Disposition": "attachment; filename=companies.csv"})

    @app.get("/api/export/backup.json")
    def export_backup():
        db = get_db()
        out = {"exported_at": now_iso()}
        for t in ("companies", "stage_history", "contacts", "company_contacts", "contact_links",
                  "meetings", "meeting_attendees", "activity"):
            out[t] = rows(db.execute(f"SELECT * FROM {t}"))
        out["documents"] = rows(db.execute(
            "SELECT id, company_id, kind, filename, stored_name, size, version, label, analysis, uploaded_at FROM documents"))
        s = dbm.get_settings(db)
        s.pop("anthropic_api_key", None)
        out["settings"] = s
        return app.response_class(json.dumps(out, indent=1), mimetype="application/json",
                                  headers={"Content-Disposition": "attachment; filename=dealtracker-backup.json"})

    @app.post("/api/demo")
    def demo():
        from .seed import seed_demo

        db = get_db()
        if db.execute("SELECT COUNT(*) FROM companies").fetchone()[0]:
            return _err("Demo data can only be loaded into an empty workspace")
        seed_demo(db)
        db.commit()
        return jsonify({"ok": True})

    @app.delete("/api/demo")
    def clear_demo_data():
        from .seed import clear_demo

        db = get_db()
        removed = clear_demo(db)
        db.commit()
        return jsonify({"removed": removed})

    return app


# ---------------------------------------------------------------------- helpers

def _avg(xs):
    return round(sum(xs) / len(xs)) if xs else None


def _logo_url(path):
    return f"/files/logos/{path}" if path else None


def _decorate_company(c):
    c["logo_url"] = _logo_url(c.get("logo_path"))
    rev, ebitda, ev = c.get("revenue"), c.get("ebitda"), c.get("ev")
    c["ebitda_margin"] = round(ebitda / rev * 100, 1) if rev and ebitda is not None else None
    c["ev_ebitda"] = round(ev / ebitda, 1) if ev and ebitda and ebitda > 0 else None
    c["ev_revenue"] = round(ev / rev, 2) if ev and rev else None
    try:
        changed = datetime.fromisoformat(c.get("stage_changed_at") or c["created_at"])
        c["days_in_stage"] = (datetime.now(timezone.utc) - changed).days
    except (TypeError, ValueError, KeyError):
        c["days_in_stage"] = None
    try:
        c["key_facts"] = json.loads(c.get("key_facts") or "{}")
    except ValueError:
        c["key_facts"] = {}
    return c


def _apply_update(db, cid, old, fields, summary=None):
    fields = {k: v for k, v in fields.items() if old.get(k) != v}
    if not fields:
        return
    ts = now_iso()
    if "stage" in fields and fields["stage"]:
        db.execute("INSERT INTO stage_history (company_id, from_stage, to_stage, changed_at) VALUES (?,?,?,?)",
                   (cid, old["stage"], fields["stage"], ts))
        fields["stage_changed_at"] = ts
        summary_txt = f"{old['stage'] or '—'} → {fields['stage']}"
        if fields["stage"] == "Passed" and (fields.get("pass_reason") or old.get("pass_reason")):
            summary_txt += f" — {fields.get('pass_reason') or old.get('pass_reason')}"
            if fields.get("pass_notes"):
                summary_txt += f": {fields['pass_notes']}"
        log_activity(db, "stage", "company", cid, cid, summary_txt)
    fields["updated_at"] = ts
    db.execute(f"UPDATE companies SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", [*fields.values(), cid])
    changed = [k for k in fields if k not in ("updated_at", "stage_changed_at", "stage")]
    if changed:
        log_activity(db, "updated", "company", cid, cid,
                     summary or "Updated " + ", ".join(k.replace("_", " ") for k in changed[:4]) + ("…" if len(changed) > 4 else ""))


def _store_key_facts(db, cid, facts, analysis, doc_id):
    ai = analysis.get("ai") or {}
    kf = {
        "facts": facts,
        "highlights": analysis.get("highlights") or ai.get("highlights") or [],
        "risks": ai.get("risks") or analysis.get("risks") or [],
        "series": analysis.get("series") or {},
        "geographies": analysis.get("geographies") or [],
        "summary": ai.get("summary") or "",
        "currency": analysis.get("currency"),
        "source_document_id": doc_id,
        "applied_at": now_iso(),
    }
    db.execute("UPDATE companies SET key_facts = ? WHERE id = ?", (json.dumps(kf), cid))


def _get_company(cid):
    db = get_db()
    c = row(db.execute("SELECT * FROM companies WHERE id = ?", (cid,)))
    if not c:
        return None
    c = _decorate_company(c)
    c["stage_history"] = rows(db.execute(
        "SELECT from_stage, to_stage, changed_at FROM stage_history WHERE company_id = ? ORDER BY changed_at, id", (cid,)))
    c["contacts"] = rows(db.execute(
        "SELECT ct.*, cc.role AS deal_role, "
        " CASE WHEN ct.company_id = ? THEN 1 ELSE 0 END AS is_employee FROM contacts ct "
        "LEFT JOIN company_contacts cc ON cc.contact_id = ct.id AND cc.company_id = ? "
        "WHERE ct.company_id = ? OR cc.company_id = ? ORDER BY is_employee DESC, ct.name", (cid,) * 4))
    c["meetings"] = rows(db.execute(
        "SELECT * FROM meetings WHERE company_id = ? ORDER BY starts_at DESC", (cid,)))
    att = {}
    for r in db.execute("SELECT ma.meeting_id, ct.id, ct.name FROM meeting_attendees ma JOIN contacts ct "
                        "ON ct.id = ma.contact_id JOIN meetings m ON m.id = ma.meeting_id WHERE m.company_id = ?", (cid,)):
        att.setdefault(r[0], []).append({"id": r[1], "name": r[2]})
    for m in c["meetings"]:
        m["attendees"] = att.get(m["id"], [])
    c["documents"] = [_doc_out(d) for d in rows(db.execute(
        "SELECT * FROM documents WHERE company_id = ? ORDER BY uploaded_at DESC", (cid,)))]
    c["activity"] = _activity(limit=40, company_id=cid)
    c["knowledge"] = insights.knowledge(db, [c])[cid]
    c["prior_looks"] = insights.similar_companies(db, c["name"], exclude_id=cid)
    return c


def _doc_out(d, with_text=False):
    d["analysis"] = json.loads(d.get("analysis") or "null")
    if not with_text:
        d.pop("text_content", None)
    d["download_url"] = f"/api/documents/{d['id']}/download"
    return d


def _get_document(did):
    d = row(get_db().execute("SELECT * FROM documents WHERE id = ?", (did,)))
    return _doc_out(d) if d else None


def _save_document(db, cid, kind, label):
    f = request.files.get("file")
    if not f or not f.filename:
        abort(400, "No file uploaded")
    kind = kind if kind in DOC_KINDS else "other"
    filename = os.path.basename(f.filename)
    ext = os.path.splitext(filename.lower())[1]
    stored = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(dbm.upload_dir("docs"), stored)
    f.save(path)
    size = os.path.getsize(path)

    version, text, analysis = None, None, None
    s = dbm.get_settings(db)
    if kind == "model":
        version = (db.execute("SELECT MAX(version) FROM documents WHERE company_id = ? AND kind = 'model'",
                              (cid,)).fetchone()[0] or 0) + 1
        analysis = parse_model(path, filename)
    elif ext in (".pdf", ".docx", ".txt", ".md"):
        try:
            pages = extract_pages(path, filename)
        except Exception as exc:
            pages = []
            analysis = {"error": f"Could not read document: {exc}"}
        text = "\n".join(pages)
        if kind in ("cim", "teaser") and pages:
            analysis = analyze_pages(pages, filename, s["sectors"])
            if not text.strip():
                analysis["warning"] = "No text layer found (scanned PDF?). Try Claude analysis or OCR the file first."
    ts = now_iso()
    cur = db.execute(
        "INSERT INTO documents (company_id, kind, filename, stored_name, size, version, label, text_content, analysis, uploaded_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (cid, kind, filename, stored, size, version, label, text, json.dumps(analysis) if analysis else None, ts),
    )
    did = cur.lastrowid
    if cid:
        what = f"Model v{version}" if kind == "model" else kind.upper() if kind in ("cim", "nda") else kind.title()
        log_activity(db, "uploaded", "document", did, cid, f"{what} uploaded: {filename}")
    return _get_document(did)


def _set_attendees(db, mid, ids):
    if ids is not None:
        db.execute("DELETE FROM meeting_attendees WHERE meeting_id = ?", (mid,))
        for i in {int(x) for x in ids}:
            db.execute("INSERT OR IGNORE INTO meeting_attendees (meeting_id, contact_id) VALUES (?, ?)", (mid, i))
    # People met about a company become part of that deal's people list.
    db.execute(
        "INSERT OR IGNORE INTO company_contacts (company_id, contact_id, role, created_at) "
        "SELECT m.company_id, ma.contact_id, 'Meeting attendee', ? FROM meetings m "
        "JOIN meeting_attendees ma ON ma.meeting_id = m.id JOIN contacts ct ON ct.id = ma.contact_id "
        "WHERE m.id = ? AND m.company_id IS NOT NULL AND (ct.company_id IS NULL OR ct.company_id != m.company_id)",
        (now_iso(), mid),
    )


def _get_meeting(mid):
    db = get_db()
    m = row(db.execute("SELECT m.*, c.name AS company_name, c.color AS company_color FROM meetings m "
                       "LEFT JOIN companies c ON c.id = m.company_id WHERE m.id = ?", (mid,)))
    if not m:
        return None
    m["attendees"] = rows(db.execute("SELECT ct.id, ct.name, ct.title, ct.organization FROM meeting_attendees ma "
                                     "JOIN contacts ct ON ct.id = ma.contact_id WHERE ma.meeting_id = ?", (mid,)))
    return m


def _get_contact(ctid):
    db = get_db()
    c = row(db.execute("SELECT ct.*, c.name AS company_name, c.color AS company_color FROM contacts ct "
                       "LEFT JOIN companies c ON c.id = ct.company_id WHERE ct.id = ?", (ctid,)))
    if not c:
        return None
    c["deals"] = rows(db.execute("SELECT c.id, c.name, c.color, c.stage, cc.role FROM company_contacts cc "
                                 "JOIN companies c ON c.id = cc.company_id WHERE cc.contact_id = ?", (ctid,)))
    c["links"] = rows(db.execute(
        "SELECT l.id, l.relation, 'out' AS dir, ct.id AS contact_id, ct.name, ct.organization FROM contact_links l "
        "JOIN contacts ct ON ct.id = l.to_contact_id WHERE l.from_contact_id = ? "
        "UNION ALL SELECT l.id, l.relation, 'in', ct.id, ct.name, ct.organization FROM contact_links l "
        "JOIN contacts ct ON ct.id = l.from_contact_id WHERE l.to_contact_id = ?", (ctid, ctid)))
    c["meetings"] = rows(db.execute(
        "SELECT m.id, m.title, m.starts_at, m.meeting_type, c.name AS company_name FROM meetings m "
        "JOIN meeting_attendees ma ON ma.meeting_id = m.id LEFT JOIN companies c ON c.id = m.company_id "
        "WHERE ma.contact_id = ? ORDER BY m.starts_at DESC", (ctid,)))
    return c


def _graph(company_id=None):
    db = get_db()
    comps = {c["id"]: c for c in rows(db.execute("SELECT id, name, color, logo_path, stage, sector FROM companies"))}
    contacts = rows(db.execute("SELECT id, name, title, organization, company_id, contact_type, strength FROM contacts"))
    deal_links = rows(db.execute("SELECT company_id, contact_id, role FROM company_contacts"))
    links = rows(db.execute("SELECT id, from_contact_id, to_contact_id, relation FROM contact_links"))
    meet = rows(db.execute("SELECT DISTINCT m.company_id, ma.contact_id FROM meetings m "
                           "JOIN meeting_attendees ma ON ma.meeting_id = m.id WHERE m.company_id IS NOT NULL"))

    nodes, edges = {}, []
    for ct in contacts:
        nodes[f"p{ct['id']}"] = {"id": f"p{ct['id']}", "kind": "contact", "ref": ct["id"], "label": ct["name"],
                                 "sub": ct["title"] or "", "type": ct["contact_type"], "strength": ct["strength"] or 3}
        if ct["company_id"] in comps:
            edges.append({"source": f"p{ct['id']}", "target": f"c{ct['company_id']}", "kind": "employee",
                          "label": ct["title"] or "Works at"})
        elif ct["organization"]:
            oid = "o" + ct["organization"].strip().lower()
            nodes.setdefault(oid, {"id": oid, "kind": "org", "label": ct["organization"].strip()})
            edges.append({"source": f"p{ct['id']}", "target": oid, "kind": "employee", "label": ct["title"] or "Works at"})
    for cid, c in comps.items():
        nodes[f"c{cid}"] = {"id": f"c{cid}", "kind": "company", "ref": cid, "label": c["name"], "color": c["color"],
                            "logo_url": _logo_url(c["logo_path"]), "sub": c["stage"] or ""}
    seen = {(e["source"], e["target"]) for e in edges}
    for dl in deal_links:
        k = (f"p{dl['contact_id']}", f"c{dl['company_id']}")
        if k not in seen:
            edges.append({"source": k[0], "target": k[1], "kind": "deal", "label": dl["role"] or "Involved"})
            seen.add(k)
    for m in meet:
        k = (f"p{m['contact_id']}", f"c{m['company_id']}")
        if k not in seen:
            edges.append({"source": k[0], "target": k[1], "kind": "meeting", "label": "Met re: deal"})
            seen.add(k)
    for l in links:
        edges.append({"source": f"p{l['from_contact_id']}", "target": f"p{l['to_contact_id']}", "kind": "relation",
                      "label": l["relation"] or "Knows", "id": l["id"]})

    if company_id:
        # Ego network: the company, its people, and everyone one hop from them.
        keep = {f"c{company_id}"}
        for _ in range(2):
            for e in edges:
                if e["source"] in keep or e["target"] in keep:
                    keep.update((e["source"], e["target"]))
        nodes = {k: v for k, v in nodes.items() if k in keep}
    else:
        connected = {e["source"] for e in edges} | {e["target"] for e in edges}
        nodes = {k: v for k, v in nodes.items() if k in connected or v["kind"] == "contact"}
    edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]
    return {"nodes": list(nodes.values()), "edges": edges}


def _activity(limit=30, company_id=None):
    db = get_db()
    sql = ("SELECT a.*, c.name AS company_name, c.color AS company_color, c.logo_path AS company_logo FROM activity a "
           "LEFT JOIN companies c ON c.id = a.company_id")
    args = []
    if company_id:
        sql += " WHERE a.company_id = ?"
        args.append(company_id)
    sql += " ORDER BY a.created_at DESC, a.id DESC LIMIT ?"
    args.append(limit)
    out = rows(db.execute(sql, args))
    for a in out:
        a["company_logo_url"] = _logo_url(a.pop("company_logo"))
    return out


def _excerpt(text, q, width=70):
    i = text.lower().find(q.lower())
    if i < 0:
        return ""
    s = max(0, i - width // 2)
    return " · …" + " ".join(text[s: s + width].split()) + "…"


def _remove_file(sub, name):
    try:
        os.remove(os.path.join(dbm.upload_dir(sub), name))
    except OSError:
        pass


def _cleanup_orphans():
    """Delete CIMs analysed in the 'new from CIM' flow that never became a company."""
    db = dbm.connect(dbm.current_app.config["DB_PATH"])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    for d in db.execute("SELECT id, stored_name FROM documents WHERE company_id IS NULL AND uploaded_at < ?", (cutoff,)):
        try:
            os.remove(os.path.join(dbm.current_app.config["DATA_DIR"], "uploads", "docs", d["stored_name"]))
        except OSError:
            pass
        db.execute("DELETE FROM documents WHERE id = ?", (d["id"],))
    db.commit()
    db.close()
