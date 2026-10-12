"""Turn an uploaded CIM / teaser into text and detect key company facts.

The rule-based engine works fully offline. Every fact it returns carries the
sentence it came from and the page number, so the user can verify it before
applying it to the company record.
"""
import os
import re
from collections import Counter
from datetime import date

from .geo import ALIASES, COUNTRY_TO_REGION, US_STATES, CA_PROVINCES, canonical_country, region_for

# --------------------------------------------------------------------------- text


def extract_pages(path, filename):
    """Return a list of page texts for PDF / DOCX / PPTX-less text formats."""
    ext = os.path.splitext(filename.lower())[1]
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:  # damaged page - keep page numbering intact
                pages.append("")
        return pages
    if ext == ".docx":
        import docx

        d = docx.Document(path)
        parts = [p.text for p in d.paragraphs]
        for table in d.tables:
            for r in table.rows:
                parts.append("  ".join(c.text.strip() for c in r.cells))
        return ["\n".join(parts)]
    if ext in (".txt", ".md", ".csv"):
        with open(path, encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
        # Treat form feeds as page breaks so page references still work.
        return text.split("\f")
    return []


# ------------------------------------------------------------------- primitives

CUR = r"(?P<cur>US\$|USD|EUR|GBP|CHF|C\$|A\$|\$|€|£)"
NUM = r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
UNIT = r"(?P<unit>billion|bn|b|million|mm|mn|m|thousand|k)?"
MONEY = CUR + r"\s?" + NUM + r"\s?" + UNIT + r"(?![a-z])"
MONEY_RE = re.compile(MONEY, re.I)

CURRENCY_CODES = {
    "$": "USD", "US$": "USD", "USD": "USD", "€": "EUR", "EUR": "EUR", "£": "GBP",
    "GBP": "GBP", "CHF": "CHF", "C$": "CAD", "A$": "AUD",
}

YEAR_RE = re.compile(r"\b(?:FY|CY)?\s?'?((?:19|20)\d{2})\s?([AEPFB]|E|LTM)?\b")
PCT_RE = re.compile(r"(\d{1,3}(?:\.\d+)?)\s?%")

WORD_NUMS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
             "eight": 8, "nine": 9, "ten": 10, "twenty": 20}


def _num(s):
    return float(s.replace(",", ""))


def to_millions(num, unit, default_unit="m"):
    unit = (unit or "").lower()
    if unit in ("billion", "bn", "b"):
        return num * 1000
    if unit in ("million", "mm", "mn", "m"):
        return num
    if unit in ("thousand", "k"):
        return num / 1000
    # Unitless figure: very large numbers are raw currency amounts.
    if num >= 100000:
        return num / 1e6
    if default_unit == "k":
        return num / 1000
    return num


def fmt_money(m, cur="USD"):
    sym = {"USD": "$", "EUR": "€", "GBP": "£"}.get(cur, cur + " ")
    if m is None:
        return ""
    if abs(m) >= 1000:
        return f"{sym}{m / 1000:,.2f}bn"
    if abs(m) >= 1:
        return f"{sym}{m:,.1f}m"
    return f"{sym}{m * 1000:,.0f}k"


def _clean(text):
    return re.sub(r"\s+", " ", text).strip()


ABBREV = re.compile(r"(?:\b(?:Inc|Ltd|Co|Corp|LLC|L\.P|N\.V|S\.A|No|approx|e\.g|i\.e|vs|Mr|Ms|Dr|St|Jr|U\.S|U\.K)\.|\b[A-Z]\.)$")


def _blocks(text):
    """Group raw lines into blocks; short unpunctuated lines (headings) stand alone."""
    blocks, cur = [], []
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            if cur:
                blocks.append(" ".join(cur))
                cur = []
            continue
        if re.match(r"^[•▪●■\-–—*✓]\s", ln) and cur:
            blocks.append(" ".join(cur))
            cur = []
        cur.append(ln)
        if len(ln) < 60 and not re.search(r"[.,;:!?)]$", ln) and not re.search(r"\b(?:and|of|the|to|in|for|with|by|a|an)$", ln, re.I):
            blocks.append(" ".join(cur))
            cur = []
    if cur:
        blocks.append(" ".join(cur))
    return blocks


def split_sentences(text):
    out = []
    for block in _blocks(text):
        parts = re.split(r"(?<=[.!?])\s+(?=[A-Z“\"•\-])|\s+[•▪●■]\s+", _clean(block))
        merged = []
        for part in parts:
            if merged and ABBREV.search(merged[-1]):
                merged[-1] += " " + part
            else:
                merged.append(part)
        out.extend(p.strip(" •▪●■-") for p in merged if len(p.strip()) > 3)
    return out


