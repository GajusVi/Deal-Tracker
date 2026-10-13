import io
import os

import pytest
from openpyxl import Workbook

from dealtracker.app import create_app
from dealtracker.extractor import analyze_pages, extract_pages, fact_updates
from dealtracker.models_parser import parse_model

SAMPLES = os.path.join(os.path.dirname(__file__), "..", "samples")


@pytest.fixture
def client(tmp_path):
    app = create_app(str(tmp_path))
    return app.test_client()


def facts_by_key(result):
    return {f["key"]: f for f in result["facts"]}


def test_extractor_text_cim():
    path = os.path.join(SAMPLES, "Project_Atlas_CIM.txt")
    r = analyze_pages(extract_pages(path, "Project_Atlas_CIM.txt"), "Project_Atlas_CIM.txt")
    f = facts_by_key(r)
    assert f["name"]["value"] == "Northwind Analytics, Inc."
    assert f["codename"]["value"] == "Project Atlas"
    assert f["revenue"]["value"] == pytest.approx(62.4)
    assert f["revenue"]["year"] == 2025
    assert f["ebitda"]["value"] == pytest.approx(17.8)
    assert f["founded_year"]["value"] == 2009
    assert f["employees"]["value"] == 340
    assert f["country"]["value"] == "United States"
    assert f["region"]["value"] == "North America"
    assert f["sector"]["value"] == "Software & Tech"
    assert f["net_retention"]["value"] == 114
    assert f["bid_deadline"]["value"] == "November 14, 2026"
    assert f["revenue"]["page"] == 3 and f["revenue"]["snippet"]
    assert r["series"]["revenue"]["2026"]["projected"] is True
    assert len(r["highlights"]) == 5 and len(r["risks"]) == 2


def test_extractor_pdf_cim():
    path = os.path.join(SAMPLES, "Project_Cedar_CIM.pdf")
    r = analyze_pages(extract_pages(path, "Project_Cedar_CIM.pdf"), "Project_Cedar_CIM.pdf")
    f = facts_by_key(r)
    assert f["name"]["value"] == "Meridian Veterinary Partners Ltd"
    assert f["revenue"]["value"] == pytest.approx(84.6) and f["revenue"]["currency"] == "GBP"
    assert f["ebitda"]["value"] == pytest.approx(16.9)
    assert f["hq"]["value"] == {"city": "Bristol", "country": "United Kingdom"}
    assert f["sector"]["value"] == "Healthcare"
    assert f["ceo"]["value"] == "Helen Marsh"
    assert len(r["highlights"]) == 5
    upd = fact_updates(r["facts"])
    assert upd["hq_city"] == "Bristol" and upd["region"] == "UK & Ireland" and upd["currency"] == "GBP"


def test_model_parser():
    r = parse_model(os.path.join(SAMPLES, "Project_Atlas_LBO_v1.xlsx"), "m.xlsx")
    out = {o["key"]: o for o in r["outputs"]}
    assert out["irr"]["display"] == "23.1%"
    assert out["moic"]["display"] == "2.60x"
    assert out["entry_ev"]["value"] == 380
    assert [s["name"] for s in r["sheets"]] == ["Returns", "Operating Model", "Debt Schedule"]
    assert parse_model(__file__, "x.xls")["supported"] is False


def test_company_crud_and_stage_history(client):
    r = client.post("/api/companies", json={"name": "Acme", "country": "Germany", "ev": "120", "ebitda": 10})
    assert r.status_code == 201
    c = r.json
    assert c["region"] == "DACH" and c["stage"] == "Sourcing" and c["ev_ebitda"] == 12.0
    r = client.patch(f"/api/companies/{c['id']}", json={"stage": "LOI"})
    assert [h["to_stage"] for h in r.json["stage_history"]] == ["Sourcing", "LOI"]
    assert any(a["action"] == "stage" for a in r.json["activity"])
    assert client.post("/api/companies", json={"name": ""}).status_code == 400
    assert client.delete(f"/api/companies/{c['id']}").json["ok"]
    assert client.get(f"/api/companies/{c['id']}").status_code == 404


def test_undo_stage_leaves_no_trace(client):
    c = client.post("/api/companies", json={"name": "Undo Co"}).json
    before = client.get(f"/api/companies/{c['id']}").json
    client.patch(f"/api/companies/{c['id']}", json={"stage": "Passed", "status": "Passed", "pass_reason": "Valuation"})
    r = client.post(f"/api/companies/{c['id']}/undo-stage", json={"status": "Active"})
    assert r.status_code == 200
    assert r.json["stage"] == "Sourcing" and r.json["status"] == "Active"
    assert r.json["stage_history"] == before["stage_history"]
    assert r.json["stage_changed_at"] == before["stage_changed_at"]
    assert not any(a["action"] == "stage" for a in r.json["activity"])
    # nothing left to undo: only the creation entry remains
    assert client.post(f"/api/companies/{c['id']}/undo-stage").status_code == 400


