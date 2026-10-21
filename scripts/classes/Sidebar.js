const METRIC_INFO = {
  possession: { title: "Possession", def: "Share of passes attempted by the team in its matches (a pass-based possession proxy).", ctx: "Galatasaray dominate the ball domestically but had 30% against Barcelona; Lille's league possession is closer to even." },
  field_tilt: { title: "Field tilt", def: "The team's share of all final-third touches in its matches: how much of the game is played in the opponent's third rather than its own.", ctx: "A low tilt with decent possession means a team that keeps the ball deep." },
  prog_passes: { title: "Progressive passes", def: "Completed passes that move the ball at least 10 m closer to goal and end in the opposition half (per match).", ctx: "How often the team actually advances play rather than circulating." },
  ppda: { title: "PPDA", def: "Passes allowed per defensive action: opponent passes in their own 60% of the pitch divided by the team's tackles, interceptions, challenges and fouls in that zone. Lower = more aggressive press.", ctx: "Whoever presses higher will dictate where the match is played." },
  high_turnovers: { title: "High turnovers", def: "Ball recoveries, interceptions and tackles won within 40 m of the opposition goal, per match.", ctx: "Counter-pressing yield: turnovers that become shots quickly." },
  xg: { title: "xG (model)", def: "Expected goals from a simple logistic model on shot distance and angle, with adjustments for headers, big chances and counters. Calibrated so total xG matches goals scored across these 19 matches. Not Opta's model.", ctx: "Use it to compare chance quality, not as a precise forecast." },
  xga: { title: "xG conceded (model)", def: "The same model applied to the opponent's shots.", ctx: "Both sides have been generous: Lille concede ~1.7 xG a match, Galatasaray's European nights were worse." },
  xg_per_shot: { title: "xG per shot", def: "Average chance quality of the team's shots.", ctx: "Galatasaray shoot a lot from range at home; Lille's chances are fewer but not worse." },
  shots: { title: "Shots per match", def: "Shots attempted per match, including blocked.", ctx: "" },
  big_chances: { title: "Big chances", def: "Opta's 'big chance' flag: a situation where the shooter would reasonably be expected to score.", ctx: "" },
  box_entries: { title: "Passes into the box", def: "Completed passes that end inside the penalty area from outside it, per match.", ctx: "" },
  shots_against: { title: "Shots conceded", def: "Opponent shots per match.", ctx: "Lille have been outshot in 7 of 9 matches." },
};

