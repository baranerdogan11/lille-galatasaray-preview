/** Loads public/data/preview.json and exposes typed accessors. */
export default class Data {
  constructor() {
    this.raw = null;
  }

  async load() {
    const res = await fetch("./public/data/preview.json");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    this.raw = await res.json();
    return this.raw;
  }

  get meta() {
    return this.raw?.meta;
  }

  team(code) {
    return this.raw?.teams?.[code];
  }

  filter(code, comp) {
    return this.team(code)?.filters?.[comp];
  }

  players(code, comp) {
    return this.filter(code, comp)?.players || [];
  }

  player(code, comp, id) {
    return this.players(code, comp).find((p) => p.id === id);
  }

  network(code, comp) {
    return this.filter(code, comp)?.network || { nodes: [], edges: [] };
  }

  shots(code, comp, side) {
    return this.filter(code, comp)?.shots?.[side] || [];
  }

  matches(code, comp) {
    const all = this.team(code)?.matches || [];
    if (comp === "ucl") return all.filter((m) => m.comp === "UCL");
    if (comp === "league") return all.filter((m) => m.comp !== "UCL");
    return all;
  }

  metric(code, comp, key) {
    return this.filter(code, comp)?.metrics?.[key];
  }

  get comparison() {
    return this.raw?.comparison || [];
  }

  /** Directed completed passes a → b in the current network (0 if not an edge). */
  edgeCount(code, comp, a, b) {
    const e = this.network(code, comp).edges.find((x) => x[0] === a && x[1] === b);
    return e ? e[2] : 0;
  }
}