def test_new_company_from_cim(client):
    with open(os.path.join(SAMPLES, "Project_Cedar_CIM.pdf"), "rb") as fh:
        doc = client.post("/api/cim/analyze", data={"file": (fh, "Project_Cedar_CIM.pdf")},
                          content_type="multipart/form-data").json
    facts = doc["analysis"]["facts"]
    c = client.post("/api/companies", json={"name": "Meridian", "cim_document_id": doc["id"], "accepted_facts": facts}).json
    assert c["name"] == "Meridian"  # user-typed name wins
    assert c["revenue"] == pytest.approx(84.6) and c["currency"] == "GBP" and c["sector"] == "Healthcare"
    assert c["documents"][0]["id"] == doc["id"]
    assert len(c["key_facts"]["highlights"]) == 5


def test_model_versions(client, tmp_path):
    cid = client.post("/api/companies", json={"name": "Acme"}).json["id"]
    for i in (1, 2):
        wb = Workbook()
        wb.active.append(["IRR", 0.2 + i / 100])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        d = client.post(f"/api/companies/{cid}/documents", data={"kind": "model", "file": (buf, f"lbo{i}.xlsx")},
                        content_type="multipart/form-data").json
        assert d["version"] == i
    assert client.get(f"/api/documents/{d['id']}/download").status_code == 200


def test_meetings_contacts_graph(client):
    cid = client.post("/api/companies", json={"name": "Acme"}).json["id"]
    p1 = client.post("/api/contacts", json={"name": "Ann Banker", "organization": "Big Bank"}).json["id"]
    p2 = client.post("/api/contacts", json={"name": "Bob CEO", "company_id": cid}).json["id"]
    client.post(f"/api/contacts/{p1}/links", json={"to_contact_id": p2, "relation": "Advisor to"})
    m = client.post("/api/meetings", json={"title": "Mgmt pres", "company_id": cid, "starts_at": "2026-10-01T14:00:00Z",
                                          "notes": "Great margins", "attendee_ids": [p1, p2]}).json
    assert m["starts_at"] == "2026-10-01T14:00:00+00:00" and len(m["attendees"]) == 2
    # attendee from another org is linked to the deal; the employee is already shown
    people = client.get(f"/api/companies/{cid}").json["contacts"]
    assert {p["name"] for p in people} == {"Ann Banker", "Bob CEO"}
    g = client.get("/api/graph").json
    kinds = {e["kind"] for e in g["edges"]}
    assert {"employee", "relation", "deal"} <= kinds
    assert any(r["type"] == "meeting" for r in client.get("/api/search?q=margins").json)
    assert client.post("/api/meetings", json={"title": "x"}).status_code == 400


def test_dashboard_demo_and_exports(client):
    assert client.post("/api/demo").json["ok"]
    assert client.post("/api/demo").status_code == 400  # only into an empty workspace
    d = client.get("/api/dashboard").json
    assert d["kpis"]["live_deals"] == 7 and len(d["by_stage"]) == 9
    assert client.get("/api/export/companies.csv").data.startswith(b"id,name")
    assert "companies" in client.get("/api/export/backup.json").json


def test_settings_hide_api_key(client):
    client.put("/api/settings", json={"anthropic_api_key": "sk-test", "firm_name": "Fund X"})
    meta = client.get("/api/meta").json
    assert "anthropic_api_key" not in meta["settings"] and meta["has_stored_api_key"]
    assert meta["settings"]["firm_name"] == "Fund X"
    assert client.put("/api/settings", json={"stages": []}).status_code == 400


def test_claude_result_mapping():
    from dealtracker.ai import FIELDS, _schema, to_analysis

    blank = {"value": "", "page": "", "quote": ""}
    data = {k: dict(blank) for k in FIELDS}
    data.update(
        name={"value": "Acme Ltd", "page": "2", "quote": "Acme Ltd is a leading"},
        revenue={"value": "£84.6m", "page": "3", "quote": "Revenue 84.6"},
        currency={"value": "GBP", "page": "", "quote": ""},
        country={"value": "UK", "page": "2", "quote": "based in the UK"},
        employees={"value": "approx. 1,150", "page": "2", "quote": ""},
        highlights=["Scaled platform"], risks=["Labour"], summary="Solid asset.",
    )
    a = to_analysis(data)
    f = {x["key"]: x for x in a["facts"]}
    assert f["revenue"]["value"] == 84.6 and f["revenue"]["currency"] == "GBP" and f["revenue"]["source"] == "claude"
    assert f["country"]["value"] == "United Kingdom" and f["region"]["value"] == "UK & Ireland"
    assert f["employees"]["value"] == 1150 and f["name"]["page"] == 2
    assert a["summary"] == "Solid asset." and a["highlights"][0]["text"] == "Scaled platform"
    schema = _schema(["Healthcare"])
    assert set(schema["required"]) == set(schema["properties"]) and schema["additionalProperties"] is False


