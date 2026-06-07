#!/usr/bin/env python3
"""
Auto-sync: reads Google Sheet using existing Chrome cookies.
No OAuth needed — uses your @chotot.vn Chrome session.

Schedule (runs every 30 min):
  crontab -e
  */30 * * * * /usr/local/bin/python3 ~/Desktop/mkt-dashboard/scripts/sync_sheet.py >> ~/Desktop/mkt-dashboard/scripts/sync.log 2>&1

ONE-TIME setup:
  pip3 install browser_cookie3 requests
  python3 ~/Desktop/mkt-dashboard/scripts/sync_sheet.py   # macOS asks Keychain permission once
"""

import sys, os, json, csv, io, re
from datetime import datetime

try:
    import browser_cookie3
    import requests
except ImportError:
    print("ERROR: run: pip3 install browser_cookie3 requests")
    sys.exit(1)

# ── Config ─────────────────────────────────────────────
SHEET_ID  = "1D-2eQcfDMzy42wHUF4bpwCY4cWtrJNvp-kdv9R_iFUI"
OUT_FILE  = os.path.expanduser("~/Desktop/mkt-dashboard/public/data.json")
LOG       = os.path.expanduser("~/Desktop/mkt-dashboard/scripts/sync.log")

# We fetch all sheets via gviz which returns tab list & data
TABS_URL  = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
CSV_BASE  = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

def pn(v):
    """Parse number from string."""
    if not v or str(v).strip() in ("", "-", "—"): return 0.0
    try: return float(str(v).replace(",","").replace("%","").replace("₫","").strip())
    except: return 0.0

def get_session():
    try:
        cj = browser_cookie3.chrome(domain_name=".google.com")
        s  = requests.Session()
        for c in cj: s.cookies.set(c.name, c.value, domain=c.domain)
        return s
    except Exception as e:
        raise RuntimeError(f"Chrome cookie error: {e}\nMake sure Chrome is open and logged into @chotot.vn")

def fetch_gid(session, gid):
    url  = f"{CSV_BASE}&gid={gid}"
    resp = session.get(url, allow_redirects=True, timeout=20)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code} for gid={gid}")
    if resp.text.strip().startswith("<!"):
        raise RuntimeError("Got HTML (login page) — open Chrome and log into @chotot.vn")
    return resp.text

def get_sheet_gids(session):
    """Discover tab GIDs from spreadsheet HTML."""
    resp = session.get(TABS_URL, timeout=20)
    gids = {}
    # Look for tab name → gid mapping in the HTML
    matches = re.findall(r'"([^"]+)","[^"]*",(\d+)', resp.text)
    for name, gid in matches:
        ln = name.lower()
        if "fc" in ln and "actual" in ln: gids["cost"]  = gid
        if "mtm" in ln:                   gids["mtm"]   = gid
    # Fallback: use the known GID from URL
    if "cost" not in gids: gids["cost"] = "2034915922"
    return gids

def parse_cost_csv(text):
    """Parse FC & Actual cost sheet → spend per vertical per month."""
    reader = csv.reader(io.StringIO(text))
    rows   = list(reader)
    if not rows: return {}

    # Find header row (contains "Jan" / month names)
    hdr_idx = 0
    col_jan  = None
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            if cell.strip().lower().startswith("jan"):
                hdr_idx = i; col_jan = j; break
        if col_jan is not None: break

    if col_jan is None: return {}

    # Build monthly spend per vertical
    spend = {}  # {vert: [m1..m12]}
    VERTS = {"PTY","JOB","VEH","GDS","PARENT"}
    for row in rows[hdr_idx+1:]:
        if len(row) < col_jan + 12: continue
        vert = str(row[0]).strip().upper()
        if vert not in VERTS: continue
        if vert not in spend: spend[vert] = [0.0]*12
        for mi in range(12):
            val = pn(row[col_jan + mi])
            # Convert raw VND to M VND
            if val > 100_000: val /= 1_000_000
            spend[vert][mi] += val

    return spend

