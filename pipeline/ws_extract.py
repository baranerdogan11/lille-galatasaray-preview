"""
Pull the embedded Opta match-centre JSON out of saved WhoScored match
pages (firecrawl rawHtml results) into pipeline/raw/ws/{matchId}.json.

    python pipeline/ws_extract.py <dir-or-file> [...]
Scans every file given (or every file in a directory), skips files that
hold no matchCentreData, and never overwrites an existing match file.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "raw" / "ws"


def extract(path):
    try:
        raw = path.read_text(errors="ignore")
    except Exception:
        return None
    if "matchCentreData" not in raw:
        return None
    try:
        html = json.loads(raw).get("rawHtml", raw)
    except Exception:
        html = raw
    mid = re.search(r"matchId:\s*(\d+)", html)
    m = re.search(r"matchCentreData:\s*(\{.*?\}),\s*\n\s*matchCentreEventTypeJson", html, re.S)
    if not (mid and m):
        return None
    match_id = mid.group(1)
    dest = OUT / f"{match_id}.json"
    if dest.exists():
        return match_id, "exists"
    data = json.loads(m.group(1))
    data["matchId"] = int(match_id)
    dest.write_text(json.dumps(data))
    return match_id, f"{data['home']['name']} {data['score']} {data['away']['name']} · {len(data['events'])} events"


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.iterdir()) if p.is_dir() else [p]
    for f in files:
        r = extract(f)
        if r:
            print(r[0], r[1])


if __name__ == "__main__":
    main(sys.argv[1:])
