import * as THREE from "three";

/** HTML labels projected under 3D objects every frame. */
export default class Label {
  constructor(container, camera, canvas) {
    this.container = container;
    this.camera = camera;
    this.canvas = canvas;
    this.entries = new Map();
    this._v = new THREE.Vector3();
  }

  rebuild(items, onEnter, onLeave, onClick) {
    this.clear();
    for (const it of items) {
      const el = document.createElement("div");
      el.className = "label";
      const name = document.createElement("span");
      name.className = "label-name";
      name.textContent = it.name;
      const stat = document.createElement("span");
      stat.className = "label-stat";
      stat.textContent = it.stat;
      el.append(name, stat);
      el.addEventListener("pointerenter", () => onEnter(it.mesh));
      el.addEventListener("pointerleave", () => onLeave());
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(it.mesh);
      });
      this.container.appendChild(el);
      this.entries.set(it.id, { el, stat, mesh: it.mesh, defaultStat: it.stat });
    }
  }

  clear() {
    this.container.innerHTML = "";
    this.entries.clear();
  }

  setStat(id, text) {
    const e = this.entries.get(id);
    if (e) e.stat.textContent = text ?? e.defaultStat;
  }

  resetStats() {
    for (const e of this.entries.values()) e.stat.textContent = e.defaultStat;
  }

  setStates(states) {
    for (const [id, e] of this.entries) {
      const s = states.get(id) || "";
      e.el.classList.toggle("dimmed", s === "dimmed");
      e.el.classList.toggle("hidden", s === "hidden");
      e.el.classList.toggle("pinned", s === "pinned");
      e.el.classList.toggle("hover", s === "hover");
    }
  }

  update() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const e of this.entries.values()) {
      const m = e.mesh;
      if (!m || !m.visible) {
        e.el.style.display = "none";
        continue;
      }
      m.getWorldPosition(this._v);
      this._v.project(this.camera);
      if (this._v.z > 1) {
        e.el.style.display = "none";
        continue;
      }
      // Sit just under the dot: a pixel offset that grows with the dot's scale.
      const dy = 6 + 5 * m.scale.x;
      e.el.style.display = "";
      e.el.style.transform = `translate(${((this._v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this._v.y * 0.5 + 0.5) * h + dy).toFixed(1)}px) translate(-50%, 0)`;
    }
  }
}
