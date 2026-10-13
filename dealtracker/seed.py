"""Demo workspace so the app has something to show on first launch."""
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from . import db as dbm
from .geo import region_for

COMPANIES = [
    # name, codename, color, sector, country, city, stage, priority, deal_type, ev, rev, ebitda, emp, founded, advisor, desc, shape
    ("Northwind Analytics", "Project Atlas", "#2563eb", "Software & Tech", "United States", "Austin, TX",
     "Management Meeting", "High", "Buyout", 380, 62.4, 17.8, 340, 2009, "Harbor Lane Partners",
     "Cloud-based supply chain planning software for mid-market manufacturers and distributors.", "hex"),
    ("Helix Dental Group", "Project Smile", "#0d9488", "Healthcare", "United Kingdom", "Manchester",
     "IOI Submitted", "Medium", "Buyout", 210, 95.0, 19.5, 820, 2004, "Rothwell & Co",
     "Dental service organisation with 64 practices across the North of England.", "circle"),
    ("Kestrel Precision", "Project Falcon", "#ea580c", "Industrials", "Germany", "Stuttgart",
     "CIM Review", "Medium", "Carve-out", 145, 120.0, 16.2, 610, 1987, "Baird Mueller",
     "Precision-machined components for aerospace and medical device OEMs.", "diamond"),
    ("Brightpath Learning", "Project Compass", "#7c3aed", "Education", "Canada", "Toronto",
     "NDA Signed", "Low", "Growth Equity", 90, 28.0, 4.1, 150, 2015, "",
     "K-12 tutoring platform combining live instruction with adaptive software.", "circle"),
    ("Solace Energy Services", "Project Ember", "#ca8a04", "Energy & Infrastructure", "United States", "Denver, CO",
     "Due Diligence", "High", "Buyout", 520, 180.0, 41.0, 1100, 1998, "Evercore",
     "Commercial solar O&M and battery storage maintenance provider.", "hex"),
    ("Mercato Foods", "Project Olive", "#16a34a", "Food & Agriculture", "Italy", "Bologna",
     "Sourcing", "Medium", "Add-on", 60, 48.0, 6.9, 230, 1972, "",
     "Premium private-label pasta and sauces supplier to European grocers.", "diamond"),
    ("Arclight Payments", "Project Volt", "#db2777", "Financial Services", "Netherlands", "Amsterdam",
     "LOI", "High", "Minority", 260, 41.0, 12.3, 190, 2013, "Lazard",
     "Embedded payments infrastructure for vertical SaaS platforms.", "hex"),
    ("Tidewater Logistics", "Project Harbor", "#0891b2", "Transportation & Logistics", "Singapore", "Singapore",
     "Passed", "Low", "Buyout", 175, 210.0, 14.0, 900, 2001, "Jefferies",
     "Asset-light freight forwarding and customs brokerage across ASEAN.", "circle"),
    ("Cobalt Facility Partners", "Project Steel", "#475569", "Business Services", "United States", "Chicago, IL",
     "Closed", "Medium", "Buyout", 310, 140.0, 28.0, 2400, 1995, "William Blair",
     "Integrated facility services for healthcare and education campuses.", "diamond"),
]