def parse_mtm_csv(text):
    """Parse MTM metric sheet → brand/growth/seo metrics per vertical."""
    reader = csv.reader(io.StringIO(text))
    rows   = list(reader)

    # Find header row
    hdr_idx = 0
    col_jan  = None
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            if cell.strip().lower().startswith("jan"):
                hdr_idx = i; col_jan = j; break
        if col_jan is not None: break

    if col_jan is None: return {}

    metrics = {}  # {(vert, team, metric): [jan..may]}
    for row in rows[hdr_idx+1:]:
        if len(row) < 4: continue
        metric = str(row[0]).strip()
        team   = str(row[1]).strip()
        vert   = str(row[2]).strip().upper()
        vals   = []
        for mi in range(12):
            idx = col_jan + mi
            vals.append(pn(row[idx]) if idx < len(row) else 0.0)
        if metric and vert:
            metrics[(vert, team, metric)] = vals

    return metrics

def build_output(spend, mtm):
    """Build structured output for dashboard."""
    VERTS = ["PTY","JOB","VEH","GDS"]
    ACT   = 5  # Jan-May have actuals

    def m_get(vert, team, metric):
        key = (vert, team, metric)
        vals = mtm.get(key, mtm.get((vert, team.capitalize(), metric), []))
        return [v for v in vals[:ACT] if v is not None]

    out = {
        "timestamp": datetime.now().isoformat(),
        "spend": {v: (spend.get(v, [0]*12))[:12] for v in VERTS + ["PARENT"]},
        "OG": {},
        "OS": {},
        "OB": {},
        "OA": {
            "inst": m_get("ALL","Growth","New app install"),
            "act":  m_get("ALL","Growth","Activated user"),
        },
        "MTM": {},  # full vertical metrics
    }

    for v in VERTS:
        out["OG"][v] = {
            "DAU":  m_get(v,"Growth","DAU"),
            "DwL":  m_get(v,"Growth","DwL"),
            "Lead": m_get(v,"Growth","Lead"),
        }
        out["OS"][v] = {
            "DAU":  m_get(v,"SEO","DAU"),
            "DwL":  m_get(v,"SEO","DwL"),
            "Lead": m_get(v,"SEO","Lead"),
        }
        out["OB"][v] = {
            "fol":  m_get(v,"Brand","Followers uplift"),
            "int":  m_get(v,"Brand","Social Interactions"),
            "reach":m_get(v,"Brand","Social Reach"),
            "bclk": m_get(v,"Brand","Brand keyword click"),
        }
        # Full vertical metrics for P&L
        out["MTM"][v] = {
            "Revenue":    m_get(v,"","Revenue"),
            "MAU":        m_get(v,"","MAU"),
            "DAU":        m_get(v,"","DAUs"),
            "Lead":       m_get(v,"","Total lead volume"),
            "MwL":        m_get(v,"","MAU w Lead"),
        }

    # All-vertical
    out["MTM"]["ALL"] = {
        "Revenue": m_get("All","","Revenue"),
        "MAU":     m_get("All","","MAU"),
        "DAU":     m_get("All","","DAUs"),
        "Lead":    m_get("All","","Total lead volume"),
        "MwL":     m_get("All","","MAU w Lead"),
    }

    return out

def main():
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Syncing sheet {SHEET_ID}…", flush=True)
    session = get_session()
    gids    = get_sheet_gids(session)
    print(f"  Tabs found: {gids}", flush=True)

    cost_text = fetch_gid(session, gids.get("cost","2034915922"))
    print(f"  Cost sheet: {len(cost_text)} chars", flush=True)

    mtm_text  = fetch_gid(session, gids.get("mtm","0"))
    print(f"  MTM sheet:  {len(mtm_text)} chars", flush=True)

    spend   = parse_cost_csv(cost_text)
    mtm     = parse_mtm_csv(mtm_text)
    output  = build_output(spend, mtm)

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"  ✅ Written to {OUT_FILE}", flush=True)

if __name__ == "__main__":
    main()