class Doc:
    """Pre-split view of the document used by every detector."""

    def __init__(self, pages):
        self.pages = pages
        self.sentences = []  # (page_no, sentence)
        self.lines = []  # (page_no, line)
        for i, p in enumerate(pages, start=1):
            for s in split_sentences(p):
                self.sentences.append((i, s))
            for ln in p.splitlines():
                ln = ln.strip()
                if ln:
                    self.lines.append((i, ln))
        self.full = "\n".join(pages)
        self.default_unit = self._detect_unit()

    def _detect_unit(self):
        head = self.full[:200000]
        k = len(re.findall(r"in\s+thousands|\(\s*[$€£]?\s*0{3}s?\s*\)|[$€£]\s?000s|\$K\b", head, re.I))
        m = len(re.findall(r"in\s+millions|\(\s*[$€£]?\s*mm?\s*\)|[$€£]\s?m(?:m|n)?\b", head, re.I))
        return "k" if k > m else "m"


def _snip(s, limit=320):
    s = _clean(s)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _fact(key, label, value, display, page, snippet, confidence, **extra):
    f = {
        "key": key, "label": label, "value": value, "display": display,
        "page": page, "snippet": _snip(snippet) if snippet else None,
        "confidence": round(min(confidence, 0.97), 2), "source": "rules",
    }
    f.update(extra)
    return f


# ------------------------------------------------------------------- detectors

METRICS = {
    "revenue": (r"(?:total\s+|net\s+|annual\s+|recurring\s+)?(?:revenues?|net\s+sales|sales|turnover|topline)", "Revenue"),
    "ebitda": (r"(?:adj(?:usted|\.)?\s+|pro\s+forma\s+|reported\s+)?EBITDA(?!\s+margin)", "EBITDA"),
    "gross_profit": (r"gross\s+profit", "Gross profit"),
    "arr": (r"(?:annual(?:ized)?\s+recurring\s+revenue|ARR)", "ARR"),
}


def _year_near(sentence, pos):
    best, best_d = None, 10 ** 9
    for m in YEAR_RE.finditer(sentence):
        y = int(m.group(1))
        if y < 1990 or y > date.today().year + 8:
            continue
        d = abs(m.start() - pos)
        if d < best_d:
            best, best_d = (y, (m.group(2) or "").upper()), d
    if re.search(r"\bLTM\b|last\s+twelve\s+months|trailing\s+twelve", sentence, re.I):
        return ("LTM", "")
    return best


def detect_metric_mentions(doc, key):
    pattern, label = METRICS[key]
    rx = re.compile(pattern + r"[^.;$€£]{0,70}?" + MONEY, re.I)
    found = []
    for page, s in doc.sentences:
        for m in rx.finditer(s):
            # Skip "revenue growth of $5m", "EBITDA margin" style phrases.
            between = m.group(0)[: m.start("cur") - m.start()]
            if re.search(r"\bmargin|per\s+(?:employee|customer|unit)|growth|increase|synerg", between, re.I):
                continue
            cur = CURRENCY_CODES.get(m.group("cur").upper(), CURRENCY_CODES.get(m.group("cur"), "USD"))
            val = to_millions(_num(m.group("num")), m.group("unit"), doc.default_unit)
            if val <= 0:
                continue
            yr = _year_near(s, m.start("cur"))
            projected = bool(yr and yr[1] in ("E", "P", "F", "B")) or bool(
                re.search(r"\b(?:expected|projected|forecast|budget|plan(?:ned)?|will)\b", s, re.I)
            )
            found.append({"page": page, "snippet": s, "value": val, "currency": cur,
                          "year": yr[0] if yr else None, "projected": projected})
    return found


def _numbers_in(line):
    toks = re.findall(r"\(?-?[$€£]?\s?\d[\d,]*(?:\.\d+)?\)?%?", line)
    out = []
    for t in toks:
        pct = t.endswith("%")
        neg = t.startswith("(") and t.rstrip("%").endswith(")") or t.lstrip("(").startswith("-")
        digits = re.sub(r"[^\d.]", "", t)
        if not digits or digits == ".":
            continue
        try:
            v = float(digits)
        except ValueError:
            continue
        out.append((-v if neg else v, pct))
    return out


TABLE_ROWS = {
    "revenue": re.compile(r"^(?:total\s+|net\s+)?(?:revenues?|net\s+sales|sales|turnover)\b", re.I),
    "ebitda": re.compile(r"^(?:adj(?:usted|\.)?\s+|pro\s+forma\s+)?EBITDA\b(?!\s*margin)", re.I),
    "ebitda_margin": re.compile(r"^(?:adj(?:usted|\.)?\s+)?EBITDA\s+margin", re.I),
    "gross_margin": re.compile(r"^gross\s+margin", re.I),
}