CONTACTS = [
    # name, title, org, company_idx (employee) or None, type, email, city, strength
    ("Jane Whitfield", "Founder & CEO", None, 0, "Management", "jane@northwind-analytics.com", "Austin", 4),
    ("Marcus Lee", "CFO", None, 0, "Management", "marcus@northwind-analytics.com", "Austin", 3),
    ("Priya Raman", "Managing Director", "Harbor Lane Partners", None, "Banker / Advisor", "priya@harborlane.com", "New York", 5),
    ("Tom Ellison", "Vice President", "Harbor Lane Partners", None, "Banker / Advisor", "tom@harborlane.com", "New York", 3),
    ("Dr. Sarah Okafor", "CEO", None, 1, "Management", "s.okafor@helixdental.co.uk", "Manchester", 3),
    ("James Rothwell", "Partner", "Rothwell & Co", None, "Banker / Advisor", "james@rothwell.co.uk", "London", 4),
    ("Klaus Becker", "Managing Director", None, 2, "Management", "k.becker@kestrel-precision.de", "Stuttgart", 2),
    ("Anna Vogel", "Director", "Baird Mueller", None, "Banker / Advisor", "anna.vogel@bairdmueller.de", "Frankfurt", 3),
    ("Rachel Kim", "Former COO, Oracle SCM", "Independent", None, "Industry Expert", "rachel.kim@gmail.com", "San Francisco", 4),
    ("David Chen", "Partner", "Granite Peak Capital", None, "Co-investor", "dchen@granitepeak.com", "Boston", 5),
    ("Lucia Ferraro", "Head of Leveraged Finance", "Banca Meridiana", None, "Lender", "l.ferraro@meridiana.it", "Milan", 3),
    ("Owen Brooks", "Operating Partner", "My Fund", None, "Operating Partner", "owen@myfund.com", "New York", 5),
    ("Elena Moretti", "CEO", None, 5, "Management", "elena@mercatofoods.it", "Bologna", 2),
    ("Sanne de Vries", "Co-founder & CEO", None, 6, "Management", "sanne@arclight.nl", "Amsterdam", 4),
    ("Mike Patel", "Managing Director", "Evercore", None, "Banker / Advisor", "mpatel@evercore.com", "Houston", 3),
    ("Laura Hughes", "CEO", None, 4, "Management", "laura.hughes@solace.energy", "Denver", 4),
]

DEAL_LINKS = [  # contact_idx, company_idx, role
    (2, 0, "Sell-side lead banker"), (3, 0, "Sell-side banker"), (8, 0, "Expert — supply chain software"),
    (9, 0, "Potential co-investor"), (11, 0, "Value creation lead"), (5, 1, "Sell-side advisor"),
    (7, 2, "Sell-side advisor"), (10, 5, "Financing"), (14, 4, "Sell-side advisor"), (9, 4, "Co-investor"),
    (11, 4, "Ops diligence"), (8, 6, "Expert — payments"),
]

LINKS = [  # from, to, relation
    (2, 3, "Manages"), (2, 9, "Former colleague"), (0, 8, "Former colleague"), (0, 1, "Reports to"),
    (11, 8, "Introduced"), (5, 4, "Long-time advisor"), (9, 11, "Co-invested before"), (14, 15, "Advisor to"),
]

MEETINGS = [
    # title, type, company_idx, days_offset, duration, location, notes, takeaways, next_steps, sentiment, attendees
    ("Northwind management presentation", "Management Presentation", 0, -6, 180, "Austin HQ",
     "Jane walked through product roadmap and the AI demand-sensing module.\n- 2025 bookings +31%\n- Pipeline heavily weighted to food & bev\n- Pricing uplift program planned for 2027",
     "Strong founder, clear roadmap. Gross retention 94% looks durable. Need to diligence services margin.",
     "Request cohort data; schedule customer calls", "Positive", [0, 1, 2, 3, 11]),
    ("Supply chain software expert call", "Expert Call", 0, -12, 60, "Zoom",
     "Rachel sees Northwind as best-in-class for mid-market. Competitive threat from Kinaxis moving downmarket.",
     "Mid-market moat is integrations + implementation speed.", "Second call on pricing", "Positive", [8]),
    ("Harbor Lane process update", "Banker / Advisor Call", 0, -2, 30, "Phone",
     "Seven parties through to round 2. Valuation guidance mid-20s EBITDA multiple.", "Competitive; need conviction on growth.",
     "Submit data requests by Friday", "Neutral", [2]),
    ("Helix site visit — Leeds practice", "Site Visit", 1, -20, 240, "Leeds",
     "Toured two flagship practices. Strong clinician tenure. Practice management system dated.",
     "Associate dentist recruitment is the key risk.", "Model dentist churn scenarios", "Neutral", [4, 5]),
    ("UK dental market roundtable", "Industry / Market Meeting", None, -35, 90, "London",
     "NHS contract reform discussion. Private mix shifting to 60%+ for consolidators. Labour constraints industry-wide.",
     "Favour platforms with >50% private revenue.", "", "Neutral", [5]),
    ("Kestrel carve-out kickoff", "Banker / Advisor Call", 2, -9, 60, "Teams",
     "Parent wants clean exit by Q2. TSAs expected for IT and procurement (12 months).", "Standalone cost build is critical.",
     "Engage carve-out advisor", "Neutral", [7, 6]),
    ("Solace confirmatory diligence", "Management Presentation", 4, -4, 120, "Denver",
     "Reviewed QoE adjustments and battery storage backlog ($140m).", "Backlog conversion supports base case.",
     "Finalize ops diligence with Owen", "Positive", [15, 14, 11, 9]),
    ("Arclight LOI negotiation", "Management Presentation", 6, -1, 90, "Amsterdam",
     "Agreed minority governance package; founder wants board seat for second sponsor.", "Close on board composition.",
     "Revert on governance markup", "Positive", [13]),
    ("European food & ag market lunch", "Industry / Market Meeting", None, -15, 90, "Milan",
     "Private label share gains continuing in Italy and Spain. Lenders cautious on input-cost volatility.",
     "Look for add-ons with pass-through pricing.", "Intro to Mercato via Lucia", "Positive", [10]),
    ("IC — Northwind first look", "Investment Committee", 0, 3, 60, "Office",
     "", "", "", None, [11, 9]),
    ("Northwind customer reference calls", "Expert Call", 0, 6, 120, "Zoom", "", "", "", None, [1]),
    ("Mercato intro meeting", "Management Presentation", 5, 10, 60, "Bologna", "", "", "", None, [12, 10]),
]

