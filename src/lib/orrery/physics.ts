export const G = 900;
export const DT = 1 / 120;
export const TRAIL_POINTS = 168;

const EPS = 2.4;
const EPS2 = EPS * EPS;
const MAX_BODIES = 56;

export type Kind = "dust" | "moon" | "planet" | "giant" | "star";
export type CollisionMode = "merge" | "bounce";
export type PresetId = "dust" | "moon" | "planet" | "giant" | "star";
export type SimEvent = "merge" | "sling";

export const PRESETS: { id: PresetId; label: string; mass: number; kind: Kind }[] = [
  { id: "dust", label: "尘埃", mass: 1.6, kind: "dust" },
  { id: "moon", label: "卫星", mass: 4.2, kind: "moon" },
  { id: "planet", label: "行星", mass: 15, kind: "planet" },
  { id: "giant", label: "气巨", mass: 58, kind: "giant" },
  { id: "star", label: "恒星", mass: 480, kind: "star" },
];

export function kindFor(mass: number): Kind {
  if (mass >= 180) return "star";
  if (mass >= 36) return "giant";
  if (mass >= 8) return "planet";
  if (mass >= 3) return "moon";
  return "dust";
}

export function radiusFor(mass: number): number {
  if (mass >= 180) return 17 + Math.cbrt(mass) * 0.72;
  if (mass >= 36) return 8.2 + Math.cbrt(mass) * 0.62;
  if (mass >= 8) return 5.2 + Math.cbrt(mass) * 0.72;
  return Math.max(3, 2.5 + Math.cbrt(mass) * 0.85);
}

export type Body = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  mass: number;
  radius: number;
  color: number;
  kind: Kind;
  trail: Float32Array;
  trailCount: number;
  trailHead: number;
  prevSpeed: number;
  age: number;
  cooldown: number;
};

export type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
};

export function formatEnergy(e: number): string {
  if (!Number.isFinite(e)) return "—";
  const a = Math.abs(e);
  if (a >= 10000 || (a > 0 && a < 0.01)) return e.toExponential(1);
  return Math.round(e).toLocaleString("en-US");
}

export class World {
  bodies: Body[] = [];
  particles: Spark[] = [];
  collision: CollisionMode = "merge";
  trails = true;
  shake = 0;
  time = 0;
  dirty = true;
  events: SimEvent[] = [];
  pinned: Body | null = null;
  pinX = 0;
  pinY = 0;
  nextId = 1;
  colorSeq = 0;
  private trailPhase = 0;

  private scratch = {
    x: new Float64Array(MAX_BODIES),
    y: new Float64Array(MAX_BODIES),
    vx: new Float64Array(MAX_BODIES),
    vy: new Float64Array(MAX_BODIES),
    ax: new Float64Array(MAX_BODIES),
    ay: new Float64Array(MAX_BODIES),
    m: new Float64Array(MAX_BODIES),
  };

  add(init: {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    mass: number;
    kind?: Kind;
    color?: number;
    radius?: number;
  }): Body | null {
    if (this.bodies.length >= MAX_BODIES) return null;
    const kind = init.kind ?? kindFor(init.mass);
    let color = init.color;
    if (kind === "star") color = 0;
    else if (color === undefined) {
      color = (this.colorSeq % 4) + 1;
      this.colorSeq += 1;
    }
    const vx = init.vx ?? 0;
    const vy = init.vy ?? 0;
    const body: Body = {
      id: this.nextId++,
      x: init.x,
      y: init.y,
      vx,
      vy,
      ax: 0,
      ay: 0,
      mass: init.mass,
      radius: init.radius ?? radiusFor(init.mass),
      color,
      kind,
      trail: new Float32Array(TRAIL_POINTS * 2),
      trailCount: 0,
      trailHead: 0,
      prevSpeed: Math.hypot(vx, vy),
      age: 0,
      cooldown: 0,
    };
    this.bodies.push(body);
    this.dirty = true;
    return body;
  }

  clear() {
    this.bodies.length = 0;
    this.particles.length = 0;
    this.events.length = 0;
    this.pinned = null;
    this.shake = 0;
    this.time = 0;
    this.dirty = true;
    this.trailPhase = 0;
  }

  removeAt(index: number) {
    const removed = this.bodies[index];
    const last = this.bodies.length - 1;
    if (index !== last) this.bodies[index] = this.bodies[last];
    this.bodies.pop();
    if (this.pinned === removed) this.pinned = null;
    this.dirty = true;
  }

  removeId(id: number) {
    const i = this.bodies.findIndex((b) => b.id === id);
    if (i >= 0) this.removeAt(i);
  }