def test_memory_features(client):
    client.post("/api/demo")
    d = client.get("/api/dashboard").json
    kinds = {a["kind"] for a in d["attention"]}
    assert {"nda", "overdue", "revisit", "owner", "cold"} <= kinds
    assert 0 < d["knowledge"] <= 100 and d["intermediaries"] and len(d["team"]) == 4

    # Deal records are reported as concrete counts and named gaps, not just a score.
    rec = d["records"]
    assert rec["live"] == 7 and 0 < rec["complete"] < rec["live"]
    assert rec["gaps"] == sum(len(i["missing"]) for i in rec["items"])
    model = next(i for i in rec["items"] if i["key"] == "model")
    assert model["have"] + len(model["missing"]) == rec["live"]
    listed = {c["name"]: c["record"] for c in client.get("/api/companies").json}
    assert listed["Northwind Analytics"]["missing"] == [] and listed["Northwind Analytics"]["done"] == 7
    assert "deal lead" in listed["Brightpath Learning"]["missing"]
    assert [i["short"] for i in client.get("/api/meta").json["record_items"]][3] == "model"
    assert all({"complete", "gaps"} <= m.keys() for m in d["team"])

    # Prior looks: re-adding a passed company surfaces why it was passed.
    hits = client.get("/api/companies/similar?name=Tidewater Logistics Pte. Ltd.").json
    assert hits[0]["name"] == "Tidewater Logistics" and hits[0]["pass_reason"] == "Valuation gap"
    assert client.get("/api/companies/similar?name=Zebra Widgets").json == []

    # Passing records the reason in the stage history.
    cid = client.post("/api/companies", json={"name": "Acme", "deal_lead": "Sam Lee"}).json["id"]
    c = client.patch(f"/api/companies/{cid}", json={"stage": "Passed", "status": "Passed", "pass_reason": "Timing",
                                                    "pass_notes": "Too early", "revisit_date": "2027-01-01"}).json
    assert c["pass_reason"] == "Timing"
    assert any("Passed — Timing: Too early" in a["summary"] for a in c["activity"])
    assert {k["key"] for k in c["knowledge"]["checks"]} >= {"lead", "decision"}

    # Handover pack and reassignment.
    h = client.get("/api/handover?member=Alex Morgan").json
    assert h["summary"]["live"] >= 1 and h["contacts"] and h["deals"][0]["knowledge"]["checks"]
    r = client.post("/api/handover/reassign", json={"from": "Alex Morgan", "to": "Priya Shah"}).json
    assert r["deals"] >= 1 and r["contacts"] >= 1
    assert client.get("/api/handover?member=Alex Morgan").json["summary"]["deals"] == 0
    assert client.post("/api/handover/reassign", json={"from": "A", "to": "A"}).status_code == 400


def test_migration_adds_columns(tmp_path):
    import sqlite3

    from dealtracker import db as dbm

    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(dbm.SCHEMA)  # first-release schema, without migrated columns
    conn.close()
    dbm.init_db(str(path))
    cols = {r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(companies)")}
    assert {"pass_reason", "nda_expiry_date", "deal_team"} <= cols


def test_clear_demo_keeps_user_records(client):
    client.post("/api/demo")
    assert client.get("/api/meta").json["demo"] == {"companies": 9, "contacts": 16, "meetings": 12}
    mine = client.post("/api/companies", json={"name": "My Real Co"}).json["id"]
    person = client.post("/api/contacts", json={"name": "Real Person", "link_company_id": 1}).json["id"]
    client.post("/api/meetings", json={"title": "Real meeting", "company_id": 1, "starts_at": "2026-10-01T10:00:00Z",
                                       "attendee_ids": [person]})
    removed = client.delete("/api/demo").json["removed"]
    assert removed == {"companies": 9, "contacts": 16, "meetings": 12}
    assert [c["id"] for c in client.get("/api/companies").json] == [mine]
    assert [c["name"] for c in client.get("/api/contacts").json] == ["Real Person"]
    meetings = client.get("/api/meetings").json
    assert [m["title"] for m in meetings] == ["Real meeting"] and meetings[0]["company_id"] is None
    meta = client.get("/api/meta").json
    assert meta["demo"] == {"companies": 0, "contacts": 0, "meetings": 0}
    assert meta["settings"]["team_members"] == []


def test_legacy_demo_data_is_recognised(tmp_path):
    import sqlite3

    from dealtracker.app import create_app

    create_app(str(tmp_path)).test_client().post("/api/demo")
    db = sqlite3.connect(tmp_path / "dealtracker.db")
    for t in ("companies", "contacts", "meetings"):  # as written by a version without the demo flag
        db.execute(f"ALTER TABLE {t} DROP COLUMN is_demo")
    db.commit()
    db.close()
    client = create_app(str(tmp_path)).test_client()
    assert client.get("/api/meta").json["demo"] == {"companies": 9, "contacts": 16, "meetings": 12}
    client.delete("/api/demo")
    assert client.get("/api/companies").json == []
