# Lille × Galatasaray — Champions League preview

A match preview for Lille v Galatasaray (UEFA Champions League 2026-27,
league phase matchday 3, 21 October 2026) built in the same cream-paper,
three.js style as the EuroLeague assist networks. Three lenses on one 3D pitch:

- **Passing network** — each team's season so far (9 Lille matches, 10
  Galatasaray) as players at their average on-ball position, linked by
  tapered tubes for completed passes. Click a player for their links and
  season line; click a second for the pair. Filter by competition.
- **Shot map** — every shot taken (right goal) and conceded (mirrored to the
  left goal), sized by a simple distance/angle xG model, goals ringed.
- **Head-to-head** — Lille's attack overlaid on Galatasaray's defence (and
  the reverse): shots taken vs shots conceded on the same goal, plus the
  defender's defensive-action heat; a side panel compares 27 measures on a
  percentile scale across all 38 team performances in these 19 matches,
  tagged overlap / edge / contrast.

## Data

- **Opta event data** (every pass, shot, tackle, with coordinates) from the
  WhoScored match centres of all 19 matches both clubs have played in 2026-27
  (Ligue 1, Süper Lig, Champions League), saved under `pipeline/raw/ws/`.
- **League context** (table positions, points) from FBref.
- **xG** is *not* Opta's: a logistic model on shot distance and angle
  (`logit = −0.595 − 0.146·dist + 0.571·angle`, with multipliers for headers,
  big chances and counters, penalties fixed at 0.76), calibrated so total
  model xG equals goals scored across the 19 matches. StatsBomb open data
  does not cover the 2026-27 season, so it was not used.

## Pipeline

```bash
python3 -m venv .venv && .venv/bin/pip install numpy requests pillow
.venv/bin/python pipeline/ws_extract.py <dir of saved WhoScored pages>   # → pipeline/raw/ws/{matchId}.json
.venv/bin/python pipeline/build.py                                        # → public/data/preview.json
python3 pipeline/serve.py 8766                                            # local no-cache server
```

Match pages were fetched through a scraping proxy (WhoScored blocks plain
requests); `ws_extract.py` pulls the embedded `matchCentreData` JSON out of
any saved page. `build.py` pairs each completed pass with its receiver (the
next on-ball event by the same team), computes team style metrics per match
(possession as pass share, PPDA, field tilt, progressive passes, high
turnovers, …), per-player season lines, the passing networks (14 most-used
players, 42 strongest links), shot lists for and against, and percentiles.

## Front end

Vanilla ES modules, three.js 0.176 via import map. `Pitch.js` draws the pitch
and the three lenses, `Sidebar.js` the cards and the comparison panel,
`App.js` wires the rail controls and the URL hash (`#lens/team/comp`).
