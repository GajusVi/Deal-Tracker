"""Optional Claude-powered CIM analysis.

Used only when an Anthropic API key is configured (env var ANTHROPIC_API_KEY or
the key saved in Settings). Returns facts in the same shape as the rule engine
so the UI can show both side by side.
"""
import base64
import json
import os
import re

from .extractor import _fact, fmt_money
from .geo import canonical_country, region_for

MODEL = "claude-opus-5-5"
MAX_PDF_BYTES = 30 * 1024 * 1024

_FIELD = {
    "type": "object",
    "properties": {
        "value": {"type": "string", "description": "The fact, or empty string if not stated."},
        "page": {"type": "string", "description": "Page number where it appears, or empty string."},
        "quote": {"type": "string", "description": "Short verbatim quote supporting the value, or empty string."},
    },
    "required": ["value", "page", "quote"],
    "additionalProperties": False,
}

# key -> (label, description for the model)
FIELDS = {
    "name": ("Company name", "Legal or trading name of the target company (not the project codename)."),
    "codename": ("Project codename", "Process codename, e.g. 'Project Atlas'."),
    "description": ("Business description", "One or two sentence description of what the company does."),
    "sector": ("Sector", "Best-fitting sector from the allowed list."),
    "hq_city": ("HQ city", "Headquarters city (and state/province if given)."),
    "country": ("HQ country", "Headquarters country, full English name."),
    "founded_year": ("Founded", "Four-digit founding year."),
    "employees": ("Employees", "Headcount as an integer."),
    "website": ("Website", "Company website domain."),
    "ceo": ("CEO", "Name of the chief executive."),
    "ownership": ("Ownership", "Current ownership, e.g. 'Founder-owned' or the sponsor's name."),
    "advisor": ("Sell-side advisor", "Investment bank / advisor running the process."),
    "deal_type": ("Transaction type", "One of: Buyout, Growth Equity, Add-on, Minority, Carve-out, Recap, Take-private."),
    "bid_deadline": ("Bid deadline", "Next bid / IOI deadline as stated."),
    "currency": ("Currency", "ISO currency code of the financials, e.g. USD."),
    "revenue": ("Revenue", "Latest actual (or LTM) revenue in millions of the reporting currency, number only."),
    "revenue_year": ("Revenue year", "Fiscal year or 'LTM' for the revenue figure."),
    "ebitda": ("EBITDA", "Latest actual (or LTM) adjusted EBITDA in millions, number only."),
    "ebitda_margin": ("EBITDA margin", "Latest EBITDA margin in percent, number only."),
    "cagr": ("Growth (CAGR)", "Historical revenue CAGR in percent, number only."),
    "recurring_revenue": ("Recurring revenue", "Share of recurring revenue in percent, number only."),
    "customers": ("Customers", "Number of customers, integer."),
    "concentration": ("Customer concentration", "Concentration statement, e.g. 'Top 10 = 11% of revenue'."),
}


def _schema(sectors):
    props = {k: dict(_FIELD, description=desc) for k, (_, desc) in FIELDS.items()}
    props["highlights"] = {"type": "array", "items": {"type": "string"},
                           "description": "Up to 8 key investment highlights, one line each."}
    props["risks"] = {"type": "array", "items": {"type": "string"},
                      "description": "Up to 6 key risks or diligence questions a PE investor should probe."}
    props["summary"] = {"type": "string", "description": "3-4 sentence investment summary for a deal team."}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def api_key_from(settings):
    return os.environ.get("ANTHROPIC_API_KEY") or (settings or {}).get("anthropic_api_key") or ""


def _to_float(s):
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", s or "")
    return float(m.group(0).replace(",", "")) if m else None


def analyze_with_claude(path, filename, pages, api_key, sectors):
    import anthropic

    client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()

    content = []
    is_pdf = filename.lower().endswith(".pdf")
    if is_pdf and os.path.getsize(path) <= MAX_PDF_BYTES:
        with open(path, "rb") as fh:
            data = base64.standard_b64encode(fh.read()).decode()
        content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}})
    else:
        text = "\n\n".join(f"[Page {i}]\n{p}" for i, p in enumerate(pages, 1))
        content.append({"type": "text", "text": f"<document name=\"{filename}\">\n{text}\n</document>"})
    content.append({
        "type": "text",
        "text": (
            "You are helping a private equity deal team screen this Confidential Information Memorandum. "
            "Extract the key facts about the target company. Only report what the document states; leave a "
            "field's value empty when it is not stated. For every value give the page and a short verbatim quote. "
            "Prefer latest actual or LTM figures over projections. "
            f"Allowed sectors: {', '.join(sectors)}."
        ),
    })

    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _schema(sectors)}},
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude declined to analyze this document.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    data = json.loads(text)
    return to_analysis(data)


def to_analysis(data):
    facts = []
    currency = (data.get("currency") or {}).get("value") or "USD"
    for key, (label, _) in FIELDS.items():
        if key in ("currency", "revenue_year"):
            continue
        f = data.get(key) or {}
        raw = (f.get("value") or "").strip()
        if not raw:
            continue
        page = int(f["page"]) if str(f.get("page", "")).isdigit() else None
        quote = f.get("quote") or None
        value, display = raw, raw
        if key in ("revenue", "ebitda"):
            value = _to_float(raw)
            if value is None:
                continue
            yr = (data.get("revenue_year") or {}).get("value") or ""
            display = fmt_money(value, currency) + (f" ({yr})" if yr and key == "revenue" else "")
        elif key in ("ebitda_margin", "cagr", "recurring_revenue"):
            value = _to_float(raw)
            if value is None:
                continue
            display = f"{value:g}%"
        elif key in ("founded_year", "employees", "customers"):
            n = _to_float(raw)
            if n is None:
                continue
            value = int(n)
            display = f"{value:,}" if key != "founded_year" else str(value)
        elif key == "country":
            value = canonical_country(raw) or raw
            display = value
        f_out = _fact(key, label, value, display, page, quote, 0.9)
        f_out["source"] = "claude"
        if key in ("revenue", "ebitda"):
            f_out["currency"] = currency
        facts.append(f_out)
        if key == "country" and region_for(value):
            r = _fact("region", "Region", region_for(value), region_for(value), page, quote, 0.9)
            r["source"] = "claude"
            facts.append(r)
    return {
        "engine": "claude",
        "facts": facts,
        "highlights": [{"text": h, "page": None} for h in data.get("highlights") or []],
        "risks": [{"text": h, "page": None} for h in data.get("risks") or []],
        "summary": data.get("summary") or "",
    }