  pick(x: number, y: number, zoom: number): Body | null {
    let best: Body | null = null;
    let bestD = Infinity;
    for (const b of this.bodies) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d <= b.radius + 12 / zoom && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  energy(): number {
    let ke = 0;
    let pe = 0;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      ke += 0.5 * bi.mass * (bi.vx * bi.vx + bi.vy * bi.vy);
      for (let j = i + 1; j < bodies.length; j++) {
        const bj = bodies[j];
        const dx = bj.x - bi.x;
        const dy = bj.y - bi.y;
        pe -= (G * bi.mass * bj.mass) / Math.sqrt(dx * dx + dy * dy + EPS2);
      }
    }
    return ke + pe;
  }

  step(dt: number) {
    if (this.dirty) {
      this.accelerations();
      this.dirty = false;
    }
    this.kick(dt * 0.5);
    this.drift(dt);
    if (this.pinned) {
      this.pinned.x = this.pinX;
      this.pinned.y = this.pinY;
      this.pinned.vx = 0;
      this.pinned.vy = 0;
    }
    this.accelerations();
    this.kick(dt * 0.5);
    if (this.pinned) {
      this.pinned.vx = 0;
      this.pinned.vy = 0;
    }
    this.collide();
    if (this.dirty) {
      this.accelerations();
      this.dirty = false;
    }
    this.recordTrail();
    this.sense(dt);
    this.simParticles(dt);
    this.cull();
    this.shake *= Math.exp(-3.2 * dt);
    this.time += dt;
  }