SHAPES = {
    "hex": '<polygon points="32,6 54,19 54,45 32,58 10,45 10,19" fill="{c}"/>',
    "circle": '<circle cx="32" cy="32" r="26" fill="{c}"/>',
    "diamond": '<rect x="13" y="13" width="38" height="38" rx="8" transform="rotate(45 32 32)" fill="{c}"/>',
}


def _logo_svg(name, color, shape):
    initials = "".join(w[0] for w in name.split()[:2]).upper()
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        + SHAPES[shape].format(c=color)
        + f'<text x="32" y="38" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" '
        f'font-size="17" font-weight="700" fill="#fff">{initials}</text></svg>'
    )


def seed_demo(db):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    stages = dbm.get_settings(db)["stages"]
    logo_dir = os.path.join(dbm.data_dir(), "uploads", "logos")
    os.makedirs(logo_dir, exist_ok=True)

    company_ids = []
    for i, (name, code, color, sector, country, city, stage, prio, dtype, ev, rev, ebitda, emp, founded, adv, desc, shape) in enumerate(COMPANIES):
        created = now - timedelta(days=120 - i * 11)
        logo = f"{uuid.uuid4().hex}.svg"
        with open(os.path.join(logo_dir, logo), "w") as fh:
            fh.write(_logo_svg(name, color, shape))
        stage_idx = stages.index(stage) if stage in stages else 0
        changed = min(created + timedelta(days=stage_idx * 9), now - timedelta(days=2 + i))
        step = (changed - created) / max(stage_idx, 1)
        next_step = {0: ("Customer reference calls", 6), 1: ("Round 2 bid", 18), 2: ("Submit IOI", 12),
                     4: ("SPA signing", 9), 5: ("Intro meeting", 10), 6: ("Revert on LOI markup", -1)}.get(i)
        cur = db.execute(
            "INSERT INTO companies (name, codename, logo_path, color, sector, website, description, hq_city, country, region, "
            "stage, status, priority, deal_type, source, advisor, deal_lead, currency, ev, revenue, ebitda, employees, "
            "founded_year, ownership, next_step, next_step_date, tags, stage_changed_at, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, code, logo, color, sector, f"www.{name.split()[0].lower()}.com", desc, city, country,
             region_for(country),
             stage, "Passed" if stage == "Passed" else "Active", prio, dtype,
             "Banker" if adv else "Proprietary", adv or None, "Owen Brooks" if i % 2 else "Alex Morgan",
             "EUR" if country in ("Germany", "Italy", "Netherlands") else "GBP" if country == "United Kingdom" else "USD",
             ev, rev, ebitda, emp, founded, "Founder-owned" if i % 3 == 0 else "Family-owned" if i % 3 == 1 else "Corporate parent",
             next_step[0] if next_step else None,
             (now + timedelta(days=next_step[1])).date().isoformat() if next_step else None,
             "platform,priority" if prio == "High" else "", changed.isoformat(), created.isoformat(), changed.isoformat()),
        )
        cid = cur.lastrowid
        company_ids.append(cid)
        prev = None
        for k, st in enumerate(stages[: stage_idx + 1] if stage not in ("Passed",) else [stages[0], stages[2], "Passed"]):
            db.execute("INSERT INTO stage_history (company_id, from_stage, to_stage, changed_at) VALUES (?,?,?,?)",
                       (cid, prev, st, min(created + step * k, changed).isoformat()))
            prev = st
        db.execute("INSERT INTO activity (company_id, entity_type, entity_id, action, summary, created_at) VALUES (?,?,?,?,?,?)",
                   (cid, "company", cid, "created", f"Added {name} to the pipeline", created.isoformat()))
        if stage_idx > 0:
            db.execute("INSERT INTO activity (company_id, entity_type, entity_id, action, summary, created_at) VALUES (?,?,?,?,?,?)",
                       (cid, "company", cid, "stage", f"{stages[stage_idx - 1] if stage != 'Passed' else 'CIM Review'} → {stage}",
                        changed.isoformat()))

    # Key facts for the flagship deal, as if a CIM had been applied.
    kf = {
        "facts": [
            {"key": "revenue", "label": "Revenue (FY2025)", "display": "$62.4m", "page": 3, "confidence": 0.85, "source": "rules"},
            {"key": "ebitda", "label": "EBITDA (FY2025)", "display": "$17.8m", "page": 3, "confidence": 0.85, "source": "rules"},
            {"key": "recurring_revenue", "label": "Recurring revenue", "display": "88%", "page": 2, "confidence": 0.7, "source": "rules"},
            {"key": "net_retention", "label": "Net revenue retention", "display": "114%", "page": 2, "confidence": 0.8, "source": "rules"},
            {"key": "customers", "label": "Customers", "display": "1,250+", "page": 2, "confidence": 0.7, "source": "rules"},
            {"key": "concentration", "label": "Top 10 customers", "display": "11% of revenue", "page": 2, "confidence": 0.8, "source": "rules"},
            {"key": "ceo", "label": "CEO", "display": "Jane Whitfield", "page": 2, "confidence": 0.7, "source": "rules"},
            {"key": "bid_deadline", "label": "Bid deadline", "display": "November 14, 2026", "page": 1, "confidence": 0.75, "source": "rules"},
        ],
        "highlights": [{"text": t, "page": 2} for t in (
            "Mission-critical SaaS platform embedded in customer planning workflows",
            "Highly recurring revenue base with 114% net revenue retention",
            "Large and underpenetrated market for mid-market supply chain software",
            "Proven M&A playbook with three successful tuck-in acquisitions",
        )],
        "risks": [{"text": t, "page": 3} for t in (
            "Customer concentration in the automotive vertical", "Competition from large ERP vendors")],
        "series": {
            "revenue": {"2022": {"value": 32.1, "projected": False}, "2023": {"value": 40.5, "projected": False},
                        "2024": {"value": 50.3, "projected": False}, "2025": {"value": 62.4, "projected": False},
                        "2026": {"value": 76.0, "projected": True}},
            "ebitda": {"2022": {"value": 6.1, "projected": False}, "2023": {"value": 9.3, "projected": False},
                       "2024": {"value": 13.1, "projected": False}, "2025": {"value": 17.8, "projected": False},
                       "2026": {"value": 23.6, "projected": True}},
        },
        "currency": "USD",
        "applied_at": now.isoformat(),
    }
    db.execute("UPDATE companies SET key_facts = ? WHERE id = ?", (json.dumps(kf), company_ids[0]))

    contact_ids = []
    for name, title, org, cidx, ctype, email, city, strength in CONTACTS:
        ts = (now - timedelta(days=60)).isoformat()
        cur = db.execute(
            "INSERT INTO contacts (name, title, organization, company_id, contact_type, email, city, strength, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (name, title, org or (COMPANIES[cidx][0] if cidx is not None else None),
             company_ids[cidx] if cidx is not None else None, ctype, email, city, strength, ts, ts))
        contact_ids.append(cur.lastrowid)
    for ct, co, role in DEAL_LINKS:
        db.execute("INSERT OR IGNORE INTO company_contacts (company_id, contact_id, role, created_at) VALUES (?,?,?,?)",
                   (company_ids[co], contact_ids[ct], role, now.isoformat()))
    for a, b, rel in LINKS:
        db.execute("INSERT INTO contact_links (from_contact_id, to_contact_id, relation, created_at) VALUES (?,?,?,?)",
                   (contact_ids[a], contact_ids[b], rel, now.isoformat()))

    for title, mtype, cidx, offset, dur, loc, notes, take, nxt, sent, att in MEETINGS:
        when = (now + timedelta(days=offset)).replace(hour=15, minute=0, second=0)
        cur = db.execute(
            "INSERT INTO meetings (title, meeting_type, company_id, starts_at, duration_min, location, notes, takeaways, "
            "next_steps, sentiment, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (title, mtype, company_ids[cidx] if cidx is not None else None, when.isoformat(), dur, loc,
             notes or None, take or None, nxt or None, sent, when.isoformat(), when.isoformat()))
        mid = cur.lastrowid
        for a in att:
            db.execute("INSERT OR IGNORE INTO meeting_attendees (meeting_id, contact_id) VALUES (?,?)", (mid, contact_ids[a]))
        if offset <= 0:
            db.execute("INSERT INTO activity (company_id, entity_type, entity_id, action, summary, created_at) VALUES (?,?,?,?,?,?)",
                       (company_ids[cidx] if cidx is not None else None, "meeting", mid, "created", f"{mtype}: {title}",
                        when.isoformat()))

    _seed_memory(db, now, company_ids, contact_ids)


