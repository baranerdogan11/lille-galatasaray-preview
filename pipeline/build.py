"""
Turn the 19 saved Opta match-event files (pipeline/raw/ws/*.json, via
WhoScored) into one preview dataset: public/data/preview.json.

Per team (Lille, Galatasaray) and per filter (all / ucl / league):
  - style metrics (possession, PPDA, field tilt, directness, pressing,
    chance creation, defence) with a percentile against every team-match
    observed in these 19 games (38 team-performances)
  - passing network (nodes at average on-ball position, edges = completed
    passes between two players)
  - every shot for and against, with a simple distance/angle xG model
  - per-player season lines
  - per-match lines for the form strip

    python pipeline/build.py
"""
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw" / "ws"
OUT = ROOT / "public" / "data"

TEAMS = {
    607: {"code": "LIL", "name": "Lille", "full": "LOSC Lille", "color": "#C8102E", "secondary": "#1a1a1a",
          "league": "Ligue 1", "league_pos": 4, "league_pts": 14, "league_played": 7, "manager": "Davide Ancelotti",
          "ucl_pos": 33},
    294: {"code": "GAL", "name": "Galatasaray", "full": "Galatasaray SK", "color": "#B8860B", "secondary": "#A90432",
          "league": "Süper Lig", "league_pos": 1, "league_pts": 19, "league_played": 8, "manager": "Okan Buruk",
          "ucl_pos": 35},
}
UCL_IDS = {2029132, 2029155, 2029185, 2029208}
PITCH_L, PITCH_W = 105.0, 68.0  # metres; Opta x,y are 0-100 of each
MIN_EDGE = 8        # passes between two players to draw an edge (season, all comps)
MIN_MINUTES = 90    # minutes to appear in the network


# ── helpers ────────────────────────────────────────────────────────

def q(e, name):
    return any(qq["type"]["displayName"] == name for qq in e.get("qualifiers", []))


def qval(e, name):
    for qq in e.get("qualifiers", []):
        if qq["type"]["displayName"] == name:
            return qq.get("value")
    return None


def metres(x, y):
    return x / 100 * PITCH_L, y / 100 * PITCH_W


def dist_to_goal(x, y):
    mx, my = metres(x, y)
    return math.hypot(PITCH_L - mx, PITCH_W / 2 - my)


def goal_angle(x, y):
    mx, my = metres(x, y)
    dx = PITCH_L - mx
    a = math.atan2(my - (PITCH_W / 2 - 3.66), dx)
    b = math.atan2(my - (PITCH_W / 2 + 3.66), dx)
    return abs(a - b)


def xg_model(shot):
    """Simple logistic model on distance and angle. Calibrated so the summed
    xG over these 19 matches matches the goals actually scored (~0.10 per
    shot on average; six-yard box ~0.35, penalty spot ~0.19, 25 m ~0.01).
    Headers, big chances and counters adjust the odds. Not Opta's xG."""
    if q(shot, "Penalty"):
        return 0.76
    d = dist_to_goal(shot["x"], shot["y"])
    ang = goal_angle(shot["x"], shot["y"])
    logit = -0.595 - 0.146 * d + 0.571 * ang
    if q(shot, "Head"):
        logit += math.log(0.7)
    if q(shot, "BigChance"):
        logit += math.log(2.5)
    if q(shot, "FastBreak"):
        logit += math.log(1.3)
    return 1 / (1 + math.exp(-logit))


def short_name(name):
    parts = name.split()
    if len(parts) == 1:
        return name
    return f"{parts[0][0]}. {' '.join(parts[1:])}"


def shot_situation(e):
    if q(e, "Penalty"):
        return "penalty"
    if q(e, "FromCorner"):
        return "corner"
    if q(e, "SetPiece") or q(e, "DirectFreekick") or q(e, "FreekickTaken"):
        return "set piece"
    if q(e, "FastBreak"):
        return "counter"
    if q(e, "ThrowinSetPiece"):
        return "throw-in"
    return "open play"