  /** Short mutual preview. Writes ghost positions into `out`. */
  predict(gx: number, gy: number, gvx: number, gvy: number, gmass: number, out: Float32Array): number {
    const n = this.bodies.length;
    if (n + 1 > MAX_BODIES) return 0;
    const { x, y, vx, vy, ax, ay, m } = this.scratch;
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      x[i] = b.x;
      y[i] = b.y;
      vx[i] = b.vx;
      vy[i] = b.vy;
      m[i] = b.mass;
    }
    const g = n;
    x[g] = gx;
    y[g] = gy;
    vx[g] = gvx;
    vy[g] = gvy;
    m[g] = gmass;
    const count = n + 1;
    const sub = 1 / 30;
    const steps = 96;
    let written = 0;
    const accel = () => {
      for (let i = 0; i < count; i++) {
        ax[i] = 0;
        ay[i] = 0;
      }
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const r2 = dx * dx + dy * dy + EPS2;
          const inv = G / (r2 * Math.sqrt(r2));
          ax[i] += dx * inv * m[j];
          ay[i] += dy * inv * m[j];
          ax[j] -= dx * inv * m[i];
          ay[j] -= dy * inv * m[i];
        }
      }
    };
    accel();
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < count; i++) {
        vx[i] += ax[i] * sub * 0.5;
        vy[i] += ay[i] * sub * 0.5;
        x[i] += vx[i] * sub;
        y[i] += vy[i] * sub;
      }
      accel();
      for (let i = 0; i < count; i++) {
        vx[i] += ax[i] * sub * 0.5;
        vy[i] += ay[i] * sub * 0.5;
      }
      if ((s & 1) === 0 && written < out.length / 2) {
        out[written * 2] = x[g];
        out[written * 2 + 1] = y[g];
        written += 1;
      }
    }
    return written;
  }

  private accelerations() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].ax = 0;
      bodies[i].ay = 0;
    }
    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const bj = bodies[j];
        const dx = bj.x - bi.x;
        const dy = bj.y - bi.y;
        const r2 = dx * dx + dy * dy + EPS2;
        const inv = G / (r2 * Math.sqrt(r2));
        const ax = dx * inv;
        const ay = dy * inv;
        bi.ax += ax * bj.mass;
        bi.ay += ay * bj.mass;
        bj.ax -= ax * bi.mass;
        bj.ay -= ay * bi.mass;
      }
    }
  }

  private kick(dt: number) {
    for (const b of this.bodies) {
      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
    }
  }

  private drift(dt: number) {
    for (const b of this.bodies) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  private collide() {
    const bodies = this.bodies;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const bi = bodies[i];
          const bj = bodies[j];
          if (bi === this.pinned || bj === this.pinned) continue;
          const dx = bj.x - bi.x;
          const dy = bj.y - bi.y;
          const dist = Math.hypot(dx, dy);
          const min = bi.radius + bj.radius;
          if (dist >= min) continue;
          hit = true;
          const nx = dist > 1e-6 ? dx / dist : 1;
          const ny = dist > 1e-6 ? dy / dist : 0;
          if (this.collision === "merge") {
            this.merge(i, j);
            j -= 1;
          } else {
            this.bounce(bi, bj, nx, ny, dist, min);
          }
        }
      }
      if (!hit) break;
    }
  }

  private merge(i: number, j: number) {
    const bodies = this.bodies;
    const bi = bodies[i];
    const bj = bodies[j];
    const heavier = bi.mass >= bj.mass ? bi : bj;
    const M = bi.mass + bj.mass;
    const x = (bi.x * bi.mass + bj.x * bj.mass) / M;
    const y = (bi.y * bi.mass + bj.y * bj.mass) / M;
    bi.vx = (bi.vx * bi.mass + bj.vx * bj.mass) / M;
    bi.vy = (bi.vy * bi.mass + bj.vy * bj.mass) / M;
    bi.x = x;
    bi.y = y;
    bi.mass = M;
    bi.radius = radiusFor(M);
    bi.kind = kindFor(M);
    bi.color = bi.kind === "star" ? 0 : heavier.color;
    bi.trailCount = 0;
    bi.trailHead = 0;
    bi.prevSpeed = Math.hypot(bi.vx, bi.vy);
    this.burst(x, y, bi.color, M > 40 ? 18 : 10, 36);
    if (M > 28) this.shake = Math.min(12, this.shake + Math.min(7, M * 0.015));
    if (this.events.length < 6) this.events.push("merge");
    this.removeAt(j);
  }

  private bounce(bi: Body, bj: Body, nx: number, ny: number, dist: number, min: number) {
    const rel = (bi.vx - bj.vx) * nx + (bi.vy - bj.vy) * ny;
    if (rel > 0) {
      const e = 0.76;
      const impulse = ((1 + e) * rel) / (1 / bi.mass + 1 / bj.mass);
      bi.vx -= (impulse * nx) / bi.mass;
      bi.vy -= (impulse * ny) / bi.mass;
      bj.vx += (impulse * nx) / bj.mass;
      bj.vy += (impulse * ny) / bj.mass;
      if (rel > 18) this.burst((bi.x + bj.x) / 2, (bi.y + bj.y) / 2, bi.color, 6, rel);
    }
    const overlap = min - Math.max(dist, 1e-6);
    if (overlap > 0) {
      const inv = 1 / (bi.mass + bj.mass);
      const corr = overlap + 0.04;
      bi.x -= nx * corr * bj.mass * inv;
      bi.y -= ny * corr * bj.mass * inv;
      bj.x += nx * corr * bi.mass * inv;
      bj.y += ny * corr * bi.mass * inv;
    }
    this.dirty = true;
  }

  private recordTrail() {
    if (!this.trails) return;
    this.trailPhase += 1;
    if ((this.trailPhase & 1) !== 0) return;
    const stride = TRAIL_POINTS * 2;
    for (const b of this.bodies) {
      b.trail[b.trailHead] = b.x;
      b.trail[b.trailHead + 1] = b.y;
      b.trailHead = (b.trailHead + 2) % stride;
      if (b.trailCount < TRAIL_POINTS) b.trailCount += 1;
    }
  }

  private sense(dt: number) {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      const sp = Math.hypot(bi.vx, bi.vy);
      const prev = bi.prevSpeed;
      bi.prevSpeed = sp;
      bi.age += dt;
      if (bi.cooldown > 0) bi.cooldown -= dt;
      if (bi.age < 0.7 || bi.cooldown > 0 || prev < 12) continue;
      if (sp < prev * 1.38 || sp - prev < 9) continue;
      let near = false;
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        const bj = bodies[j];
        if (bj.mass < bi.mass * 3) continue;
        const d = Math.hypot(bj.x - bi.x, bj.y - bi.y);
        if (d < bj.radius * 6 + 90) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      bi.cooldown = 2.2;
      if (this.events.length < 6) this.events.push("sling");
      this.burst(bi.x, bi.y, bi.color, 8, sp * 0.25);
    }
  }

  private burst(x: number, y: number, color: number, n: number, speed: number) {
    for (let k = 0; k < n && this.particles.length < 220; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = 8 + Math.random() * speed;
      const life = 0.35 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        color,
      });
    }
  }

  private simParticles(dt: number) {
    const p = this.particles;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const s = p[i];
      s.life -= dt;
      if (s.life <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      p[w] = s;
      w += 1;
    }
    p.length = w;
  }

  private cull() {
    const lim = 9000 * 9000;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b === this.pinned) continue;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      const far = b.x * b.x + b.y * b.y > lim;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.vx) || sp2 > 4e8 || far) this.removeAt(i);
    }
  }
}

export function separate(world: World, body: Body) {
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    for (const other of world.bodies) {
      if (other === body) continue;
      const dx = body.x - other.x;
      const dy = body.y - other.y;
      const min = body.radius + other.radius + 0.6;
      const dist = Math.hypot(dx, dy);
      if (dist < min) {
        const nx = dist < 1e-6 ? 1 : dx / dist;
        const ny = dist < 1e-6 ? 0 : dy / dist;
        body.x = other.x + nx * min;
        body.y = other.y + ny * min;
        moved = true;
      }
    }
    if (!moved) break;
  }
  world.dirty = true;
}

export function clearTrails(world: World) {
  for (const b of world.bodies) {
    b.trailCount = 0;
    b.trailHead = 0;
  }
}