def detect_financial_tables(doc):
    """Find rows such as 'Revenue  45.2  52.1  60.3' under a '2021A 2022A 2023E' header."""
    series = {}
    header, header_page = None, None
    for page, line in doc.lines:
        years = [(int(y), (s or "").upper()) for y, s in re.findall(r"\b(?:FY|CY)?'?((?:19|20)\d{2})\s?([AEPFB])?\b", line)]
        nums_in_line = _numbers_in(re.sub(r"\b(?:FY|CY)?'?(?:19|20)\d{2}[AEPFB]?\b", "", line))
        if len(years) >= 2 and len(nums_in_line) <= 1:
            header, header_page = years, page
            continue
        if not header or page - header_page > 1:
            continue
        for key, rx in TABLE_ROWS.items():
            if not rx.match(line):
                continue
            label_end = rx.match(line).end()
            nums = _numbers_in(line[label_end:])
            if len(nums) < 2:
                continue
            is_pct = key.endswith("margin")
            if is_pct != all(p for _, p in nums) and is_pct:
                continue
            if not is_pct and any(p for _, p in nums):
                continue
            nums = nums[-len(header):]
            cols = header[-len(nums):]
            vals = {}
            for (y, suffix), (v, _) in zip(cols, nums):
                vals[y] = {"value": v if is_pct else to_millions(v, None, doc.default_unit),
                           "projected": suffix in ("E", "P", "F", "B")}
            if key not in series or len(vals) > len(series[key]["values"]):
                series[key] = {"values": vals, "page": page, "line": line}
    return series


def _latest_actual(values):
    actual = [y for y, v in values.items() if not v["projected"] and y <= date.today().year]
    if actual:
        return max(actual)
    return min(values) if values else None


def detect_financials(doc, facts):
    tables = detect_financial_tables(doc)
    currency = Counter()
    for m in MONEY_RE.finditer(doc.full[:300000]):
        currency[CURRENCY_CODES.get(m.group("cur").upper(), CURRENCY_CODES.get(m.group("cur"), "USD"))] += 1
    cur = currency.most_common(1)[0][0] if currency else "USD"

    for key, label in (("revenue", "Revenue"), ("ebitda", "EBITDA")):
        candidates = []
        if key in tables:
            t = tables[key]
            y = _latest_actual(t["values"])
            if y is not None:
                candidates.append({"value": t["values"][y]["value"], "year": y, "page": t["page"],
                                   "snippet": t["line"], "conf": 0.85, "currency": cur})
        mentions = detect_metric_mentions(doc, key)
        actual = [m for m in mentions if not m["projected"]]
        pool = actual or mentions
        if pool:
            years = [m for m in pool if isinstance(m["year"], int)]
            ltm = [m for m in pool if m["year"] == "LTM"]
            pick = ltm[0] if ltm else (max(years, key=lambda m: m["year"]) if years else pool[0])
            agree = sum(1 for m in mentions if abs(m["value"] - pick["value"]) < 0.01 * max(pick["value"], 1))
            candidates.append({"value": pick["value"], "year": pick["year"], "page": pick["page"],
                               "snippet": pick["snippet"], "conf": 0.6 + 0.08 * agree + (0.05 if actual else 0),
                               "currency": pick["currency"]})
        if not candidates:
            continue
        best = max(candidates, key=lambda c: c["conf"])
        yr = f" ({'FY' if isinstance(best['year'], int) else ''}{best['year']})" if best["year"] else ""
        facts.append(_fact(key, label + yr, round(best["value"], 2),
                           fmt_money(best["value"], best["currency"]),
                           best["page"], best["snippet"], best["conf"],
                           currency=best["currency"], year=best["year"]))

    # Series (for charts) and derived metrics.
    out_series = {}
    for key in ("revenue", "ebitda", "ebitda_margin", "gross_margin"):
        if key in tables:
            out_series[key] = {str(y): v for y, v in sorted(tables[key]["values"].items())}
    rev = tables.get("revenue")
    if rev:
        act = sorted(y for y, v in rev["values"].items() if not v["projected"])
        if len(act) >= 2 and rev["values"][act[0]]["value"] > 0:
            n = act[-1] - act[0]
            cagr = (rev["values"][act[-1]]["value"] / rev["values"][act[0]]["value"]) ** (1 / n) - 1
            facts.append(_fact("revenue_cagr", f"Revenue CAGR {act[0]}–{act[-1]}", round(cagr * 100, 1),
                               f"{cagr * 100:.1f}%", rev["page"], rev["line"], 0.8))
    rev_f = next((f for f in facts if f["key"] == "revenue"), None)
    ebitda_f = next((f for f in facts if f["key"] == "ebitda"), None)
    if rev_f and ebitda_f and rev_f.get("year") == ebitda_f.get("year") and rev_f["value"]:
        margin = ebitda_f["value"] / rev_f["value"] * 100
        if 0 < margin < 100:
            facts.append(_fact("ebitda_margin_calc", "EBITDA margin (calculated)", round(margin, 1),
                               f"{margin:.1f}%", ebitda_f["page"], None, min(rev_f["confidence"], ebitda_f["confidence"])))
    return out_series, cur