def outcome(e):
    t = e["type"]["displayName"]
    if e.get("isGoal"):
        return "goal"
    return {"SavedShot": "saved", "MissedShots": "missed", "ShotOnPost": "post"}.get(t, "blocked")


# ── per-match analysis ─────────────────────────────────────────────

def sort_key(e):
    return (e.get("period", {}).get("value", 0), e.get("expandedMinute", e.get("minute", 0)),
            e.get("second", 0) or 0, e.get("eventId", 0))


def analyse_match(d):
    """Return {teamId: team-performance dict} for both teams in the match."""
    events = sorted(d["events"], key=sort_key)
    home_id, away_id = d["home"]["teamId"], d["away"]["teamId"]
    sides = {home_id: d["home"], away_id: d["away"]}
    opp = {home_id: away_id, away_id: home_id}
    names = d["playerIdNameDictionary"]

    # minutes from formation blocks
    minutes = defaultdict(lambda: defaultdict(float))
    for tid, side in sides.items():
        for f in side.get("formations", []):
            span = (f.get("endMinuteExpanded", 0) or 0) - (f.get("startMinuteExpanded", 0) or 0)
            ids = f.get("playerIds", [])
            slots = f.get("formationSlots", [])
            on = [pid for pid, s in zip(ids, slots) if s and s > 0] if slots else ids[:11]
            for pid in on:
                minutes[tid][pid] += span
    max_min = max((sum(v.values()) / 11 for v in minutes.values()), default=90) or 90

    perf = {}
    for tid in sides:
        perf[tid] = {
            "passes": 0, "passes_ok": 0, "forward_passes": 0, "pass_len": [], "long": 0, "crosses": 0,
            "prog": 0, "final3": 0, "box_entries": 0, "key": 0, "assists": 0,
            "shots": [], "touches_f3": 0, "touches": 0,
            "def_actions": [], "def_x": [], "pressing_actions": 0, "high_turnovers": 0,
            "aerials": 0, "aerials_won": 0, "dribbles": 0, "dribbles_ok": 0, "fouls": 0,
            "opp_passes_own60": 0, "corners": 0, "possession": sides[tid]["stats"].get("possession", {}),
            "edges": Counter(), "prog_edges": Counter(),
            "player": defaultdict(lambda: Counter()), "player_pos": defaultdict(list),
            "touch_grid": np.zeros((6, 5)), "def_grid": np.zeros((6, 5)), "pass_origin": defaultdict(list),
            "minutes": minutes[tid],
        }

    def grid_add(g, x, y):
        gx = min(5, int(x // (100 / 6)))
        gy = min(4, int(y // 20))
        g[gx, gy] += 1

    n = len(events)
    for i, e in enumerate(events):
        tid = e.get("teamId")
        if tid not in perf:
            continue
        p = perf[tid]
        t = e["type"]["displayName"]
        pid = e.get("playerId")
        x, y = e.get("x"), e.get("y")
        if e.get("isTouch") and pid and x is not None:
            p["touches"] += 1
            p["player"][pid]["touches"] += 1
            p["player_pos"][pid].append((x, y))
            grid_add(p["touch_grid"], x, y)
            if x >= 66.7:
                p["touches_f3"] += 1
        if t == "Pass":
            ok = e["outcomeType"]["value"] == 1
            p["passes"] += 1
            p["player"][pid]["passes"] += 1
            ex, ey = e.get("endX", x), e.get("endY", y)
            mx, my = metres(x, y); mex, mey = metres(ex, ey)
            length = math.hypot(mex - mx, mey - my)
            p["pass_len"].append(length)
            if ex > x + 1:
                p["forward_passes"] += 1
            if q(e, "Longball"):
                p["long"] += 1
            if q(e, "Cross"):
                p["crosses"] += 1
            if q(e, "KeyPass") or q(e, "ShotAssist"):
                p["key"] += 1
                p["player"][pid]["key_passes"] += 1
            if q(e, "IntentionalGoalAssist"):
                p["assists"] += 1
                p["player"][pid]["assists"] += 1
            if x < 60:
                # pass in the team's own 60% of the pitch → counts toward the
                # opponent's PPDA denominator
                perf[opp[tid]]["opp_passes_own60"] += 1
            if ok:
                p["passes_ok"] += 1
                p["player"][pid]["passes_ok"] += 1
                p["pass_origin"][pid].append((x, y))
                d_before = dist_to_goal(x, y); d_after = dist_to_goal(ex, ey)
                progressive = (d_before - d_after) >= 10 and ex >= 40
                if progressive:
                    p["prog"] += 1
                    p["player"][pid]["prog_passes"] += 1
                if ex >= 66.7 and x < 66.7:
                    p["final3"] += 1
                if ex >= 83 and 21.1 <= ey <= 78.9 and not (x >= 83 and 21.1 <= y <= 78.9):
                    p["box_entries"] += 1
                    p["player"][pid]["box_entries"] += 1
                # receiver: next event by the same team with a player on the ball
                for j in range(i + 1, min(n, i + 4)):
                    nxt = events[j]
                    if nxt.get("teamId") == tid and nxt.get("playerId") and nxt.get("isTouch"):
                        rid = nxt["playerId"]
                        if rid != pid:
                            p["edges"][(pid, rid)] += 1
                            if progressive:
                                p["prog_edges"][(pid, rid)] += 1
                            p["player"][rid]["received"] += 1
                        break
                    if nxt.get("teamId") != tid and nxt.get("isTouch"):
                        break
        elif e.get("isShot"):
            xg = xg_model(e)
            assisted_by = None
            rel = e.get("relatedPlayerId")
            if q(e, "Assisted") and rel:
                assisted_by = rel
            shot = {
                "x": x, "y": y, "minute": e.get("minute"), "player": pid,
                "name": short_name(names.get(str(pid), "?")), "outcome": outcome(e),
                "xg": round(xg, 3), "situation": shot_situation(e),
                "body": "head" if q(e, "Head") else ("left" if q(e, "LeftFoot") else ("right" if q(e, "RightFoot") else "other")),
                "big": q(e, "BigChance"), "assistedBy": assisted_by,
            }
            p["shots"].append(shot)
            p["player"][pid]["shots"] += 1
            p["player"][pid]["xg"] += xg
            if shot["outcome"] == "goal":
                p["player"][pid]["goals"] += 1
            if assisted_by:
                p["player"][assisted_by]["xa"] += xg
        elif t in ("Tackle", "Interception", "Clearance", "BlockedPass", "BallRecovery", "Challenge", "Foul"):
            if t == "Foul" and e["outcomeType"]["value"] == 1:
                pass  # foul won, not committed
            else:
                if t == "Foul":
                    p["fouls"] += 1
                p["def_actions"].append((t, x, y))
                if x is not None:
                    p["def_x"].append(x)
                    grid_add(p["def_grid"], x, y)
                    if t in ("Tackle", "Interception", "Challenge", "Foul") and x >= 40:
                        p["pressing_actions"] += 1
                    if t in ("BallRecovery", "Interception", "Tackle") and x >= 60:
                        p["high_turnovers"] += 1
                if t in ("Tackle", "Interception", "Clearance", "BlockedPass"):
                    p["player"][pid]["def_actions"] += 1
                if t == "BallRecovery":
                    p["player"][pid]["recoveries"] += 1
        elif t == "Aerial":
            p["aerials"] += 1
            if e["outcomeType"]["value"] == 1:
                p["aerials_won"] += 1
                p["player"][pid]["aerials_won"] += 1
        elif t == "TakeOn":
            p["dribbles"] += 1
            p["player"][pid]["dribbles"] += 1
            if e["outcomeType"]["value"] == 1:
                p["dribbles_ok"] += 1
                p["player"][pid]["dribbles_ok"] += 1
        elif t == "CornerAwarded" and e["outcomeType"]["value"] == 1:
            p["corners"] += 1

    # finalise per-team metrics for this match
    out = {}
    for tid, p in perf.items():
        o = opp[tid]
        po = perf[o]
        side = sides[tid]
        is_home = tid == home_id
        hs, as_ = [int(s) for s in d["score"].split(" : ")]
        gf, ga = (hs, as_) if is_home else (as_, hs)
        xg_for = sum(s["xg"] for s in p["shots"])
        xg_against = sum(s["xg"] for s in po["shots"])
        passes = max(1, p["passes"])
        opp_f3 = po["touches_f3"]
        # Possession as share of passes attempted (WhoScored's per-minute
        # possession dict is a count, not a percentage).
        poss_val = 100 * p["passes"] / max(1, p["passes"] + po["passes"])
        out[tid] = {
            "match": {
                "id": d["matchId"], "date": d["startDate"][:10], "comp": "UCL" if d["matchId"] in UCL_IDS else "League",
                "home": is_home, "opponent": sides[o]["name"], "opponentId": o,
                "gf": gf, "ga": ga, "result": "W" if gf > ga else ("D" if gf == ga else "L"),
                "xg": round(xg_for, 2), "xga": round(xg_against, 2),
                "possession": round(poss_val, 1) if poss_val is not None else None,
                "shots": len(p["shots"]), "shots_against": len(po["shots"]),
                "formation": side["formations"][0]["formationName"] if side.get("formations") else None,
                "venue": d.get("venueName"),
            },
            "metrics": {
                "possession": poss_val,
                "passes": p["passes"],
                "pass_accuracy": 100 * p["passes_ok"] / passes,
                "forward_share": 100 * p["forward_passes"] / passes,
                "long_share": 100 * p["long"] / passes,
                "avg_pass_len": float(np.mean(p["pass_len"])) if p["pass_len"] else 0,
                "prog_passes": p["prog"],
                "final3_entries": p["final3"],
                "box_entries": p["box_entries"],
                "crosses": p["crosses"],
                "key_passes": p["key"],
                "shots": len(p["shots"]),
                "shots_on_target": sum(1 for s in p["shots"] if s["outcome"] in ("goal", "saved")),
                "xg": xg_for,
                "xg_per_shot": xg_for / max(1, len(p["shots"])),
                "shot_dist": float(np.mean([dist_to_goal(s["x"], s["y"]) for s in p["shots"]])) if p["shots"] else 0,
                "big_chances": sum(1 for s in p["shots"] if s["big"]),
                "counter_shots": sum(1 for s in p["shots"] if s["situation"] == "counter"),
                "setpiece_shots": sum(1 for s in p["shots"] if s["situation"] in ("corner", "set piece", "throw-in")),
                "shots_against": len(po["shots"]),
                "xga": xg_against,
                "xga_per_shot": xg_against / max(1, len(po["shots"])),
                "ppda": po["passes"] and (p["opp_passes_own60"] / max(1, p["pressing_actions"])),
                "high_turnovers": p["high_turnovers"],
                "def_line": float(np.mean(p["def_x"])) if p["def_x"] else 0,
                "field_tilt": 100 * p["touches_f3"] / max(1, p["touches_f3"] + opp_f3),
                "aerial_win": 100 * p["aerials_won"] / max(1, p["aerials"]),
                "dribbles": p["dribbles"],
                "dribble_success": 100 * p["dribbles_ok"] / max(1, p["dribbles"]),
                "fouls": p["fouls"],
                "corners": p["corners"],
                "goals": gf, "goals_against": ga,
            },
            "raw": p,
            "names": names,
            "players_meta": {pl["playerId"]: pl for pl in side["players"]},
        }
    return out


# ── season aggregation ────────────────────────────────────────────

METRIC_DEFS = [
    # key, label, group, unit, higher-is-better (None = style, not quality), decimals
    ("possession", "Possession", "Ball", "%", None, 0),
    ("field_tilt", "Field tilt", "Ball", "%", True, 0),
    ("passes", "Passes per match", "Ball", "", None, 0),
    ("pass_accuracy", "Pass accuracy", "Ball", "%", True, 0),
    ("avg_pass_len", "Average pass length", "Style", "m", None, 1),
    ("long_share", "Long-ball share", "Style", "%", None, 0),
    ("forward_share", "Forward-pass share", "Style", "%", None, 0),
    ("prog_passes", "Progressive passes", "Progression", "", True, 1),
    ("final3_entries", "Final-third entries", "Progression", "", True, 1),
    ("box_entries", "Passes into the box", "Progression", "", True, 1),
    ("crosses", "Crosses", "Style", "", None, 1),
    ("dribbles", "Take-ons attempted", "Style", "", None, 1),
    ("shots", "Shots", "Attack", "", True, 1),
    ("xg", "xG (model)", "Attack", "", True, 2),
    ("xg_per_shot", "xG per shot", "Attack", "", True, 2),
    ("shot_dist", "Average shot distance", "Attack", "m", False, 1),
    ("big_chances", "Big chances", "Attack", "", True, 1),
    ("setpiece_shots", "Set-piece shots", "Attack", "", None, 1),
    ("counter_shots", "Counter-attack shots", "Style", "", None, 1),
    ("shots_against", "Shots conceded", "Defence", "", False, 1),
    ("xga", "xG conceded (model)", "Defence", "", False, 2),
    ("xga_per_shot", "xG per shot conceded", "Defence", "", False, 2),
    ("ppda", "PPDA (passes allowed per defensive action)", "Pressing", "", False, 1),
    ("high_turnovers", "High turnovers forced", "Pressing", "", True, 1),
    ("def_line", "Defensive-action height", "Pressing", "/100", None, 0),
    ("aerial_win", "Aerial duels won", "Defence", "%", True, 0),
    ("fouls", "Fouls committed", "Defence", "", None, 1),
]


def percentile(values, v):
    arr = np.array([x for x in values if x is not None], dtype=float)
    if not len(arr):
        return None
    return float((np.sum(arr < v) + 0.5 * np.sum(arr == v)) / len(arr))


def aggregate(perfs, tid, team_info, all_observations):
    """perfs: list of per-match team performances for this team (already filtered)."""
    n = len(perfs)
    metrics = {}
    for key, label, group, unit, hib, dec in METRIC_DEFS:
        vals = [p["metrics"][key] for p in perfs if p["metrics"][key] is not None]
        if not vals:
            continue
        v = float(np.mean(vals))
        metrics[key] = {
            "label": label, "group": group, "unit": unit, "higherIsBetter": hib, "decimals": dec,
            "value": round(v, 3),
            "percentile": percentile(all_observations[key], v),
            "perMatch": [round(float(x), 2) for x in vals],
        }

    # players
    agg = defaultdict(Counter)
    minutes = Counter()
    pos_pts = defaultdict(list)
    origin_pts = defaultdict(list)
    meta = {}
    apps = Counter(); starts = Counter()
    for p in perfs:
        raw = p["raw"]
        for pid, m in raw["minutes"].items():
            minutes[pid] += m
            if m > 0:
                apps[pid] += 1
        for pid, c in raw["player"].items():
            agg[pid].update(c)
        for pid, pts in raw["player_pos"].items():
            pos_pts[pid] += pts
        for pid, pts in raw["pass_origin"].items():
            origin_pts[pid] += pts
        for pid, pm in p["players_meta"].items():
            meta.setdefault(pid, pm)
            if pm.get("isFirstEleven"):
                starts[pid] += 1
    players = []
    for pid, mins in minutes.items():
        if mins <= 0:
            continue
        pm = meta.get(pid, {})
        c = agg[pid]
        pts = pos_pts.get(pid) or origin_pts.get(pid) or []
        avg = (float(np.mean([a for a, _ in pts])), float(np.mean([b for _, b in pts]))) if pts else (50.0, 50.0)
        players.append({
            "id": pid, "name": pm.get("name") or p["names"].get(str(pid), str(pid)),
            "short": short_name(pm.get("name") or p["names"].get(str(pid), str(pid))),
            "position": pm.get("position"), "shirt": pm.get("shirtNo"), "age": pm.get("age"),
            "minutes": round(mins), "apps": apps[pid], "starts": starts[pid],
            "touches": c["touches"], "passes": c["passes"], "passes_ok": c["passes_ok"],
            "received": c["received"], "prog_passes": c["prog_passes"], "key_passes": c["key_passes"],
            "box_entries": c["box_entries"], "assists": c["assists"], "xa": round(c["xa"], 2),
            "shots": c["shots"], "goals": c["goals"], "xg": round(c["xg"], 2),
            "dribbles": c["dribbles"], "dribbles_ok": c["dribbles_ok"],
            "def_actions": c["def_actions"], "recoveries": c["recoveries"], "aerials_won": c["aerials_won"],
            "x": round(avg[0], 1), "y": round(avg[1], 1),
        })
    players.sort(key=lambda p: -p["minutes"])

    # passing network
    edges = Counter(); prog_edges = Counter()
    for p in perfs:
        edges.update(p["raw"]["edges"])
        prog_edges.update(p["raw"]["prog_edges"])
    # The 14 most-used players, and the 42 strongest completed-pass
    # connections between them (at least 3 passes), so the picture reads
    # as a structure rather than a hairball.
    eligible = {p["id"] for p in players[:14]}
    net_edges = []
    for (a, b), c in edges.items():
        if a in eligible and b in eligible and c >= 3:
            net_edges.append([a, b, c, prog_edges.get((a, b), 0)])
    net_edges.sort(key=lambda e: -e[2])
    net_edges = net_edges[:42]
    min_edge = net_edges[-1][2] if net_edges else 0
    node_ids = {e[0] for e in net_edges} | {e[1] for e in net_edges}
    pid2p = {p["id"]: p for p in players}
    nodes = []
    for pid in node_ids:
        p = pid2p[pid]
        nodes.append({"id": pid, "name": p["short"], "position": p["position"], "x": p["x"], "y": p["y"],
                      "minutes": p["minutes"], "passes": p["passes_ok"], "received": p["received"]})

    shots_for = []; shots_against = []
    for p in perfs:
        mid = p["match"]["id"]
        for s in p["raw"]["shots"]:
            shots_for.append({**s, "match": mid})
    # against: opponent shots in the same matches
    return {
        "matches": n,
        "metrics": metrics,
        "players": players,
        "network": {"nodes": nodes, "edges": net_edges, "minEdge": min_edge},
        "shots": {"for": shots_for},
        "touchGrid": np.sum([p["raw"]["touch_grid"] for p in perfs], axis=0).round().astype(int).tolist(),
        "defGrid": np.sum([p["raw"]["def_grid"] for p in perfs], axis=0).round().astype(int).tolist(),
    }


def main():
    matches = [json.load(open(f)) for f in sorted(RAW.glob("*.json"))]
    per_match = {}
    for d in matches:
        per_match[d["matchId"]] = analyse_match(d)

    # all team-performances for percentile context (38)
    all_obs = defaultdict(list)
    for mid, perfs in per_match.items():
        for tid, p in perfs.items():
            for key, *_ in METRIC_DEFS:
                all_obs[key].append(p["metrics"][key])

    out_teams = {}
    for tid, info in TEAMS.items():
        own = []
        for mid, perfs in per_match.items():
            if tid in perfs:
                own.append((mid, perfs[tid], perfs))
        own.sort(key=lambda x: x[1]["match"]["date"])
        filters = {}
        for fname, pred in (("all", lambda m: True), ("ucl", lambda m: m in UCL_IDS), ("league", lambda m: m not in UCL_IDS)):
            sel = [p for mid, p, _ in own if pred(mid)]
            agg = aggregate(sel, tid, info, all_obs)
            against = []
            for mid, p, perfs in own:
                if not pred(mid):
                    continue
                o = p["match"]["opponentId"]
                for s in perfs[o]["raw"]["shots"]:
                    against.append({**s, "match": mid, "name": s["name"]})
            agg["shots"]["against"] = against
            # opponents' defensive grid faced (where opponents defended against us) is less useful; keep ours.
            filters[fname] = agg
        out_teams[info["code"]] = {
            **{k: v for k, v in info.items()},
            "teamId": tid,
            "matches": [p["match"] for _, p, _ in own],
            "filters": filters,
        }

    # head-to-head comparison rows (all competitions)
    comparison = []
    for key, label, group, unit, hib, dec in METRIC_DEFS:
        a = out_teams["LIL"]["filters"]["all"]["metrics"].get(key)
        b = out_teams["GAL"]["filters"]["all"]["metrics"].get(key)
        if not a or not b:
            continue
        pa, pb = a["percentile"], b["percentile"]
        gap = abs(pa - pb)
        comparison.append({
            "key": key, "label": label, "group": group, "unit": unit, "higherIsBetter": hib, "decimals": dec,
            "LIL": a["value"], "GAL": b["value"], "pLIL": pa, "pGAL": pb,
            "relation": "overlap" if gap < 0.15 else ("edge" if gap < 0.35 else "contrast"),
            "min": round(float(np.nanmin([x for x in all_obs[key] if x is not None])), 2),
            "max": round(float(np.nanmax([x for x in all_obs[key] if x is not None])), 2),
        })

    meta = {
        "fixture": {
            "home": "LIL", "away": "GAL", "competition": "UEFA Champions League 2026-27",
            "round": "League phase · Matchday 3", "date": "2026-10-21", "kickoff": "18:45 CEST",
            "venue": "Decathlon Arena – Stade Pierre-Mauroy, Lille",
            "homeForm": "".join(m["result"] for m in out_teams["LIL"]["matches"][-5:]),
            "awayForm": "".join(m["result"] for m in out_teams["GAL"]["matches"][-5:]),
        },
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": "Opta event data via WhoScored match centres (19 matches, 2026-27); league context via FBref. xG is a simple distance/angle model, not Opta's.",
        "teamMatchObservations": len(all_obs["possession"]),
        "xgModel": "logit = −0.595 − 0.146·distance(m) + 0.571·angle(rad); ×0.7 odds for headers, ×2.5 big chances, ×1.3 counters; penalties 0.76. Calibrated so total model xG ≈ goals scored across the 19 matches.",
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "preview.json").write_text(json.dumps({"meta": meta, "teams": out_teams, "comparison": comparison}, ensure_ascii=False))

    # summary
    for code, t in out_teams.items():
        f = t["filters"]["all"]
        print(f"{code}: {f['matches']} matches, {len(f['players'])} players, network {len(f['network']['nodes'])} nodes / {len(f['network']['edges'])} edges (min {f['network']['minEdge']}), shots for {len(f['shots']['for'])} against {len(f['shots']['against'])}")
        for m in t["matches"]:
            print(f"   {m['date']} {m['comp']:6} {'H' if m['home'] else 'A'} {m['opponent']:22} {m['gf']}-{m['ga']} {m['result']}  xG {m['xg']:.2f}–{m['xga']:.2f}  poss {m['possession']}  shots {m['shots']}-{m['shots_against']}")
        ms = f["metrics"]
        print("   " + ", ".join(f"{k} {v['value']:.1f} (p{v['percentile']*100:.0f})" for k, v in list(ms.items())[:12]))
    print("comparison rows:", len(comparison), Counter(c["relation"] for c in comparison))
    print("size:", (OUT / "preview.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
