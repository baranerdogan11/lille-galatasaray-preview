import Data from "./Data.js";
import Pitch from "./Pitch.js";
import Sidebar from "./Sidebar.js";

const LENS_LEGEND = {
  network: `<span><i style="background:var(--accent);color:var(--accent)"></i>player, size = minutes</span><span>tube = completed passes, thick end at the passer</span><span>attacking →</span>`,
  shots: `<span><i style="background:var(--accent);color:var(--accent)"></i>goal</span><span><i style="background:#e5e7eb;color:#e5e7eb"></i>saved</span><span><i style="background:#6b7280;color:#6b7280"></i>missed</span><span>size = model xG · conceded shots on the left goal</span>`,
  territory: `<span>relief = where the team touches, defends or shoots · after three.js webgl_geometry_terrain</span><span>attacking →</span>`,
  matchup: `<span><i style="background:var(--accent);color:var(--accent)"></i>attacker's shots</span><span>○ defender's conceded shots</span><span>shading = defensive actions</span>`,
};

export default class App {
  constructor() {
    this.data = new Data();
    this.pitch = new Pitch(this, ".canvas", ".labels");
    this.sidebar = new Sidebar(this, ".sidebar");
    this.state = { lens: "network", team: "LIL", comp: "all", shots: "for", matchup: "LIL", surface: "touches" };
    this._readHash();
    this._installControls();
    this._installChrome();
    this._reveal();
    this.load();
  }

  async load() {
    try {
      await this.data.load();
    } catch (err) {
      console.error(err);
      document.querySelector(".load-error").classList.add("visible");
      return;
    }
    document.querySelector(".load-error").classList.remove("visible");
    const f = this.data.meta.fixture;
    document.querySelector("[data-fixture-sub]").textContent =
      `${f.competition} · ${f.round} · Wed 21 Oct 2026, ${f.kickoff} · ${f.venue}`;
    document.querySelector("[data-meta-caption]").textContent = this.data.meta.sources;
    this.sidebar.renderCompare();
    this.render();
  }

  /* ── State → scene ───────────────────────────────────────────── */

