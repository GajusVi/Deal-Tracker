"""Institutional-memory features: what needs attention, how well each deal is
documented, prior looks at the same company, and handover packs for people
who are leaving or changing seats."""
import json
import re
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher

from . import db as dbm
from .db import rows

LEGAL_SUFFIX = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|sas|bv|nv|"
    r"spa|srl|ab|as|oy|pty|group|holdings?|the)\b\.?", re.I)

KNOWLEDGE_CHECKS = [
    ("lead", "Deal lead assigned"),
    ("description", "Business description"),
    ("facts", "Key facts captured (CIM)"),
    ("model", "Model on file"),
    ("notes", "Meeting notes logged"),
    ("people", "People mapped"),
    ("decision", "Next step or pass reason"),
]
# Short names used when listing what a deal record is missing ("Missing: model, meeting notes").
CHECK_SHORT = {"lead": "deal lead", "description": "description", "facts": "CIM facts", "model": "model",
               "notes": "meeting notes", "people": "people", "decision": "next step"}


def norm_name(name):
    s = LEGAL_SUFFIX.sub(" ", (name or "").lower())
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(s.split())


def similar_companies(db, name, exclude_id=None, threshold=0.82):
    """Companies whose name or codename looks like `name` — catches re-looks and duplicates."""
    target = norm_name(name)
    if len(target) < 3:
        return []
    out = []
    for c in rows(db.execute("SELECT id, name, codename, stage, status, pass_reason, pass_notes, revisit_date, "
                             "deal_lead, color, logo_path, created_at, updated_at FROM companies")):
        if c["id"] == exclude_id:
            continue
        best = 0.0
        for cand in (c["name"], (c["codename"] or "").replace("Project ", "")):
            n = norm_name(cand)
            if not n:
                continue
            if n == target or (len(n) >= 4 and (n in target or target in n)):
                best = 1.0
                break
            best = max(best, SequenceMatcher(None, n, target).ratio())
        if best >= threshold:
            c["similarity"] = round(best, 2)
            c["logo_url"] = f"/files/logos/{c.pop('logo_path')}" if c.get("logo_path") else None
            c["last_meeting"] = db.execute("SELECT MAX(starts_at) FROM meetings WHERE company_id = ?", (c["id"],)).fetchone()[0]
            out.append(c)
    return sorted(out, key=lambda c: -c["similarity"])


def _today():
    return date.today().isoformat()


def _parse(ts):
    try:
        d = datetime.fromisoformat(ts)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def knowledge(db, companies=None):
    """Per-company documentation coverage: which of KNOWLEDGE_CHECKS are satisfied."""
    comps = companies if companies is not None else rows(db.execute("SELECT * FROM companies"))
    has_model = {r[0] for r in db.execute("SELECT DISTINCT company_id FROM documents WHERE kind = 'model'")}
    has_cim = {r[0] for r in db.execute("SELECT DISTINCT company_id FROM documents WHERE kind IN ('cim','teaser')")}
    has_notes = {r[0] for r in db.execute(
        "SELECT DISTINCT company_id FROM meetings WHERE company_id IS NOT NULL AND "
        "(COALESCE(notes,'') != '' OR COALESCE(takeaways,'') != '')")}
    people = {r[0] for r in db.execute(
        "SELECT company_id FROM company_contacts UNION SELECT company_id FROM contacts WHERE company_id IS NOT NULL")}
    out = {}
    for c in comps:
        kf = c.get("key_facts")
        if isinstance(kf, str):
            try:
                kf = json.loads(kf or "{}")
            except ValueError:
                kf = {}
        passed = c.get("stage") == "Passed" or c.get("status") == "Passed"
        checks = {
            "lead": bool(c.get("deal_lead")),
            "description": bool((c.get("description") or "").strip()),
            "facts": bool((kf or {}).get("facts")) or c["id"] in has_cim,
            "model": c["id"] in has_model,
            "notes": c["id"] in has_notes,
            "people": c["id"] in people,
            "decision": bool(c.get("pass_reason")) if passed else bool(c.get("next_step")) or c.get("stage") == "Closed",
        }
        done = sum(checks.values())
        out[c["id"]] = {
            "score": round(done / len(checks) * 100),
            "done": done,
            "total": len(checks),
            "missing": [CHECK_SHORT[k] for k, _ in KNOWLEDGE_CHECKS if not checks[k]],
            "checks": [{"key": k, "label": label, "short": CHECK_SHORT[k], "done": checks[k]} for k, label in KNOWLEDGE_CHECKS],
        }
    return out


def last_touch(db):
    """Most recent meeting or activity per company."""
    out = {}
    for cid, ts in db.execute(
            "SELECT company_id, MAX(ts) FROM ("
            " SELECT company_id, starts_at AS ts FROM meetings WHERE company_id IS NOT NULL AND starts_at <= ?"
            " UNION ALL SELECT company_id, created_at FROM activity WHERE company_id IS NOT NULL"
            ") GROUP BY company_id", (dbm.now_iso(),)):
        out[cid] = ts
    return out