export default class Sidebar {
  constructor(app, rootSelector) {
    this.app = app;
    this.root = document.querySelector(rootSelector);
    this.content = document.createElement("div");
    this.content.className = "sidebar-content";
    this.root.appendChild(this.content);
    this.dialog = document.querySelector(".info-modal");
    this.dialog?.querySelector("[data-modal-close]")?.addEventListener("click", () => this.dialog.close());
    this.dialog?.addEventListener("click", (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.root.addEventListener("click", (e) => {
      const info = e.target.closest("[data-info]");
      if (info) { e.stopPropagation(); this.openInfo(info.dataset.info); return; }
      const pair = e.target.closest("[data-pair]");
      if (pair) { const [a, b] = pair.dataset.pair.split(":").map(Number); this.app.focusPair(a, b); return; }
      const pl = e.target.closest("[data-player]");
      if (pl) this.app.focusPlayer(Number(pl.dataset.player));
    });
    this.compareList = document.querySelector("[data-compare-list]");
  }

  openInfo(key) {
    const i = METRIC_INFO[key];
    if (!i || !this.dialog) return;
    this.dialog.querySelector("[data-modal-title]").textContent = i.title;
    this.dialog.querySelector("[data-modal-def]").textContent = i.def;
    this.dialog.querySelector("[data-modal-ctx]").textContent = i.ctx || "—";
    this.dialog.showModal();
  }

  /* ── Team summary (network + shots lenses) ───────────────────── */

  teamHead(team, comp) {
    const d = this.app.data;
    const f = d.filter(team.code, comp);
    const sub = comp === "ucl" ? `Champions League · ${f.matches} matches` : comp === "league" ? `${team.league} · ${f.matches} matches` : `${f.matches} matches · all competitions`;
    return (
      `<div class="team-head"><img src="./public/logos/${team.code}.png" alt="" />` +
      `<div><div class="team-head-name">${esc(team.name)}</div><div class="team-head-sub">${esc(team.manager)} · ${ordinal(team.league_pos)} in ${esc(team.league)} · ${team.league_pts} pts</div></div></div>` +
      `<div class="team-head-sub" style="margin-bottom:.2rem">${esc(sub)}</div>` +
      this.formStrip(d.matches(team.code, comp))
    );
  }

  formStrip(matches) {
    return `<div class="form-strip">` + matches.slice(-9).map((m) =>
      `<div class="form-chip ${m.result} ${m.comp === "UCL" ? "ucl" : ""}" title="${esc(m.opponent)} (${m.home ? "H" : "A"}) ${m.gf}-${m.ga} · xG ${m.xg.toFixed(2)}–${m.xga.toFixed(2)}">` +
      `<b>${m.result}</b><span>${esc(abbr(m.opponent))}</span><span>${m.gf}–${m.ga}</span></div>`).join("") + `</div>`;
  }

  metricCard(team, comp, key) {
    const m = this.app.data.metric(team.code, comp, key);
    if (!m) return "";
    const pct = Math.round(m.percentile * 100);
    return (
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">${esc(m.label)}</span>` +
      (METRIC_INFO[key] ? `<button class="metric-info" type="button" data-info="${key}" aria-label="About ${esc(m.label)}">ⓘ</button>` : "") +
      `</div><div class="metric-value">${fmt(m.value, m.decimals)}<small>${esc(m.unit)}${m.unit ? "" : " / match"}</small></div>` +
      `<div class="metric-range"><span>low</span><span class="metric-range-track"><span class="metric-range-dot" style="left:${pct}%"></span></span><span>high</span></div>` +
      `<div class="metric-sub">${pct}th percentile of ${this.app.data.meta.teamMatchObservations} team performances</div></div>`
    );
  }

  renderNetwork(team, comp) {
    const d = this.app.data;
    const net = d.network(team.code, comp);
    const byId = new Map(d.players(team.code, comp).map((p) => [p.id, p]));
    const top = net.edges.slice(0, 5).map(([a, b, c, prog]) =>
      `<div class="list-row clickable" data-pair="${a}:${b}"><span>${esc(byId.get(a)?.short)} → ${esc(byId.get(b)?.short)}</span><span>${c} · ${prog} prog</span></div>`).join("");
    const html =
      this.teamHead(team, comp) +
      this.metricCard(team, comp, "possession") +
      this.metricCard(team, comp, "field_tilt") +
      this.metricCard(team, comp, "prog_passes") +
      this.metricCard(team, comp, "ppda") +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">Strongest links</span></div><div class="list">${top}</div>` +
      `<div class="metric-sub" style="margin-top:.35rem">${net.nodes.length} players · ${net.edges.length} links of ${net.minEdge}+ completed passes</div></div>`;
    this._render(html, "team");
  }

  renderShots(team, comp, mode) {
    const d = this.app.data;
    const side = mode === "against" ? "against" : "for";
    const shots = d.shots(team.code, comp, side);
    const n = d.filter(team.code, comp).matches;
    const goals = shots.filter((s) => s.outcome === "goal").length;
    const xg = shots.reduce((a, s) => a + s.xg, 0);
    const big = shots.filter((s) => s.big).length;
    const sit = {};
    for (const s of shots) sit[s.situation] = (sit[s.situation] || 0) + 1;
    const sitRows = Object.entries(sit).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="bar"><span>${esc(k)}</span><span class="bar-track"><span class="bar-fill" style="width:${(100 * v) / shots.length}%"></span></span><span>${v}</span></div>`).join("");
    const byPlayer = {};
    for (const s of shots) {
      const k = side === "for" ? s.name : `${s.name}`;
      byPlayer[k] = byPlayer[k] || { n: 0, xg: 0, g: 0 };
      byPlayer[k].n++; byPlayer[k].xg += s.xg; byPlayer[k].g += s.outcome === "goal" ? 1 : 0;
    }
    const topP = Object.entries(byPlayer).sort((a, b) => b[1].xg - a[1].xg).slice(0, 6).map(([k, v]) =>
      `<div class="list-row"><span>${esc(k)}</span><span>${v.n} sh · ${v.xg.toFixed(2)} xG · ${v.g} g</span></div>`).join("");
    const matches = d.matches(team.code, comp);
    const perMatch = matches.map((m) =>
      `<div class="list-row"><span>${m.home ? "v" : "at"} ${esc(m.opponent)} <span style="color:var(--muted)">${m.gf}–${m.ga}</span></span><span>${side === "for" ? m.xg.toFixed(2) : m.xga.toFixed(2)} xG · ${side === "for" ? m.shots : m.shots_against} sh</span></div>`).join("");
    const label = side === "for" ? "taken" : "conceded";
    const html =
      this.teamHead(team, comp) +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">Shots ${label}</span><button class="metric-info" type="button" data-info="${side === "for" ? "xg" : "xga"}">ⓘ</button></div>` +
      `<dl class="kv"><dt>Shots / match</dt><dd><b>${(shots.length / n).toFixed(1)}</b></dd><dt>Goals</dt><dd><b>${goals}</b> / ${xg.toFixed(1)} xG</dd>` +
      `<dt>xG per shot</dt><dd><b>${(xg / Math.max(1, shots.length)).toFixed(2)}</b></dd><dt>Big chances</dt><dd><b>${big}</b></dd></dl></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">By situation</span></div><div class="bars">${sitRows}</div></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">${side === "for" ? "Who shoots" : "Who scores against them"}</span></div><div class="list">${topP}</div></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">Match by match</span></div><div class="list">${perMatch}</div></div>`;
    this._render(html, "shots");
  }

  renderTerritory(team, comp, surface) {
    const d = this.app.data;
    const f = d.filter(team.code, comp);
    const grid = f.surfaces[surface];
    // thirds and lanes from the 36×24 surface
    const total = grid.flat().reduce((a, b) => a + b, 0) || 1;
    const third = (lo, hi) => grid.slice(lo, hi).flat().reduce((a, b) => a + b, 0) / total;
    const lane = (lo, hi) => grid.reduce((a, row) => a + row.slice(lo, hi).reduce((x, y) => x + y, 0), 0) / total;
    const thirds = [["Own third", third(0, 12)], ["Middle third", third(12, 24)], ["Final third", third(24, 36)]];
    const lanes = [["Right", lane(0, 8)], ["Centre", lane(8, 16)], ["Left", lane(16, 24)]];
    const bar = ([k, p]) => `<div class="bar"><span>${esc(k)}</span><span class="bar-track"><span class="bar-fill" style="width:${(p * 100).toFixed(0)}%"></span></span><span>${(p * 100).toFixed(0)}%</span></div>`;
    const title = { touches: "Where they have the ball", defence: "Where they defend", shots: "Where they shoot from" }[surface];
    const cards = surface === "touches"
      ? this.metricCard(team, comp, "field_tilt") + this.metricCard(team, comp, "possession")
      : surface === "defence"
        ? this.metricCard(team, comp, "ppda") + this.metricCard(team, comp, "high_turnovers")
        : this.metricCard(team, comp, "xg_per_shot") + this.metricCard(team, comp, "shot_dist");
    const html =
      this.teamHead(team, comp) +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">${esc(title)}</span></div>` +
      `<div class="metric-sub" style="margin:.1rem 0 .35rem">${total.toFixed(0)} per match · attacking left → right</div>` +
      `<div class="bars">${thirds.map(bar).join("")}</div><div class="bars" style="margin-top:.5rem">${lanes.map(bar).join("")}</div></div>` +
      cards;
    this._render(html, "territory");
  }

  renderPlayer(team, comp, id) {
    const p = this.app.data.player(team.code, comp, id);
    if (!p) return;
    const acc = p.passes ? Math.round((100 * p.passes_ok) / p.passes) : 0;
    const html =
      `<div class="sidebar-section-header"><span>Player <span class="sidebar-section-context">${esc(p.name)}</span></span><span>#${p.shirt ?? "—"} · ${esc(p.position ?? "")}</span></div>` +
      `<div class="metric-card"><dl class="kv">` +
      `<dt>Minutes</dt><dd><b>${p.minutes}</b> · ${p.apps} apps, ${p.starts} starts</dd>` +
      `<dt>Passes</dt><dd><b>${p.passes_ok}</b> / ${p.passes} · ${acc}%</dd>` +
      `<dt>Received</dt><dd><b>${p.received}</b></dd>` +
      `<dt>Progressive</dt><dd><b>${p.prog_passes}</b> · ${(p.prog_passes / Math.max(1, p.minutes / 90)).toFixed(1)} /90</dd>` +
      `<dt>Into the box</dt><dd><b>${p.box_entries}</b></dd>` +
      `<dt>Key passes · xA</dt><dd><b>${p.key_passes}</b> · ${p.xa.toFixed(2)}</dd>` +
      `<dt>Assists</dt><dd><b>${p.assists}</b></dd>` +
      `<dt>Shots · xG · goals</dt><dd><b>${p.shots}</b> · ${p.xg.toFixed(2)} · ${p.goals}</dd>` +
      `<dt>Take-ons</dt><dd><b>${p.dribbles_ok}</b> / ${p.dribbles}</dd>` +
      `<dt>Defensive actions</dt><dd><b>${p.def_actions}</b> · ${p.recoveries} rec.</dd>` +
      `<dt>Aerials won</dt><dd><b>${p.aerials_won}</b></dd>` +
      `</dl></div>` +
      `<div class="metric-sub">Click a second player for the pair · Esc to go back</div>`;
    this._render(html, "player");
  }

  renderPair(team, comp, a, b) {
    const d = this.app.data;
    const pa = d.player(team.code, comp, a), pb = d.player(team.code, comp, b);
    if (!pa || !pb) return;
    const ab = d.edgeCount(team.code, comp, a, b), ba = d.edgeCount(team.code, comp, b, a);
    const net = d.network(team.code, comp);
    const pairs = new Map();
    for (const [x, y, c] of net.edges) { const k = [x, y].sort().join(":"); pairs.set(k, (pairs.get(k) || 0) + c); }
    const ranked = [...pairs.entries()].sort((x, y) => y[1] - x[1]);
    const rank = ranked.findIndex(([k]) => k === [a, b].sort().join(":")) + 1;
    const prog = net.edges.filter((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)).reduce((s, e) => s + e[3], 0);
    const html =
      `<div class="sidebar-section-header"><span>Pair <span class="sidebar-section-context">${esc(pa.short)} × ${esc(pb.short)}</span></span></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">Completed passes</span></div>` +
      `<div class="metric-value">${ab + ba}<small>between them</small></div>` +
      `<dl class="kv"><dt>${esc(pa.short)} → ${esc(pb.short)}</dt><dd><b>${ab}</b></dd><dt>${esc(pb.short)} → ${esc(pa.short)}</dt><dd><b>${ba}</b></dd><dt>Progressive</dt><dd><b>${prog}</b></dd></dl>` +
      `<div class="metric-sub" style="margin-top:.35rem">${rank ? `#${rank} of ${ranked.length} drawn links` : "Not among the drawn links"}</div></div>`;
    this._render(html, "pair");
  }

  renderMatchup(attack, defend, comp) {
    const d = this.app.data;
    const ma = (k) => d.metric(attack.code, comp, k), md = (k) => d.metric(defend.code, comp, k);
    const row = (label, v, unit = "") => `<dt>${label}</dt><dd><b>${v}</b>${unit}</dd>`;
    const html =
      `<div class="team-head"><img src="./public/logos/${attack.code}.png" alt="" /><div><div class="team-head-name">${esc(attack.name)} attack</div><div class="team-head-sub">against ${esc(defend.name)}'s defence</div></div></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">${esc(attack.name)} with the ball</span></div><dl class="kv">` +
      row("Shots / match", fmt(ma("shots").value, 1)) + row("xG / match", fmt(ma("xg").value, 2)) + row("xG per shot", fmt(ma("xg_per_shot").value, 2)) +
      row("Passes into box", fmt(ma("box_entries").value, 1)) + row("Crosses", fmt(ma("crosses").value, 1)) + row("Counter shots", fmt(ma("counter_shots").value, 1)) + `</dl></div>` +
      `<div class="metric-card"><div class="metric-head"><span class="metric-label">${esc(defend.name)} without it</span></div><dl class="kv">` +
      row("Shots conceded", fmt(md("shots_against").value, 1)) + row("xG conceded", fmt(md("xga").value, 2)) + row("xG / shot conceded", fmt(md("xga_per_shot").value, 2)) +
      row("PPDA", fmt(md("ppda").value, 1)) + row("High turnovers", fmt(md("high_turnovers").value, 1)) + row("Aerials won", fmt(md("aerial_win").value, 0), "%") + `</dl></div>` +
      `<div class="metric-sub">Filled dots: where ${esc(attack.name)} shoot from (size = model xG). Rings: where ${esc(defend.name)} have conceded shots. Shading: where ${esc(defend.name)} make their defensive actions.</div>`;
    this._render(html, "matchup");
  }

  renderCompare() {
    const rows = this.app.data.comparison;
    const groups = [];
    for (const r of rows) {
      let g = groups.find((x) => x.name === r.group);
      if (!g) groups.push((g = { name: r.group, rows: [] }));
      g.rows.push(r);
    }
    this.compareList.innerHTML = groups.map((g) =>
      `<div class="compare-group">${esc(g.name)}</div>` +
      g.rows.map((r) =>
        `<div class="compare-row"><span class="compare-row-label">${esc(r.label)}</span><span class="compare-row-tag ${r.relation}">${r.relation}</span>` +
        `<div class="compare-track"><span class="compare-dot lil" style="left:${(r.pLIL * 100).toFixed(1)}%" title="Lille"></span><span class="compare-dot gal" style="left:${(r.pGAL * 100).toFixed(1)}%" title="Galatasaray"></span></div>` +
        `<div class="compare-vals"><span>Lille <b>${fmt(r.LIL, r.decimals)}${esc(r.unit)}</b></span><span>${fmt(r.GAL, r.decimals)}${esc(r.unit)} <b>Galatasaray</b></span></div></div>`
      ).join("")
    ).join("");
    const c = rows.reduce((acc, r) => ((acc[r.relation] = (acc[r.relation] || 0) + 1), acc), {});
    document.querySelector("[data-compare-sub]").textContent = `${rows.length} measures · ${c.overlap || 0} overlap · ${c.edge || 0} edge · ${c.contrast || 0} contrast · all competitions`;
  }

  _render(html, section) {
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    if (this._section === section || !this._section) {
      this.content.innerHTML = html;
      this._section = section;
      return;
    }
    this._section = section;
    this.content.classList.add("fading");
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this.content.innerHTML = html;
      void this.content.offsetWidth;
      this.content.classList.remove("fading");
    }, 140);
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(v, dec) {
  return v == null ? "—" : Number(v).toFixed(dec ?? 1);
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function abbr(name) {
  const map = { "Paris Saint-Germain": "PSG", "Istanbul Basaksehir": "BAS", "Erzurumspor FK": "ERZ", "Corum FK": "COR", "Genclerbirligi": "GEN", "Real Betis": "BET", "Trabzonspor": "TRA", "Kasimpasa": "KAS", "Kocaelispor": "KOC", "Goztepe": "GOZ", "Sporting": "SCP", "Barcelona": "BAR", "Arsenal": "ARS", "Le Havre": "HAC", "Toulouse": "TFC", "Angers": "ANG", "Troyes": "TRO", "Nice": "NIC", "Brest": "BRE", "PSG": "PSG" };
  return map[name] || name.slice(0, 3).toUpperCase();
}
