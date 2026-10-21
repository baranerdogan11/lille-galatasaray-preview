import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Label from "./Label.js";

/* Cream-paper palette shared with index.css */
const BG = new THREE.Color("#f5f1e8");
const TURF = new THREE.Color("#ede6d5");
const INK = new THREE.Color("#1a1a1a");
const MUTED = new THREE.Color("#9a9484");
const L = 10.5; // pitch length in world units (1 unit = 10 m)
const W = 6.8;
const UP = new THREE.Vector3(0, 1, 0);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Opta (0-100, 0-100; attacking left→right) → world (x right, z toward viewer). */
export function toWorld(x, y, mirror = false) {
  if (mirror) {
    x = 100 - x;
    y = 100 - y;
  }
  return new THREE.Vector3((x / 100 - 0.5) * L, 0, (0.5 - y / 100) * W);
}

export default class Pitch {
  constructor(app, canvasSelector, labelsSelector) {
    this.app = app;
    this.canvas = document.querySelector(canvasSelector);
    this.scene = new THREE.Scene();
    this.scene.background = BG;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.camera = new THREE.PerspectiveCamera(38, (w || 1) / (h || 1), 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(BG, 1);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 26;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.25;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xfff4dc, 1.0);
    key.position.set(-6, 12, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd9e4f2, 0.3);
    fill.position.set(8, 4, -6);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.layer = new THREE.Group(); // current lens content
    this.root.add(this.layer);
    this._buildPitch();

    this.label = new Label(document.querySelector(labelsSelector), this.camera, this.canvas);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tooltip = document.querySelector("[data-tooltip]");

    this._tweens = [];
    this._interactive = [];
    this.nodeById = new Map();
    this.edgeMeshes = [];
    this.hovered = null;
    this.pinned = null;
    this.pinnedB = null;
    this.mode = "default"; // default | single | pair
    this._accent = new THREE.Color("#C8102E");
    this._downPos = null;

    const ramp = new Uint8Array([150, 210, 255]);
    this._toon = new THREE.DataTexture(ramp, 3, 1, THREE.RedFormat);
    this._toon.minFilter = this._toon.magFilter = THREE.NearestFilter;
    this._toon.needsUpdate = true;
    this._sphere = new THREE.SphereGeometry(0.1, 36, 36);
    this._cyl = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    this._haloMat = new THREE.MeshBasicMaterial({ color: TURF.clone() });
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), n: new THREE.Vector3() };

    this._bind();
    this.resize();
    this.fit(true);
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  /* ── Pitch geometry ──────────────────────────────────────────── */

  _buildPitch() {
    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 0.6, W + 0.6),
      new THREE.MeshBasicMaterial({ color: TURF })
    );
    turf.rotation.x = -Math.PI / 2;
    turf.position.y = -0.002;
    this.root.add(turf);

    const m = (metres) => metres / 10;
    const mat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 });
    const lines = [];
    const seg = (x1, z1, x2, z2) => lines.push(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 0, z2));
    const rect = (x1, z1, x2, z2) => {
      seg(x1, z1, x2, z1); seg(x2, z1, x2, z2); seg(x2, z2, x1, z2); seg(x1, z2, x1, z1);
    };
    const hl = L / 2, hw = W / 2;
    rect(-hl, -hw, hl, hw);
    seg(0, -hw, 0, hw);
    const arc = (cx, cz, r, a0, a1, n = 40) => {
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
        seg(cx + r * Math.cos(t0), cz + r * Math.sin(t0), cx + r * Math.cos(t1), cz + r * Math.sin(t1));
      }
    };
    arc(0, 0, m(9.15), 0, Math.PI * 2, 64);
    for (const s of [-1, 1]) {
      const gx = s * hl;
      // penalty area 16.5 × 40.32, six-yard 5.5 × 18.32
      rect(gx, -m(20.16), gx - s * m(16.5), m(20.16));
      rect(gx, -m(9.16), gx - s * m(5.5), m(9.16));
      // penalty spot and the D
      const px = gx - s * m(11);
      arc(px, 0, 0.04, 0, Math.PI * 2, 10);
      const d = Math.acos(m(5.5) / m(9.15));
      if (s > 0) arc(px, 0, m(9.15), Math.PI - d, Math.PI + d, 24);
      else arc(px, 0, m(9.15), -d, d, 24);
      // corner arcs
      arc(gx, -hw, m(1), s > 0 ? Math.PI / 2 : 0, s > 0 ? Math.PI : Math.PI / 2, 8);
      arc(gx, hw, m(1), s > 0 ? Math.PI : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : 0, 8);
    }
    const geom = new THREE.BufferGeometry().setFromPoints(lines);
    const mesh = new THREE.LineSegments(geom, mat);
    mesh.position.y = 0.003;
    this.root.add(mesh);
    this._markings = lines; // kept so the territory lens can drape them over the relief

    // goal frames: posts + crossbar + net depth, as hairlines
    const gl = [];
    const g = (x1, y1, z1, x2, y2, z2) => gl.push(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2));
    for (const s of [-1, 1]) {
      const gx = s * hl, hp = m(7.32 / 2), gh = m(2.44), depth = s * m(1.6);
      g(gx, 0, -hp, gx, gh, -hp); g(gx, 0, hp, gx, gh, hp); g(gx, gh, -hp, gx, gh, hp);
      g(gx, gh, -hp, gx + depth, 0, -hp); g(gx, gh, hp, gx + depth, 0, hp); g(gx + depth, 0, -hp, gx + depth, 0, hp);
    }
    const gm = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gl), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.75 }));
    this.root.add(gm);
  }

  /* ── Camera ──────────────────────────────────────────────────── */

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // Portrait phones: turn the pitch so play runs top→bottom.
    const portrait = w < h;
    const rot = portrait ? -Math.PI / 2 : 0;
    if (this.root.rotation.y !== rot) {
      this.root.rotation.y = rot;
      this.fit(true);
    } else if (this._lastAspect && Math.abs(this._lastAspect - this.camera.aspect) > 0.05) {
      this.fit();
    }
    this._lastAspect = this.camera.aspect;
  }

  fit(immediate = false) {
    const portrait = this.canvas.clientWidth < this.canvas.clientHeight;
    const tanV = Math.tan(((this.camera.fov * Math.PI) / 180) / 2);
    const tanH = tanV * this.camera.aspect;
    const halfLong = (L / 2) * 1.04, halfShort = (W / 2) * 1.45;
    const need = portrait
      ? Math.max(halfShort / tanH, halfLong / tanV)
      : Math.max(halfLong / tanH, halfShort / tanV);
    const dist = Math.min(Math.max(need, 6), 24);
    const elev = portrait ? 0.95 : 0.78; // radians above the pitch
    const target = new THREE.Vector3(0, 0, portrait ? 0 : 0.25);
    const pos = new THREE.Vector3(0, Math.sin(elev) * dist, Math.cos(elev) * dist).add(target);
    if (immediate) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
      return;
    }
    this._tween(this.controls.target, { x: target.x, y: target.y, z: target.z }, 800, easeInOut, 0, "cam:t");
    this._tween(this.camera.position, { x: pos.x, y: pos.y, z: pos.z }, 800, easeInOut, 0, "cam:p");
  }

  /* ── Lenses ──────────────────────────────────────────────────── */

  clear() {
    this._tweens = this._tweens.filter((t) => String(t.key).startsWith("cam:"));
    this.root.remove(this.layer);
    this.layer.traverse((o) => {
      if (o.material && o.material !== this._haloMat) o.material.dispose?.();
      if (o.geometry && o.geometry !== this._sphere && o.geometry !== this._cyl) o.geometry.dispose?.();
    });
    this.layer = new THREE.Group();
    this.root.add(this.layer);
    this._interactive = [];
    this.nodeById.clear();
    this.edgeMeshes = [];
    this.label.clear();
    this.hovered = null;
    this.pinned = null;
    this.pinnedB = null;
    this.mode = "default";
    this._hideTooltip();
    this.canvas.classList.remove("over-node");
    this.app.updateBackButton();
  }

  setAccent(hex) {
    this._accent = new THREE.Color(hex);
    document.documentElement.style.setProperty("--accent", hex);
  }

  /** Passing network: nodes at average on-ball position, tapered tubes passer→receiver. */
  showNetwork(network, color) {
    this.clear();
    this.setAccent(color);
    const nodes = network.nodes;
    const maxMin = Math.max(...nodes.map((n) => n.minutes), 1);
    nodes.forEach((node, i) => {
      const s = 0.9 + 1.5 * Math.sqrt(node.minutes / maxMin);
      const mat = new THREE.MeshToonMaterial({ color: this._accent, gradientMap: this._toon, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(this._sphere, mat);
      const p = toWorld(node.x, node.y);
      mesh.position.set(p.x, 0.1 * s, p.z);
      mesh.scale.setScalar(0.001);
      mesh.userData = { kind: "node", node, baseScale: s, opacity: 1 };
      mesh.renderOrder = 2;
      this.layer.add(mesh);
      this.nodeById.set(node.id, mesh);
      this._interactive.push(mesh);
      this._tween(mesh.scale, { x: s, y: s, z: s }, 600, easeOut, 100 + i * 40, `s:${node.id}`);
    });
    const maxC = Math.max(...network.edges.map((e) => e[2]), 1);
    const seen = new Set();
    for (const [a, b, count, prog] of network.edges) {
      const ma = this.nodeById.get(a), mb = this.nodeById.get(b);
      if (!ma || !mb) continue;
      const t = count / maxC;
      const color = INK.clone().lerp(BG, 0.6 * (1 - Math.sqrt(t)));
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(this._cyl, mat);
      // Both directions of a pair get a small sideways offset so they don't overlap.
      const twoWay = network.edges.some((e) => e[0] === b && e[1] === a);
      mesh.userData = { kind: "edge", a, b, count, prog, passer: ma, scorer: mb, radius: 0.011 + 0.034 * t, baseColor: color, side: twoWay ? 1 : 0, opacity: 1 };
      this.layer.add(mesh);
      this.edgeMeshes.push(mesh);
      this._tween(mesh.material, { opacity: 1 }, 700, easeOut, 400, `e:${a}:${b}`);
      seen.add(`${a}:${b}`);
    }
    this.label.rebuild(
      nodes.map((n) => ({ id: n.id, name: n.name, stat: `${n.passes} OUT · ${n.received} IN`, mesh: this.nodeById.get(n.id) })),
      (m) => this.setHovered(m),
      () => this.setHovered(null),
      (m) => this.handleClick(m)
    );
    this._applyDimming();
  }

  /** Shot map. mode: for | against | both. Against is mirrored onto the left goal. */
  showShots(shotsFor, shotsAgainst, mode, color, opponentNames) {
    this.clear();
    this.setAccent(color);
    const place = (shots, mirror, tint, delayBase) => {
      shots.forEach((s, i) => {
        const r = 0.035 + 0.24 * Math.sqrt(s.xg);
        const col = s.outcome === "goal" ? tint : s.outcome === "saved" ? INK : s.outcome === "blocked" ? BG.clone().lerp(INK, 0.35) : MUTED;
        const mat = new THREE.MeshToonMaterial({ color: col, gradientMap: this._toon, transparent: true, opacity: s.outcome === "goal" ? 1 : 0.85 });
        const mesh = new THREE.Mesh(this._sphere, mat);
        const p = toWorld(s.x, s.y, mirror);
        mesh.position.set(p.x, r, p.z);
        mesh.scale.setScalar(0.001);
        mesh.userData = { kind: "shot", shot: s, mirror, baseScale: r * 10, opponent: opponentNames[s.match] };
        this.layer.add(mesh);
        this._interactive.push(mesh);
        if (s.outcome === "goal") {
          // Local space of a 0.1-radius sphere: ring sits 1.7× out, scales with the dot.
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 10, 40), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9 }));
          ring.rotation.x = Math.PI / 2;
          mesh.add(ring);
        }
        this._tween(mesh.scale, { x: r * 10, y: r * 10, z: r * 10 }, 550, easeOut, delayBase + i * 12, `s:${mirror}:${i}`);
      });
    };
    if (mode === "for" || mode === "both") place(shotsFor, false, this._accent, 100);
    if (mode === "against" || mode === "both") place(shotsAgainst, true, INK.clone().lerp(this._accent, 0.15), 100);
  }

  /** Attack-vs-defence overlay: attacker's shots (filled), defender's conceded shots mirrored
      onto the same goal (rings) and the defender's defensive-action heat on the pitch. */
  showMatchup(attackShots, defendShotsConceded, defendGrid, attackColor, defendColor, names) {
    this.clear();
    this.setAccent(attackColor);
    const defend = new THREE.Color(defendColor);
    // Defensive-action heat: 6×5 grid in the defender's own coordinates (they attack
    // left→right in Opta terms), mirrored so their goal is the right-hand goal here.
    const maxG = Math.max(...defendGrid.flat(), 1);
    const tw = L / 6, th = W / 5;
    for (let gx = 0; gx < 6; gx++) {
      for (let gy = 0; gy < 5; gy++) {
        const v = defendGrid[gx][gy] / maxG;
        if (v <= 0) continue;
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.03, th - 0.03), new THREE.MeshBasicMaterial({ color: defend, transparent: true, opacity: 0.03 + 0.3 * v * v }));
        tile.rotation.x = -Math.PI / 2;
        const mx = 5 - gx, my = 4 - gy; // mirror
        tile.position.set(-L / 2 + (mx + 0.5) * tw, 0.006, W / 2 - (my + 0.5) * th);
        this.layer.add(tile);
      }
    }
    attackShots.forEach((s, i) => {
      const r = 0.035 + 0.24 * Math.sqrt(s.xg);
      const mat = new THREE.MeshToonMaterial({ color: this._accent, gradientMap: this._toon, transparent: true, opacity: s.outcome === "goal" ? 1 : 0.55 });
      const mesh = new THREE.Mesh(this._sphere, mat);
      const p = toWorld(s.x, s.y);
      mesh.position.set(p.x, r, p.z);
      mesh.scale.setScalar(r * 10);
      mesh.userData = { kind: "shot", shot: s, mirror: false, baseScale: r * 10, opponent: names.attack[s.match] };
      this.layer.add(mesh);
      this._interactive.push(mesh);
    });
    defendShotsConceded.forEach((s, i) => {
      const r = 0.035 + 0.24 * Math.sqrt(s.xg);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.012, r * 0.22), 8, 36), new THREE.MeshBasicMaterial({ color: defend, transparent: true, opacity: s.outcome === "goal" ? 1 : 0.6 }));
      ring.rotation.x = Math.PI / 2;
      const p = toWorld(s.x, s.y); // conceded shots are stored in the opponent's attacking frame → already toward the right goal
      ring.position.set(p.x, 0.02, p.z);
      ring.userData = { kind: "shot", shot: s, mirror: false, conceded: true, baseScale: 1, opponent: names.defend[s.match] };
      this.layer.add(ring);
      this._interactive.push(ring);
    });
  }

  /**
   * Territory relief — after three.js's webgl_geometry_terrain: a plane
   * displaced by a height field. Here the height field is where the team
   * touches the ball, defends, or shoots (36×24 counts per match),
   * Gaussian-smoothed; vertex colours run cream → team colour → ink.
   * The pitch markings are re-drawn draped over the surface.
   */
  showTerrain(surface, color, label) {
    this.clear();
    this.setAccent(color);
    const GX = 36, GY = 24;
    // Gaussian smoothing (σ ≈ 1.2 cells) so the relief reads as landscape, not a bar chart.
    const k = [0.06, 0.24, 0.4, 0.24, 0.06];
    const tmp = Array.from({ length: GX }, () => new Float32Array(GY));
    const sm = Array.from({ length: GX }, () => new Float32Array(GY));
    for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
      let v = 0;
      for (let i = -2; i <= 2; i++) { const xx = Math.min(GX - 1, Math.max(0, x + i)); v += k[i + 2] * surface[xx][y]; }
      tmp[x][y] = v;
    }
    let max = 0;
    for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
      let v = 0;
      for (let j = -2; j <= 2; j++) { const yy = Math.min(GY - 1, Math.max(0, y + j)); v += k[j + 2] * tmp[x][yy]; }
      sm[x][y] = v; if (v > max) max = v;
    }
    max = max || 1;
    const H = 1.35; // peak height in world units (13.5 m)
    const height = (u, v) => {
      // bilinear sample of the smoothed grid; u,v in [0,1] across the pitch
      const fx = Math.min(GX - 1.001, Math.max(0, u * GX - 0.5)), fy = Math.min(GY - 1.001, Math.max(0, v * GY - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const a = sm[x0][y0], b = sm[x0 + 1][y0], c = sm[x0][y0 + 1], d = sm[x0 + 1][y0 + 1];
      const val = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      // contrast stretch: everything under 20% of the peak reads as flat cream
      return Math.pow(Math.max(0, val / max - 0.2) / 0.8, 0.85);
    };
    const SEG_X = 108, SEG_Y = 72;
    const geo = new THREE.PlaneGeometry(L, W, SEG_X, SEG_Y);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const accent = new THREE.Color(color), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / L + 0.5, v = 0.5 - pos.getZ(i) / W;
      const h = height(u, v);
      pos.setY(i, h * H);
      // cream → accent (mid) → ink-tinted accent (peaks)
      if (h < 0.5) c.copy(TURF).lerp(accent, h * 2);
      else c.copy(accent).lerp(INK, (h - 0.5) * 0.7);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.position.y = 0.004;
    this.layer.add(mesh);
    // contour-like wire overlay at a coarser pitch for the printed-map feel
    const wire = new THREE.Mesh(new THREE.PlaneGeometry(L, W, 36, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: INK, wireframe: true, transparent: true, opacity: 0.08 }));
    const wp = wire.geometry.attributes.position;
    for (let i = 0; i < wp.count; i++) wp.setY(i, height(wp.getX(i) / L + 0.5, 0.5 - wp.getZ(i) / W) * H + 0.012);
    this.layer.add(wire);
    // drape the markings: subdivide each segment and lift it to the surface
    const draped = [];
    for (let i = 0; i < this._markings.length; i += 2) {
      const a = this._markings[i], b = this._markings[i + 1];
      const n = 8;
      for (let j = 0; j < n; j++) {
        for (const t of [j / n, (j + 1) / n]) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          draped.push(new THREE.Vector3(x, height(x / L + 0.5, 0.5 - z / W) * H + 0.02, z));
        }
      }
    }
    this.layer.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(draped), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 })));
    // rise-in: scale the layer's height from flat
    this.layer.scale.y = 0.001;
    this._tween(this.layer.scale, { y: 1 }, 900, easeOut, 80, "terrain:rise");
    this._terrainLabel = label;
  }

  /* ── Interaction ─────────────────────────────────────────────── */

  _bind() {
    this.canvas.addEventListener("pointermove", (e) => this._onMove(e));
    this.canvas.addEventListener("pointerleave", () => this.setHovered(null));
    this.canvas.addEventListener("pointerdown", (e) => (this._downPos = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener("pointerup", (e) => {
      const d = this._downPos; this._downPos = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      this._setPointer(e);
      this.handleClick(this._pick());
    });
    this.canvas.addEventListener("dblclick", () => this.fit());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) this.back();
    });
    window.addEventListener("resize", () => this.resize());
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    document.querySelector("[data-back]")?.addEventListener("click", () => this.back());
  }

  _setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this._lastClient = { x: e.clientX, y: e.clientY };
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this._interactive.filter((m) => m.visible), false);
    return hits.length ? hits[0].object : null;
  }

  _onMove(e) {
    this._setPointer(e);
    this.setHovered(this._pick());
  }

  setHovered(mesh) {
    if (this.hovered === mesh) {
      if (mesh?.userData.kind === "shot") this._showTooltip(mesh);
      return;
    }
    this.hovered = mesh;
    this.canvas.classList.toggle("over-node", !!mesh);
    if (mesh?.userData.kind === "shot") this._showTooltip(mesh);
    else this._hideTooltip();
    if (this.nodeById.size) this._applyDimming();
  }

  _showTooltip(mesh) {
    const { shot, opponent, conceded } = mesh.userData;
    const who = conceded ? `${shot.name} (${opponent})` : shot.name;
    this.tooltip.innerHTML =
      `<b>${esc(who)}</b> · ${shot.minute}'` +
      `<small>${esc(shot.outcome.toUpperCase())} · xG ${shot.xg.toFixed(2)} · ${esc(shot.situation)} · ${esc(shot.body)}${shot.big ? " · big chance" : ""}` +
      `${!conceded && opponent ? ` · v ${esc(opponent)}` : ""}</small>`;
    this.tooltip.hidden = false;
    const x = Math.min(window.innerWidth - 270, (this._lastClient?.x ?? 0) + 14);
    const y = Math.max(8, (this._lastClient?.y ?? 0) - 10);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  _hideTooltip() {
    if (this.tooltip) this.tooltip.hidden = true;
  }

  handleClick(mesh) {
    if (!mesh || mesh.userData.kind !== "node") return;
    if (this.mode === "default") this.pin(mesh);
    else if (this.mode === "single") {
      if (mesh === this.pinned) this.back();
      else this.pinPair(mesh);
    } else if (mesh === this.pinnedB) this.back();
  }

  pin(mesh) {
    this.pinned = mesh;
    this.pinnedB = null;
    this.mode = "single";
    this.app.notePinned();
    this._setFocusStats();
    this._applyDimming();
    this.app.updateBackButton();
    this.app.onPin(mesh.userData.node.id, null);
  }

  pinPair(meshB) {
    this.pinnedB = meshB;
    this.mode = "pair";
    this._setFocusStats();
    this._applyDimming();
    this.app.updateBackButton();
    this.app.onPin(this.pinned.userData.node.id, meshB.userData.node.id);
  }

  back() {
    if (this.mode === "pair") {
      this.pinnedB = null;
      this.mode = "single";
      this._setFocusStats();
      this._applyDimming();
      this.app.updateBackButton();
      this.app.onPin(this.pinned.userData.node.id, null);
    } else if (this.mode === "single") {
      this.pinned = null;
      this.mode = "default";
      this.label.resetStats();
      this._applyDimming();
      this.app.updateBackButton();
      this.app.onPin(null, null);
    }
  }

  _neighbours(mesh) {
    const id = mesh.userData.node.id;
    const out = new Map();
    for (const e of this.edgeMeshes) {
      const { a, b, count } = e.userData;
      if (a === id) out.set(b, (out.get(b) || 0) + count);
      else if (b === id) out.set(a, (out.get(a) || 0) + count);
    }
    return out;
  }

  _edgeCount(a, b) {
    const e = this.edgeMeshes.find((m) => m.userData.a === a && m.userData.b === b);
    return e ? e.userData.count : 0;
  }

  _setFocusStats() {
    this.label.resetStats();
    if (!this.pinned) return;
    const pid = this.pinned.userData.node.id;
    if (this.mode === "pair") {
      const bid = this.pinnedB.userData.node.id;
      this.label.setStat(pid, `${this._edgeCount(pid, bid)} TO · ${this._edgeCount(bid, pid)} FROM`);
      this.label.setStat(bid, `${this._edgeCount(bid, pid)} TO · ${this._edgeCount(pid, bid)} FROM`);
      return;
    }
    for (const nid of this._neighbours(this.pinned).keys()) {
      this.label.setStat(nid, `${this._edgeCount(pid, nid)} FROM · ${this._edgeCount(nid, pid)} TO`);
    }
  }

  _applyDimming() {
    const states = new Map();
    const hoverId = this.hovered?.userData.kind === "node" ? this.hovered.userData.node.id : null;
    const pinId = this.pinned?.userData.node.id;
    const pinBId = this.pinnedB?.userData.node.id;
    const DIM = 0.14;
    let keepEdge;
    if (this.mode === "pair") {
      keepEdge = (a, b) => (a === pinId && b === pinBId) || (a === pinBId && b === pinId);
      for (const m of this.nodeById.values()) {
        const id = m.userData.node.id;
        const keep = id === pinId || id === pinBId;
        this._fadeNode(m, keep ? 1 : DIM);
        states.set(id, keep ? "pinned" : "dimmed");
      }
    } else if (this.mode === "single") {
      const neigh = this._neighbours(this.pinned);
      keepEdge = (a, b) => a === pinId || b === pinId;
      for (const m of this.nodeById.values()) {
        const id = m.userData.node.id;
        const keep = id === pinId || neigh.has(id);
        this._fadeNode(m, keep ? 1 : DIM);
        states.set(id, id === pinId ? "pinned" : keep ? (id === hoverId ? "hover" : "") : "dimmed");
      }
    } else if (hoverId) {
      const neigh = this._neighbours(this.hovered);
      keepEdge = (a, b) => a === hoverId || b === hoverId;
      for (const m of this.nodeById.values()) {
        const id = m.userData.node.id;
        const keep = id === hoverId || neigh.has(id);
        this._fadeNode(m, keep ? 1 : DIM);
        states.set(id, id === hoverId ? "hover" : keep ? "" : "dimmed");
      }
    } else {
      keepEdge = () => true;
      for (const m of this.nodeById.values()) this._fadeNode(m, 1);
    }
    for (const e of this.edgeMeshes) {
      const { a, b, baseColor } = e.userData;
      const keep = keepEdge(a, b);
      let color = baseColor;
      if (keep && this.mode !== "default") color = a === pinId || a === pinBId ? this._accent : this._accent.clone().lerp(INK, 0.55);
      e.material.color.copy(color);
      this._tween(e.material, { opacity: keep ? 1 : 0.06 }, 280, easeOut, 0, `eo:${a}:${b}`);
    }
    this.label.setStates(states);
  }

  _fadeNode(mesh, opacity) {
    const ud = mesh.userData;
    if (ud.opacity === opacity) return;
    ud.opacity = opacity;
    this._tween(mesh.material, { opacity }, 280, easeOut, 0, `no:${ud.node.id}`);
  }

  /* ── Frame loop ──────────────────────────────────────────────── */

  _syncEdges() {
    const { a, b, d, q, n } = this._tmp;
    for (const em of this.edgeMeshes) {
      const { passer, scorer, radius, side } = em.userData;
      a.copy(passer.position);
      b.copy(scorer.position);
      a.y = b.y = 0.05;
      d.subVectors(b, a);
      const dist = d.length();
      const ga = 0.1 * passer.scale.x * 1.25, gb = 0.1 * scorer.scale.x * 1.25;
      const len = Math.max(0.01, dist - ga - gb);
      d.normalize();
      q.setFromUnitVectors(UP, d);
      em.quaternion.copy(q);
      em.position.copy(a).addScaledVector(d, ga + len / 2);
      if (side) {
        n.set(-d.z, 0, d.x).multiplyScalar(0.045);
        em.position.add(n);
      }
      em.scale.set(radius, len, radius);
    }
  }

  _tween(obj, to, duration, ease = easeInOut, delay = 0, key = null, onDone = null) {
    if (key) this._tweens = this._tweens.filter((t) => t.key !== key);
    const from = {};
    for (const k of Object.keys(to)) from[k] = obj[k];
    this._tweens.push({ obj, from, to, duration, ease, start: performance.now() + delay, key, onDone });
  }

  _runTweens() {
    if (!this._tweens.length) return;
    const now = performance.now();
    const keep = [];
    for (const t of this._tweens) {
      if (now < t.start) { keep.push(t); continue; }
      const p = Math.min(1, (now - t.start) / t.duration);
      const e = t.ease(p);
      for (const k of Object.keys(t.to)) t.obj[k] = t.from[k] + (t.to[k] - t.from[k]) * e;
      if (p < 1) keep.push(t);
      else t.onDone?.();
    }
    this._tweens = keep;
  }

  _animate() {
    requestAnimationFrame(this._animate);
    this._runTweens();
    this._syncEdges();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.label.update();
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