PCT_PATTERNS = [
    ("ebitda_margin", "EBITDA margin", [
        r"EBITDA\s+margins?\s+(?:of|was|were|is|at|reached|exceeding|above)?\s*(?:approximately\s+|~|over\s+|c\.\s*)?(\d{1,2}(?:\.\d+)?)\s?%",
        r"(\d{1,2}(?:\.\d+)?)\s?%\s+(?:adj(?:usted|\.)?\s+)?EBITDA\s+margin",
    ]),
    ("gross_margin", "Gross margin", [
        r"gross\s+margins?\s+(?:of|was|were|is|at|exceeding|above)?\s*(?:approximately\s+|~|over\s+)?(\d{1,2}(?:\.\d+)?)\s?%",
        r"(\d{1,2}(?:\.\d+)?)\s?%\s+gross\s+margin",
    ]),
    ("cagr", "Growth (CAGR)", [
        r"(\d{1,3}(?:\.\d+)?)\s?%\s+(?:revenue\s+|organic\s+|historical\s+)?CAGR",
        r"CAGR\s+(?:of\s+)?(?:approximately\s+|~)?(\d{1,3}(?:\.\d+)?)\s?%",
        r"(?:revenue|sales)\s+(?:has\s+)?grown\s+(?:at\s+)?(?:approximately\s+|~)?(\d{1,3}(?:\.\d+)?)\s?%",
    ]),
    ("recurring_revenue", "Recurring revenue", [
        r"(\d{1,3}(?:\.\d+)?)\s?%\s+(?:of\s+(?:total\s+|net\s+)?(?:revenues?|sales)\s+)?(?:is\s+|are\s+|was\s+)?(?:recurring|subscription|contracted|repeat)",
        r"(?:recurring|subscription|contracted)\s+revenues?\s+(?:represents?|accounts?\s+for|comprises?|of)\s+(?:approximately\s+|~|over\s+)?(\d{1,3}(?:\.\d+)?)\s?%",
    ]),
    ("net_retention", "Net revenue retention", [
        r"net\s+(?:revenue|dollar)\s+retention\s+(?:rate\s+)?(?:of\s+|was\s+|is\s+)?(?:approximately\s+|~|over\s+)?(\d{2,3}(?:\.\d+)?)\s?%",
        r"(\d{2,3}(?:\.\d+)?)\s?%\s+net\s+(?:revenue|dollar)\s+retention",
    ]),
    ("gross_retention", "Gross retention", [
        r"gross\s+(?:revenue|dollar|customer|logo)?\s*retention\s+(?:rate\s+)?(?:of\s+|was\s+|is\s+)?(?:approximately\s+|~|over\s+)?(\d{2,3}(?:\.\d+)?)\s?%",
        r"(\d{2,3}(?:\.\d+)?)\s?%\s+(?:gross\s+|customer\s+)retention",
    ]),
]


def detect_percentages(doc, facts):
    for key, label, pats in PCT_PATTERNS:
        hits = []
        for page, s in doc.sentences:
            for p in pats:
                m = re.search(p, s, re.I)
                if m:
                    v = float(m.group(1))
                    if 0 < v <= 200:
                        hits.append((page, s, v))
                    break
        if hits:
            c = Counter(round(h[2], 1) for h in hits)
            v, n = c.most_common(1)[0]
            page, s, _ = next(h for h in hits if round(h[2], 1) == v)
            facts.append(_fact(key, label, v, f"{v:g}%", page, s, 0.6 + 0.1 * n))


def _first(doc, patterns, flags=re.I):
    for page, s in doc.sentences:
        for p in patterns:
            m = re.search(p, s, flags)
            if m:
                return page, s, m
    return None