def contact_last_met(db):
    return {r[0]: r[1] for r in db.execute(
        "SELECT ma.contact_id, MAX(m.starts_at) FROM meeting_attendees ma JOIN meetings m ON m.id = ma.meeting_id "
        "WHERE m.starts_at <= ? GROUP BY ma.contact_id", (dbm.now_iso(),))}


def attention(db, settings):
    """Things that slip when nobody owns them: deadlines, obligations, cold relationships."""
    today = date.today()
    soon = (today + timedelta(days=45)).isoformat()
    items = []
    comps = rows(db.execute("SELECT * FROM companies"))
    touch = last_touch(db)
    for c in comps:
        live = c["stage"] not in dbm.TERMINAL_STAGES and c["status"] != "Passed"
        base = {"company_id": c["id"], "company_name": c["name"], "color": c["color"],
                "logo_url": f"/files/logos/{c['logo_path']}" if c.get("logo_path") else None}
        if live and c["next_step"] and c["next_step_date"] and c["next_step_date"] < _today():
            items.append({**base, "kind": "overdue", "severity": 3, "date": c["next_step_date"],
                          "title": f"Overdue: {c['next_step']}", "detail": f"Due {c['next_step_date']} · lead {c['deal_lead'] or 'unassigned'}"})
        if c["nda_expiry_date"] and c["nda_expiry_date"] <= soon:
            expired = c["nda_expiry_date"] < _today()
            items.append({**base, "kind": "nda", "severity": 3 if expired else 2, "date": c["nda_expiry_date"],
                          "title": "NDA expired — confirm return / destruction of materials" if expired else "NDA expiring",
                          "detail": f"{'Expired' if expired else 'Expires'} {c['nda_expiry_date']}"})
        if c["revisit_date"] and c["revisit_date"] <= (today + timedelta(days=14)).isoformat():
            items.append({**base, "kind": "revisit", "severity": 2, "date": c["revisit_date"],
                          "title": "Time to revisit a passed deal",
                          "detail": f"Passed: {c['pass_reason'] or 'no reason logged'} · revisit {c['revisit_date']}"})
        if live:
            t = _parse(touch.get(c["id"]) or c["updated_at"])
            if t and (datetime.now(timezone.utc) - t).days >= 21:
                items.append({**base, "kind": "stale", "severity": 1, "date": t.date().isoformat(),
                              "title": "No activity for {} days".format((datetime.now(timezone.utc) - t).days),
                              "detail": f"{c['stage']} · lead {c['deal_lead'] or 'unassigned'}"})
            if not c["deal_lead"]:
                items.append({**base, "kind": "owner", "severity": 2, "date": None,
                              "title": "Live deal has no lead", "detail": "Knowledge on this deal has no owner"})

    cold_days = int(settings.get("cold_days") or 60)
    met = contact_last_met(db)
    for ct in rows(db.execute("SELECT id, name, organization, owner, strength, created_at FROM contacts WHERE strength >= 4")):
        last = _parse(met.get(ct["id"]) or ct["created_at"])
        if last and (datetime.now(timezone.utc) - last).days >= cold_days:
            items.append({"kind": "cold", "severity": 1, "contact_id": ct["id"], "date": last.date().isoformat(),
                          "title": f"Relationship going cold: {ct['name']}",
                          "detail": f"{ct['organization'] or ''} · last met {last.date().isoformat()} · owner {ct['owner'] or 'none'}"})
    return sorted(items, key=lambda i: (-i["severity"], i["date"] or "9999"))


def intermediaries(db, stages):
    """Which advisors bring deals, and how far those deals get."""
    rank = {s: i for i, s in enumerate(stages)}
    out = {}
    for c in rows(db.execute("SELECT name, advisor, stage, ev FROM companies WHERE COALESCE(advisor,'') != ''")):
        o = out.setdefault(c["advisor"], {"name": c["advisor"], "deals": 0, "ev": 0, "best_stage": None, "progressed": 0})
        o["deals"] += 1
        o["ev"] += c["ev"] or 0
        if c["stage"] != "Passed" and (o["best_stage"] is None or rank.get(c["stage"], -1) > rank.get(o["best_stage"], -1)):
            o["best_stage"] = c["stage"]
        if rank.get(c["stage"], 0) >= rank.get("Management Meeting", 4) and c["stage"] != "Passed":
            o["progressed"] += 1
    return sorted(out.values(), key=lambda o: (-o["deals"], -o["ev"]))


def team_overview(db, settings):
    members = list(dict.fromkeys((settings.get("team_members") or [])))
    for r in db.execute("SELECT DISTINCT deal_lead FROM companies WHERE COALESCE(deal_lead,'') != '' "
                        "UNION SELECT DISTINCT owner FROM contacts WHERE COALESCE(owner,'') != ''"):
        if r[0] not in members:
            members.append(r[0])
    comps = rows(db.execute("SELECT * FROM companies"))
    kn = knowledge(db, comps)
    out = []
    for m in members:
        mine = [c for c in comps if _on_team(c, m)]
        live = [c for c in mine if c["stage"] not in dbm.TERMINAL_STAGES and c["status"] != "Passed"]
        contacts = db.execute("SELECT COUNT(*) FROM contacts WHERE owner = ?", (m,)).fetchone()[0]
        score = round(sum(kn[c["id"]]["score"] for c in live) / len(live)) if live else None
        out.append({"name": m, "deals": len(mine), "live": len(live), "contacts": contacts,
                    "ev": sum(c["ev"] or 0 for c in live), "knowledge": score,
                    "complete": sum(1 for c in live if not kn[c["id"]]["missing"]),
                    "gaps": sum(len(kn[c["id"]]["missing"]) for c in live)})
    return out