TEAM = ["Alex Morgan", "Owen Brooks", "Priya Shah", "Sam Lee"]

# company_idx -> (lead, team, nda_signed_days_ago, nda_term_days)
DEAL_TEAMS = {
    0: ("Alex Morgan", "Priya Shah, Sam Lee", 95, 730),
    1: ("Owen Brooks", "Sam Lee", 120, 140),        # NDA expiring soon
    2: ("Priya Shah", "", 30, 730),
    3: (None, "", None, None),                       # no lead: knowledge has no owner
    4: ("Alex Morgan", "Owen Brooks", 200, 730),
    5: ("Sam Lee", "", None, None),
    6: ("Owen Brooks", "Alex Morgan", 160, 730),
    7: ("Priya Shah", "", 400, 380),                 # passed deal, NDA expired
    8: ("Alex Morgan", "Owen Brooks", 500, 1095),
}
CONTACT_OWNERS = {
    0: "Alex Morgan", 1: "Priya Shah", 2: "Alex Morgan", 3: "Sam Lee", 4: "Owen Brooks", 5: "Owen Brooks",
    6: "Priya Shah", 7: "Priya Shah", 8: "Alex Morgan", 9: "Alex Morgan", 10: "Sam Lee", 11: "Owen Brooks",
    12: "Sam Lee", 13: "Owen Brooks", 14: "Alex Morgan", 15: "Alex Morgan",
}


