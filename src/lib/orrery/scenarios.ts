import { G, type CollisionMode, type World } from "./physics.ts";

export type ScenarioId = "system" | "binary" | "eight" | "sling" | "triangle" | "chaos";

export const EIGHT_PERIOD = 16;

export const SCENARIOS: { id: ScenarioId; label: string; title: string }[] = [
  { id: "system", label: "行星系", title: "一颗恒星、几条轨道、一颗卫星" },
  { id: "binary", label: "双星", title: "两颗恒星互相绕转" },
  { id: "eight", label: "八字舞", title: "三体周期编舞" },
  { id: "sling", label: "弹弓", title: "轻天体借行星加速" },
  { id: "triangle", label: "三角", title: "拉格朗日等边编舞" },
  { id: "chaos", label: "混沌", title: "差一点就散开" },
];

const PREROLL: Record<ScenarioId, number> = {
  system: 2.2,
  binary: 1.1,
  eight: 2.4,
  sling: 0.15,
  triangle: 1.4,
  chaos: 0.45,
};

export function buildScenario(world: World, id: ScenarioId) {
  world.clear();
  if (id === "system") system(world);
  else if (id === "binary") binary(world);
  else if (id === "eight") eight(world);
  else if (id === "sling") sling(world);
  else if (id === "triangle") triangle(world, false);
  else triangle(world, true);
  neutralize(world);
}

export function applyScenario(world: World, id: ScenarioId) {
  buildScenario(world, id);
  const steps = Math.round(PREROLL[id] / (1 / 120));
  const dt = 1 / 120;
  for (let i = 0; i < steps; i++) world.step(dt);
  world.shake = 0;
  world.events.length = 0;
  world.particles.length = 0;
  for (const b of world.bodies) b.cooldown = 0;
}

function neutralize(world: World) {
  let m = 0;
  let px = 0;
  let py = 0;
  let cx = 0;
  let cy = 0;
  for (const b of world.bodies) {
    m += b.mass;
    px += b.mass * b.vx;
    py += b.mass * b.vy;
    cx += b.mass * b.x;
    cy += b.mass * b.y;
  }
  if (m === 0) return;
  const vx = px / m;
  const vy = py / m;
  const x = cx / m;
  const y = cy / m;
  for (const b of world.bodies) {
    b.vx -= vx;
    b.vy -= vy;
    b.x -= x;
    b.y -= y;
    b.prevSpeed = Math.hypot(b.vx, b.vy);
  }
  world.dirty = true;
}

function system(world: World) {
  world.collision = "merge";
  const M = 640;
  world.add({ x: 0, y: 0, mass: M, kind: "star" });
  const rows: {
    r: number;
    mass: number;
    kind: "moon" | "planet" | "giant";
    color: number;
    ang: number;
    moon?: boolean;
    radius?: number;
  }[] = [
    { r: 108, mass: 3.2, kind: "moon", color: 1, ang: 0.4 },
    { r: 178, mass: 7, kind: "planet", color: 3, ang: 1.7 },
    { r: 262, mass: 9, kind: "planet", color: 2, ang: 3.15, moon: true },
    { r: 380, mass: 16, kind: "giant", color: 4, ang: 4.5, radius: 14 },
    { r: 530, mass: 6, kind: "planet", color: 1, ang: 5.7 },
  ];
  for (const s of rows) {
    const v = Math.sqrt((G * M) / s.r);
    const rx = Math.cos(s.ang);
    const ry = Math.sin(s.ang);
    const x = rx * s.r;
    const y = ry * s.r;
    const vx = -ry * v;
    const vy = rx * v;
    const planet = world.add({
      x,
      y,
      vx,
      vy,
      mass: s.mass,
      kind: s.kind,
      color: s.color,
      radius: s.radius,
    });
    if (s.moon && planet) {
      const d = 20;
      const mv = Math.sqrt((G * s.mass) / d);
      world.add({
        x: x + rx * d,
        y: y + ry * d,
        vx: vx - ry * mv,
        vy: vy + rx * mv,
        mass: 1.4,
        kind: "moon",
        color: 2,
      });
    }
  }
}

function binary(world: World) {
  world.collision = "merge";
  const M = 240;
  const d = 156;
  const v = Math.sqrt((G * M) / (2 * d));
  world.add({ x: -d / 2, y: 0, vx: 0, vy: v, mass: M, kind: "star" });
  world.add({ x: d / 2, y: 0, vx: 0, vy: -v, mass: M, kind: "star" });
  const r = 430;
  const vc = Math.sqrt((G * 2 * M) / r);
  world.add({ x: r, y: 0, vx: 0, vy: vc, mass: 11, kind: "planet", color: 2 });
  world.add({ x: -r * 0.62, y: 28, vx: -4, vy: -vc * 0.78, mass: 4.5, kind: "moon", color: 3 });
}

function eight(world: World) {
  world.collision = "merge";
  const m = 36;
  const T0 = 6.32591398;
  const tau = EIGHT_PERIOD / T0;
  const S = Math.cbrt(tau * tau * G * m);
  const vS = S / tau;
  const x1 = 0.97000436 * S;
  const y1 = -0.24308753 * S;
  const vx = 0.466203685 * vS;
  const vy = 0.43236573 * vS;
  world.add({ x: x1, y: y1, vx, vy, mass: m, kind: "planet", color: 1 });
  world.add({ x: -x1, y: -y1, vx, vy, mass: m, kind: "planet", color: 2 });
  world.add({ x: 0, y: 0, vx: -2 * vx, vy: -2 * vy, mass: m, kind: "planet", color: 3 });
}

function sling(world: World) {
  world.collision = "merge";
  const M = 500;
  world.add({ x: 0, y: 0, mass: M, kind: "star" });
  const R = 172;
  const vp = Math.sqrt((G * M) / R);
  world.add({ x: R, y: 0, vx: 0, vy: vp, mass: 18, kind: "planet", color: 2 });
  // Incoming moon, tuned so it swings past the planet's trailing side.
  world.add({
    x: 60,
    y: 520,
    vx: 8,
    vy: -40,
    mass: 2.5,
    kind: "moon",
    color: 3,
  });
}

function triangle(world: World, chaos: boolean) {
  world.collision = (chaos ? "bounce" : "merge") satisfies CollisionMode;
  const A = chaos ? 84 : 72;
  const m = 26;
  const R = A / Math.sqrt(3);
  const v = Math.sqrt((G * m) / A);
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    const body = world.add({
      x: Math.cos(ang) * R,
      y: Math.sin(ang) * R,
      vx: -Math.sin(ang) * v,
      vy: Math.cos(ang) * v,
      mass: m,
      kind: "planet",
      color: i + 1,
    });
    if (!body || !chaos) continue;
    if (i === 0) {
      body.vx *= 0.58;
      body.vy *= 0.58;
    } else if (i === 1) {
      body.vx += 7;
    }
  }
}