  render() {
    const s = this.state;
    const d = this.data;
    this._syncControls();
    const team = d.team(s.team);
    const comp = s.comp;
    document.querySelector("[data-back]").hidden = true;
    const panel = document.querySelector(".compare-panel");
    if (s.lens === "matchup") {
      const attack = d.team(s.matchup), defend = d.team(s.matchup === "LIL" ? "GAL" : "LIL");
      const names = { attack: Object.fromEntries(attack.matches.map((m) => [m.id, m.opponent])), defend: Object.fromEntries(defend.matches.map((m) => [m.id, m.opponent])) };
      this.pitch.showMatchup(d.shots(attack.code, comp, "for"), d.shots(defend.code, comp, "against"), d.filter(defend.code, comp).defGrid, attack.color, defend.color, names);
      this.sidebar.renderMatchup(attack, defend, comp);
      panel.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add("open")));
      document.body.classList.add("compare-open");
      this._stats([["Lille xG / match", fmt(d.metric("LIL", comp, "xg").value, 2)], ["Gala xG / match", fmt(d.metric("GAL", comp, "xg").value, 2)], ["Lille xGA / match", fmt(d.metric("LIL", comp, "xga").value, 2)], ["Gala xGA / match", fmt(d.metric("GAL", comp, "xga").value, 2)]]);
    } else {
      panel.classList.remove("open");
      document.body.classList.remove("compare-open");
      setTimeout(() => { if (this.state.lens !== "matchup") panel.hidden = true; }, 650);
      const f = d.filter(team.code, comp);
      const opp = Object.fromEntries(team.matches.map((m) => [m.id, m.opponent]));
      if (s.lens === "network") {
        this.pitch.showNetwork(d.network(team.code, comp), team.color);
        this.sidebar.renderNetwork(team, comp);
      } else if (s.lens === "territory") {
        this.pitch.showTerrain(f.surfaces[s.surface], team.color, s.surface);
        this.sidebar.renderTerritory(team, comp, s.surface);
      } else {
        this.pitch.showShots(d.shots(team.code, comp, "for"), d.shots(team.code, comp, "against"), s.shots, team.color, opp);
        this.sidebar.renderShots(team, comp, s.shots);
      }
      this._stats([["Matches", f.matches], ["xG for / match", fmt(d.metric(team.code, comp, "xg").value, 2)], ["xG against / match", fmt(d.metric(team.code, comp, "xga").value, 2)], ["Possession", fmt(d.metric(team.code, comp, "possession").value, 0) + "%"]]);
    }
    document.querySelector("[data-legend]").innerHTML = LENS_LEGEND[s.lens];
    this._writeHash();
  }

  _stats(pairs) {
    ["a", "b", "c", "d"].forEach((k, i) => {
      document.querySelector(`[data-stat-label="${k}"]`).textContent = pairs[i][0];
      document.querySelector(`[data-stat="${k}"]`).textContent = pairs[i][1];
    });
  }

  /* ── Focus callbacks from the pitch ──────────────────────────── */

  onPin(a, b) {
    const team = this.data.team(this.state.team);
    if (a && b) this.sidebar.renderPair(team, this.state.comp, a, b);
    else if (a) this.sidebar.renderPlayer(team, this.state.comp, a);
    else this.sidebar.renderNetwork(team, this.state.comp);
  }

  focusPair(a, b) {
    const ma = this.pitch.nodeById.get(a), mb = this.pitch.nodeById.get(b);
    if (!ma || !mb) return;
    while (this.pitch.mode !== "default") this.pitch.back();
    this.pitch.pin(ma);
    this.pitch.pinPair(mb);
  }

  focusPlayer(id) {
    const m = this.pitch.nodeById.get(id);
    if (!m) return;
    while (this.pitch.mode !== "default") this.pitch.back();
    this.pitch.pin(m);
  }

  updateBackButton() {
    const focused = this.pitch.mode !== "default";
    document.querySelector("[data-back]").hidden = !focused;
    document.body.classList.toggle("focused", focused);
  }

  notePinned() {
    if (!this._hintEl) return;
    clearTimeout(this._hintTimer);
    this._hintEl.classList.remove("show");
    this._hintEl = null;
    try { localStorage.setItem("preview_hint_seen", "1"); } catch { /* ignore */ }
  }

  /* ── Controls ────────────────────────────────────────────────── */

  _installControls() {
    for (const seg of document.querySelectorAll("[data-seg]")) {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-value]");
        if (!btn) return;
        const key = seg.dataset.seg;
        if (this.state[key] === btn.dataset.value) return;
        this.state[key] = btn.dataset.value;
        this.render();
      });
    }
    document.querySelector("[data-brand]")?.addEventListener("click", (e) => {
      e.preventDefault();
      while (this.pitch.mode !== "default") this.pitch.back();
      this.pitch.fit();
    });
    window.addEventListener("hashchange", () => {
      const before = JSON.stringify(this.state);
      this._readHash();
      if (JSON.stringify(this.state) !== before) this.render();
    });
  }

  _syncControls() {
    const s = this.state;
    for (const seg of document.querySelectorAll("[data-seg]")) {
      for (const b of seg.querySelectorAll("button")) b.classList.toggle("current", b.dataset.value === s[seg.dataset.seg]);
    }
    document.querySelector("[data-control='team']").hidden = s.lens === "matchup";
    document.querySelector("[data-control='shots']").hidden = s.lens !== "shots";
    document.querySelector("[data-control='territory']").hidden = s.lens !== "territory";
    document.querySelector("[data-control='matchup']").hidden = s.lens !== "matchup";
  }

  _readHash() {
    const parts = location.hash.replace("#", "").split("/").filter(Boolean);
    const [lens, team, comp, extra] = parts;
    if (["network", "shots", "territory", "matchup"].includes(lens)) this.state.lens = lens;
    if (["LIL", "GAL"].includes(team)) { this.state.team = team; this.state.matchup = team; }
    if (["all", "ucl", "league"].includes(comp)) this.state.comp = comp;
    if (["for", "against", "both"].includes(extra)) this.state.shots = extra;
    if (["touches", "defence", "shots"].includes(extra) && lens === "territory") this.state.surface = extra;
  }

  _writeHash() {
    const s = this.state;
    const h = `#${s.lens}/${s.lens === "matchup" ? s.matchup : s.team}/${s.comp}${s.lens === "shots" ? `/${s.shots}` : s.lens === "territory" ? `/${s.surface}` : ""}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  /* ── Chrome ──────────────────────────────────────────────────── */

  _installChrome() {
    document.querySelector("[data-retry]")?.addEventListener("click", () => this.load());
    const toggle = document.querySelector("[data-sidebar-toggle]");
    toggle?.addEventListener("click", () => {
      const open = document.body.classList.toggle("sidebar-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    const masthead = document.querySelector(".masthead"), sidebar = document.querySelector(".sidebar");
    const reposition = () => { sidebar.style.top = `${masthead.getBoundingClientRect().bottom + 14}px`; };
    reposition();
    new ResizeObserver(reposition).observe(masthead);
    window.addEventListener("resize", reposition);
    // Compare panel close (phones)
    const header = document.querySelector(".compare-panel-header");
    const close = document.createElement("button");
    close.type = "button"; close.className = "compare-panel-close"; close.innerHTML = "← Back to the pitch";
    close.addEventListener("click", () => { this.state.lens = "network"; this.render(); });
    header.prepend(close);
    // first-visit hint
    this._hintEl = document.querySelector("[data-hint]");
    let seen = null;
    try { seen = localStorage.getItem("preview_hint_seen"); } catch { seen = "1"; }
    if (seen) this._hintEl = null;
    else this._hintTimer = setTimeout(() => this._hintEl?.classList.add("show"), 3000);
  }

  _reveal() {
    document.querySelectorAll("[data-reveal]").forEach((el, i) =>
      el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 550, delay: 50 + i * 70, easing: "cubic-bezier(0.2,0.7,0.2,1)", fill: "backwards" })
    );
  }
}

function fmt(v, dec) {
  return v == null ? "—" : Number(v).toFixed(dec);
}