def detect_profile(doc, facts):
    # Founded year
    r = _first(doc, [r"(?:founded|established|incorporated|formed|started)\s+(?:in\s+)?(?:\w+\s+){0,3}?(?:in\s+)?((?:18|19|20)\d{2})"])
    if r:
        page, s, m = r
        y = int(m.group(1))
        if 1800 <= y <= date.today().year:
            facts.append(_fact("founded_year", "Founded", y, str(y), page, s, 0.85))

    # Headquarters
    hq_pats = [
        r"(?:headquartered|head-quartered|based|HQ'?d?)\s+(?:in|out\s+of)\s+((?:[A-Z][a-zA-Z.\-]+\s?){1,3}(?:,\s*(?:[A-Z][a-zA-Z.\-]+\s?){1,3})?)",
        r"headquarters\s+(?:is\s+|are\s+)?(?:located\s+)?in\s+((?:[A-Z][a-zA-Z.\-]+\s?){1,3}(?:,\s*(?:[A-Z][a-zA-Z.\-]+\s?){1,3})?)",
    ]
    r = _first(doc, hq_pats, 0)
    if r:
        page, s, m = r
        loc = m.group(1).strip().rstrip(",. ")
        loc = re.sub(r"\s+(?:and|with|the|is|it|which|since)$", "", loc)
        city, country = loc, None
        parts = [p.strip() for p in loc.split(",")]
        if len(parts) >= 2:
            city = parts[0]
            country = canonical_country(parts[-1])
        else:
            country = canonical_country(parts[0])
            if country:
                city = None
        facts.append(_fact("hq", "Headquarters", {"city": city, "country": country}, loc, page, s, 0.8))
        if country:
            facts.append(_fact("country", "HQ country", country, country, page, s, 0.8))
            facts.append(_fact("region", "Region", region_for(country), region_for(country), page, s, 0.8))

    # Employees
    r = _first(doc, [
        r"(?:approximately|approx\.?|~|over|more\s+than|nearly|c\.|circa|some)?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\+?\s+(?:full[- ]time\s+|dedicated\s+|skilled\s+)?(?:employees|FTEs|staff|team\s+members|people|professionals|associates|workers)",
        r"(?:employs|workforce\s+of|headcount\s+of|team\s+of)\s+(?:approximately\s+|over\s+|~)?(\d{1,3}(?:,\d{3})+|\d{2,6})",
    ])
    if r:
        page, s, m = r
        n = int(m.group(1).replace(",", ""))
        if 5 <= n <= 2_000_000 and not (1900 <= n <= 2100 and "," not in m.group(1)):
            facts.append(_fact("employees", "Employees", n, f"{n:,}", page, s, 0.75))

    # Customers
    r = _first(doc, [r"(?:over|more\s+than|approximately|~|nearly)?\s*(\d{1,3}(?:,\d{3})+|\d{2,7})\+?\s+(?:active\s+|blue[- ]chip\s+|enterprise\s+|B2B\s+)?(?:customers|clients|accounts|users|subscribers)"])
    if r:
        page, s, m = r
        n = int(m.group(1).replace(",", ""))
        if not (1900 <= n <= 2100):
            facts.append(_fact("customers", "Customers", n, f"{n:,}+", page, s, 0.7))

    # Customer concentration
    r = _first(doc, [
        r"top\s+(\d+|one|two|three|five|ten|twenty)\s+customers?\s+(?:accounted\s+for|account\s+for|represented?|represents?|comprised?|made\s+up|generated?)\s+(?:only\s+|approximately\s+|~|less\s+than\s+|under\s+)?(\d{1,3}(?:\.\d+)?)\s?%",
        r"(?:largest|single\s+largest)\s+customer\s+(?:accounted\s+for|accounts\s+for|represents?|represented)\s+(?:only\s+|approximately\s+|~|less\s+than\s+)?(\d{1,3}(?:\.\d+)?)\s?%",
    ])
    if r:
        page, s, m = r
        if m.lastindex == 2:
            k = m.group(1)
            k = WORD_NUMS.get(k.lower(), k)
            facts.append(_fact("concentration", f"Top {k} customers", float(m.group(2)), f"{m.group(2)}% of revenue", page, s, 0.8))
        else:
            facts.append(_fact("concentration", "Largest customer", float(m.group(1)), f"{m.group(1)}% of revenue", page, s, 0.8))

    # Footprint
    r = _first(doc, [r"(?:operations|presence|customers|offices|operates)\s+(?:in|across)\s+(?:over\s+|more\s+than\s+)?(\d{1,3})\+?\s+countries"])
    if r:
        page, s, m = r
        facts.append(_fact("countries_count", "Countries of operation", int(m.group(1)), f"{m.group(1)} countries", page, s, 0.75))
    r = _first(doc, [r"(\d{1,4})\s+(?:manufacturing\s+|production\s+|distribution\s+|service\s+|retail\s+)?(?:facilities|locations|sites|plants|branches|clinics|stores|warehouses|offices)"])
    if r:
        page, s, m = r
        facts.append(_fact("locations", "Locations / sites", int(m.group(1)), _clean(m.group(0)), page, s, 0.65))

    # CEO
    name = r"((?:[A-Z][a-z]+|[A-Z]\.)(?:\s+(?:[A-Z][a-z'\-]+|[A-Z]\.)){1,2})"
    r = _first(doc, [
        name + r",?\s+(?:the\s+)?(?:Company'?s\s+)?(?:Founder\s+(?:and|&)\s+)?(?:Chief\s+Executive\s+Officer|CEO)\b",
        r"(?:Chief\s+Executive\s+Officer|CEO)(?:\s+and\s+Founder)?,?\s+" + name,
    ], 0)
    if r:
        page, s, m = r
        nm = m.group(1).strip()
        if nm.split()[0] not in {"The", "Our", "Company", "Its", "Management", "Group", "Former"}:
            facts.append(_fact("ceo", "CEO", nm, nm, page, s, 0.7))

    # Ownership
    r = _first(doc, [
        r"((?:founder|family|management|privately|employee|sponsor|PE)[- ](?:owned|held|led))",
        r"(?:owned|backed|held)\s+by\s+((?:[A-Z][\w&.\-]+\s?){1,5})",
        r"portfolio\s+company\s+of\s+((?:[A-Z][\w&.\-]+\s?){1,5})",
    ], re.I)
    if r:
        page, s, m = r
        own = m.group(1).strip()
        facts.append(_fact("ownership", "Ownership", own, own, page, s, 0.6))

    # Advisor
    r = _first(doc, [
        r"((?:[A-Z][\w&.\-]*\s?){1,5})\s*(?:\([^)]*\)\s*)?(?:has|have)\s+been\s+(?:exclusively\s+)?(?:retained|engaged|appointed|mandated)",
        r"(?:exclusive\s+)?(?:financial\s+)?advis[oe]r\s+(?:to\s+the\s+(?:Company|Seller|Shareholders)\s*)?(?:is\s+)?,?\s*((?:[A-Z][\w&.\-]*\s?){1,5})",
    ], 0)
    if r:
        page, s, m = r
        adv = m.group(1).strip()
        if adv.lower() not in {"the company", "company", "we", "the", "management"} and len(adv) > 2:
            facts.append(_fact("advisor", "Sell-side advisor", adv, adv, page, s, 0.65))

    # Transaction
    r = _first(doc, [
        r"(majority|minority|controlling|100%|full|significant\s+minority)\s+(?:equity\s+)?(?:stake|interest|investment|recapitali[sz]ation|sale|ownership|position)",
        r"(carve[- ]out|recapitali[sz]ation|take[- ]private|management\s+buy[- ]?out|growth\s+(?:equity\s+)?investment)",
    ])
    if r:
        page, s, m = r
        t = m.group(0)
        dtype = ("Minority" if "minority" in t.lower() else
                 "Carve-out" if "carve" in t.lower() else
                 "Recap" if "recap" in t.lower() else
                 "Take-private" if "private" in t.lower() else
                 "Growth Equity" if "growth" in t.lower() else "Buyout")
        facts.append(_fact("deal_type", "Transaction type", dtype, f"{dtype} — “{_clean(t)}”", page, s, 0.6))

    # Process deadline
    r = _first(doc, [
        r"(?:indications?\s+of\s+interest|IOIs?|first[- ]round\s+(?:bids|offers|proposals)|non[- ]binding\s+(?:offers|bids|proposals|indications)|final\s+bids|LOIs?)[^.]{0,60}?(?:due|submitted|received)\s+(?:on\s+|by\s+|no\s+later\s+than\s+)?(?:\w+day,?\s+)?([A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})",
    ], re.I)
    if r:
        page, s, m = r
        facts.append(_fact("bid_deadline", "Bid deadline", m.group(1), m.group(1), page, s, 0.75))

    # Website
    m = re.search(r"\b((?:https?://)?www\.[a-z0-9\-]+(?:\.[a-z0-9\-]+)+)\b", doc.full, re.I)
    if m:
        page = next((i for i, p in enumerate(doc.pages, 1) if m.group(1) in p), None)
        facts.append(_fact("website", "Website", m.group(1).lower(), m.group(1).lower(), page, None, 0.7))