def _seed_memory(db, now, company_ids, contact_ids):
    dbm.set_setting("team_members", TEAM, db)
    for idx, (lead, team, signed, term) in DEAL_TEAMS.items():
        nda_signed = (now - timedelta(days=signed)).date().isoformat() if signed else None
        nda_exp = (now - timedelta(days=signed) + timedelta(days=term)).date().isoformat() if signed else None
        db.execute("UPDATE companies SET deal_lead = ?, deal_team = ?, nda_signed_date = ?, nda_expiry_date = ? WHERE id = ?",
                   (lead, team or None, nda_signed, nda_exp, company_ids[idx]))
    # Tidewater: passed, with the reasoning a successor would otherwise never find.
    db.execute(
        "UPDATE companies SET pass_reason = ?, pass_notes = ?, revisit_date = ? WHERE id = ?",
        ("Valuation gap",
         "Seller anchored on 16x LTM EBITDA vs our 11x. Business quality fine; customs brokerage margins "
         "under pressure from digital forwarders. Would re-engage below 12x or if ASEAN volumes recover.",
         (now + timedelta(days=9)).date().isoformat(), company_ids[7]))
    db.execute("UPDATE activity SET summary = summary || ' — Valuation gap' WHERE company_id = ? AND action = 'stage'",
               (company_ids[7],))
    for idx, owner in CONTACT_OWNERS.items():
        db.execute("UPDATE contacts SET owner = ? WHERE id = ?", (owner, contact_ids[idx]))
    # A strong relationship nobody has spoken to in a while.
    db.execute("UPDATE contacts SET strength = 4, created_at = ? WHERE id = ?", ((now - timedelta(days=150)).isoformat(), contact_ids[12]))