def _on_team(c, member):
    team = [t.strip().lower() for t in (c.get("deal_team") or "").split(",") if t.strip()]
    return (c.get("deal_lead") or "").lower() == member.lower() or member.lower() in team


def handover(db, member):
    comps = [c for c in rows(db.execute("SELECT * FROM companies ORDER BY updated_at DESC")) if _on_team(c, member)]
    kn = knowledge(db, comps)
    touch = last_touch(db)
    deals = []
    for c in comps:
        meetings = rows(db.execute(
            "SELECT id, title, starts_at, meeting_type, takeaways, next_steps, notes FROM meetings "
            "WHERE company_id = ? ORDER BY starts_at DESC LIMIT 3", (c["id"],)))
        people = rows(db.execute(
            "SELECT ct.id, ct.name, ct.title, ct.organization, ct.strength, ct.owner, cc.role FROM contacts ct "
            "LEFT JOIN company_contacts cc ON cc.contact_id = ct.id AND cc.company_id = ? "
            "WHERE ct.company_id = ? OR cc.company_id = ? ORDER BY ct.strength DESC", (c["id"],) * 3))
        try:
            kf = json.loads(c.get("key_facts") or "{}")
        except ValueError:
            kf = {}
        deals.append({
            "id": c["id"], "name": c["name"], "codename": c["codename"], "color": c["color"],
            "logo_url": f"/files/logos/{c['logo_path']}" if c.get("logo_path") else None,
            "stage": c["stage"], "status": c["status"], "role": "Lead" if (c["deal_lead"] or "").lower() == member.lower() else "Team",
            "deal_team": c["deal_team"], "advisor": c["advisor"], "ev": c["ev"], "currency": c["currency"],
            "next_step": c["next_step"], "next_step_date": c["next_step_date"],
            "pass_reason": c["pass_reason"], "pass_notes": c["pass_notes"], "revisit_date": c["revisit_date"],
            "nda_expiry_date": c["nda_expiry_date"], "last_touch": touch.get(c["id"]),
            "description": c["description"], "highlights": (kf.get("highlights") or [])[:3], "risks": (kf.get("risks") or [])[:3],
            "knowledge": kn[c["id"]], "meetings": meetings, "people": people,
        })
    met = contact_last_met(db)
    contacts = rows(db.execute(
        "SELECT ct.id, ct.name, ct.title, ct.organization, ct.contact_type, ct.strength, ct.email, ct.phone, ct.notes, "
        "c.name AS company_name FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id "
        "WHERE ct.owner = ? ORDER BY ct.strength DESC, ct.name", (member,)))
    for ct in contacts:
        ct["last_met"] = met.get(ct["id"])
        ct["deals"] = [r[0] for r in db.execute(
            "SELECT c.name FROM company_contacts cc JOIN companies c ON c.id = cc.company_id WHERE cc.contact_id = ?", (ct["id"],))]
    live = [d for d in deals if d["stage"] not in dbm.TERMINAL_STAGES and d["status"] != "Passed"]
    gaps = sorted(({"deal": d["name"], "id": d["id"], "missing": [x["label"] for x in d["knowledge"]["checks"] if not x["done"]]}
                   for d in live), key=lambda g: -len(g["missing"]))
    return {
        "member": member,
        "generated_at": dbm.now_iso(),
        "deals": deals,
        "contacts": contacts,
        "gaps": [g for g in gaps if g["missing"]],
        "summary": {
            "deals": len(deals), "live": len(live), "contacts": len(contacts),
            "strong_relationships": sum(1 for c in contacts if (c["strength"] or 0) >= 4),
            "knowledge": round(sum(d["knowledge"]["score"] for d in live) / len(live)) if live else None,
            "complete": sum(1 for d in live if not d["knowledge"]["missing"]),
            "gaps": sum(len(d["knowledge"]["missing"]) for d in live),
            "open_next_steps": sum(1 for d in live if d["next_step"]),
        },
    }


def coverage(db, live):
    """Firm-wide view of deal records: for each item, which live deals have it and which don't."""
    kn = knowledge(db, live)
    rows_ = []
    for key, label in KNOWLEDGE_CHECKS:
        missing = [{"id": c["id"], "name": c["name"]} for c in live
                   if not next(x for x in kn[c["id"]]["checks"] if x["key"] == key)["done"]]
        rows_.append({"key": key, "label": label, "have": len(live) - len(missing), "missing": missing})
    return {
        "live": len(live),
        "complete": sum(1 for c in live if not kn[c["id"]]["missing"]),
        "gaps": sum(len(kn[c["id"]]["missing"]) for c in live),
        "items": rows_,
    }