def detect_identity(doc, facts, filename):
    code = Counter(re.findall(r"\bProject[ ]+([A-Z][a-z]{2,}(?:[ ][A-Z][a-z]+)?)\b", doc.full))
    if code:
        c, n = code.most_common(1)[0]
        page = next((i for i, p in enumerate(doc.pages, 1) if f"Project {c}" in p), 1)
        facts.append(_fact("codename", "Project codename", f"Project {c}", f"Project {c}", page, None, 0.6 + 0.05 * min(n, 6)))

    name = None
    r = _first(doc, [r"((?:[A-Z][A-Za-z0-9&.'\-]*,?\s?){1,6})\s*\(\s*(?:the\s+|“|\"|”)*(?:Company|Business|Target|Group)(?:”|\"|“)*\s*\)"], 0)
    if r:
        page, s, m = r
        name = m.group(1).strip()
        name = re.sub(r"^(?:The|This|About|Overview|Introduction|Summary)\s+", "", name)
        if name and name not in {"The", "Company"}:
            facts.append(_fact("name", "Company name", name, name, page, s, 0.8))

    desc_rx = re.compile(
        r"\bis\s+(?:a|an|the)\s+(?:[\w\-,]+\s+){0,6}?(?:leading|premier|provider|manufacturer|developer|distributor|platform|operator|producer|supplier|designer|marketer|company|business|specialist|leader|services?\s+firm)",
        re.I,
    )
    for page, s in doc.sentences:
        if desc_rx.search(s) and 40 < len(s) < 600 and not re.search(r"\b(?:we|you|this\s+memorandum)\b", s[:40], re.I):
            facts.append(_fact("description", "Business description", _clean(s), _snip(s, 220), page, s, 0.7))
            if not name:
                m = re.match(r"^((?:[A-Z][A-Za-z0-9&.'\-]*\s?){1,5}?)\s*(?:\([^)]*\)\s*)?(?:,\s*[^,]+,\s*)?is\s+(?:a|an|the)\b", s)
                if m and m.group(1).strip() not in {"The Company", "It", "This", "The"}:
                    name = m.group(1).strip()
                    facts.append(_fact("name", "Company name", name, name, page, s, 0.65))
            break

    if not name:
        stem = os.path.splitext(os.path.basename(filename))[0]
        stem = re.sub(r"(?i)[_\-\s]*(cim|confidential|information|memorandum|teaser|im|final|draft|v\d+)\b", " ", stem)
        stem = _clean(re.sub(r"[_\-]+", " ", stem))
        if stem:
            facts.append(_fact("name", "Company name (from filename)", stem.title(), stem.title(), None, None, 0.35))


SECTOR_KEYWORDS = {
    "Software & Tech": ["software", "saas", "cloud", "platform", "subscription", "arr", "api", "data analytics",
                        "cybersecurity", "it services", "digital", "machine learning", "artificial intelligence"],
    "Healthcare": ["healthcare", "patient", "clinical", "medical", "physician", "hospital", "pharma", "dental",
                   "therapy", "diagnostic", "clinic", "reimbursement", "medicare", "life sciences"],
    "Industrials": ["manufacturing", "industrial", "engineered", "components", "machinery", "fabrication",
                    "aerospace", "defense", "oem", "plant", "precision", "equipment"],
    "Business Services": ["outsourc", "staffing", "consulting", "facility services", "b2b services", "testing, inspection",
                          "compliance services", "professional services", "marketing services", "payroll"],
    "Consumer & Retail": ["consumer", "retail", "brand", "e-commerce", "ecommerce", "dtc", "direct-to-consumer",
                          "store", "apparel", "beauty", "restaurant", "franchise"],
    "Financial Services": ["insurance", "banking", "lending", "payments", "wealth management", "asset management",
                           "fintech", "brokerage", "credit", "underwriting"],
    "Energy & Infrastructure": ["energy", "renewable", "solar", "wind", "utility", "oil", "gas", "infrastructure",
                                "power", "grid", "battery"],
    "Education": ["education", "students", "school", "learning", "curriculum", "edtech", "university", "training"],
    "Media & Telecom": ["media", "telecom", "broadband", "content", "advertising", "fiber", "wireless", "publishing"],
    "Transportation & Logistics": ["logistics", "freight", "trucking", "transportation", "supply chain", "fleet",
                                   "warehouse", "3pl", "shipping", "last-mile"],
    "Food & Agriculture": ["food", "beverage", "agricultur", "ingredients", "farm", "snack", "protein", "bakery"],
    "Real Estate": ["real estate", "property", "properties", "reit", "leasing", "tenants", "square feet"],
}


def detect_sector(doc, facts, sectors):
    text = doc.full.lower()
    scores = {}
    for sector, kws in SECTOR_KEYWORDS.items():
        if sectors and sector not in sectors:
            continue
        scores[sector] = sum(len(re.findall(r"\b" + re.escape(k), text)) for k in kws)
    total = sum(scores.values())
    if not total:
        return []
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top, n = ranked[0]
    share = n / total
    facts.append(_fact("sector", "Sector", top, f"{top} ({share:.0%} of sector signals)", None, None, 0.4 + 0.5 * share))
    return [{"sector": s, "score": round(v / total, 3)} for s, v in ranked if v]


def detect_geographies(doc):
    counts = Counter()
    names = list(COUNTRY_TO_REGION) + [a for a in ALIASES if len(a) > 3] + list(US_STATES) + CA_PROVINCES
    for n in names:
        hits = len(re.findall(r"(?<![A-Za-z])" + re.escape(n) + r"(?![A-Za-z])", doc.full))
        if hits:
            counts[canonical_country(n)] += hits
    for short in ("U.S.", "USA", "UK", "U.K.", "UAE"):
        hits = len(re.findall(r"(?<![A-Za-z.])" + re.escape(short) + r"(?![A-Za-z])", doc.full))
        if hits:
            counts[canonical_country(short)] += hits
    return [{"country": c, "region": region_for(c), "mentions": n} for c, n in counts.most_common(12) if c]


HEADING_HIGHLIGHTS = re.compile(r"^(?:\d+[.)]?\s*)?(?:key\s+)?(?:investment\s+(?:highlights|considerations|merits|thesis)|why\s+invest|key\s+highlights|key\s+strengths)\b", re.I)
HEADING_RISKS = re.compile(r"^(?:\d+[.)]?\s*)?(?:key\s+)?(?:risk\s+factors|risks|key\s+risks|risks\s+(?:and|&)\s+mitigants)\b", re.I)


BULLET_RX = re.compile(r"^\s*(?:[•▪●■◦\-–—*✓➢►]|\d+[.)])\s+")


def _looks_like_heading(txt):
    words = txt.split()
    if len(txt) > 50 or len(words) > 7:
        return False
    long_words = [w for w in words if len(w) > 3]
    return bool(long_words) and all(w[0].isupper() or not w[0].isalpha() for w in long_words)


def _section_items(doc, heading_rx, limit=8):
    """Bullets under a heading such as 'Key Investment Highlights' (bullets often lost in PDF text)."""
    for idx, (page, line) in enumerate(doc.lines):
        if not (heading_rx.match(line) and len(line) < 80):
            continue
        items = []
        for p2, ln in doc.lines[idx + 1:]:
            if p2 - page > 1 or len(items) >= limit:
                break
            is_bullet = bool(BULLET_RX.match(ln))
            txt = BULLET_RX.sub("", ln).strip()
            if not txt:
                continue
            if len(txt) < 70 and re.search(r"confidential|^page\s+\d+$|^\d+$", txt, re.I):
                continue  # running header / footer
            if HEADING_HIGHLIGHTS.match(txt) or HEADING_RISKS.match(txt) or re.match(r"^\d+\.\s+[A-Z]", ln):
                break
            if not is_bullet and _looks_like_heading(txt):
                break
            prev = items[-1]["text"] if items else ""
            continuation = items and not is_bullet and (txt[0].islower() or re.search(r"(?:,|;|\b(?:and|or|of|the|to|in|for|with|a|an))$", prev))
            if continuation:
                items[-1]["text"] = _clean(prev + " " + txt)
            elif len(txt) > 12:
                items.append({"text": txt, "page": p2})
        if items:
            for it in items:
                it["text"] = _snip(it["text"], 260)
            return items
    return []


def analyze_pages(pages, filename="", sectors=None):
    doc = Doc(pages)
    facts = []
    detect_identity(doc, facts, filename)
    series, currency = detect_financials(doc, facts)
    detect_percentages(doc, facts)
    detect_profile(doc, facts)
    sector_scores = detect_sector(doc, facts, sectors)
    geos = detect_geographies(doc)
    if not any(f["key"] == "country" for f in facts) and geos:
        g = geos[0]
        facts.append(_fact("country", "Main country (most mentioned)", g["country"], g["country"], None, None, 0.45))
        if g["region"]:
            facts.append(_fact("region", "Region", g["region"], g["region"], None, None, 0.45))
    words = len(doc.full.split())
    return {
        "engine": "rules",
        "facts": facts,
        "series": series,
        "currency": currency,
        "highlights": _section_items(doc, HEADING_HIGHLIGHTS),
        "risks": _section_items(doc, HEADING_RISKS),
        "geographies": geos,
        "sector_scores": sector_scores,
        "stats": {"pages": len(pages), "words": words},
    }


# Map detected fact keys -> company columns (with value transforms).
FACT_TO_FIELD = {
    "name": "name", "codename": "codename", "description": "description", "founded_year": "founded_year",
    "employees": "employees", "country": "country", "region": "region", "sector": "sector",
    "website": "website", "ownership": "ownership", "advisor": "advisor", "deal_type": "deal_type",
    "revenue": "revenue", "ebitda": "ebitda",
}


def fact_updates(facts):
    """Build a company-field update dict from a list of accepted facts."""
    upd = {}
    for f in facts:
        k = f.get("key")
        if k == "hq" and isinstance(f.get("value"), dict):
            if f["value"].get("city"):
                upd["hq_city"] = f["value"]["city"]
            if f["value"].get("country"):
                upd.setdefault("country", f["value"]["country"])
        elif k in FACT_TO_FIELD:
            upd[FACT_TO_FIELD[k]] = f.get("value")
            if k == "revenue" and f.get("currency"):
                upd["currency"] = f["currency"]
    if upd.get("country") and not upd.get("region"):
        upd["region"] = region_for(upd["country"])
    return upd
