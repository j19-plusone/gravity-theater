import { DT, G, World } from "../src/lib/orrery/physics.ts";
import { EIGHT_PERIOD, buildScenario } from "../src/lib/orrery/scenarios.ts";

function run(world: World, seconds: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) world.step(DT);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Two-body attraction sign.
{
  const w = new World();
  w.add({ x: -10, y: 0, mass: 10, kind: "planet" });
  w.add({ x: 10, y: 0, mass: 10, kind: "planet" });
  w.step(DT);
  assert(w.bodies[0].ax > 0 && w.bodies[1].ax < 0, "force should pull bodies together");
}

// Circular orbit stays near its radius.
{
  const w = new World();
  const M = 500;
  const r = 140;
  const v = Math.sqrt((G * M) / r);
  w.add({ x: 0, y: 0, mass: M, kind: "star" });
  w.add({ x: r, y: 0, vx: 0, vy: v, mass: 8, kind: "planet" });
  const e0 = w.energy();
  run(w, 12);
  const star = w.bodies.reduce((a, b) => (a.mass > b.mass ? a : b));
  const planet = w.bodies.find((b) => b !== star)!;
  const dist = Math.hypot(planet.x - star.x, planet.y - star.y);
  const drift = Math.abs(w.energy() - e0) / Math.abs(e0);
  console.log("orbit", dist.toFixed(2), "energyDrift", drift.toExponential(2), "n", w.bodies.length);
  assert(w.bodies.length === 2, "orbit pair merged");
  assert(Math.abs(dist - r) / r < 0.08, `radius wandered to ${dist}`);
  assert(drift < 0.01, `energy drift ${drift}`);
}

// Figure-eight returns after one period.
{
  const w = new World();
  buildScenario(w, "eight");
  const start = w.bodies.map((b) => ({ x: b.x, y: b.y }));
  run(w, EIGHT_PERIOD);
  let err = 0;
  for (const b of w.bodies) {
    let best = Infinity;
    for (const s of start) best = Math.min(best, Math.hypot(b.x - s.x, b.y - s.y));
    err = Math.max(err, best);
  }
  console.log("eight", "n", w.bodies.length, "returnErr", err.toFixed(2));
  assert(w.bodies.length === 3, "figure-eight collided");
  assert(err < 12, `figure-eight return error ${err}`);
}

// Lagrange triangle holds.
{
  const w = new World();
  buildScenario(w, "triangle");
  const startR = distances(w);
  run(w, 8);
  const later = distances(w);
  console.log("triangle", startR.map((n) => n.toFixed(1)).join(","), "->", later.map((n) => n.toFixed(1)).join(","));
  assert(w.bodies.length === 3, "triangle merged");
  for (let i = 0; i < 3; i++) {
    assert(Math.abs(later[i] - startR[i]) / startR[i] < 0.12, `triangle side drifted ${later[i]} vs ${startR[i]}`);
  }
}

// Scenarios stay finite.
for (const id of ["system", "binary", "sling", "chaos"] as const) {
  const w = new World();
  buildScenario(w, id);
  const n0 = w.bodies.length;
  run(w, id === "sling" ? 10 : id === "system" ? 18 : 8);
  const finite = w.bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.vx));
  console.log(id, "n", n0, "->", w.bodies.length, "E", w.energy().toExponential(2));
  assert(finite, `${id} blew up`);
  assert(w.bodies.length === n0, `${id} lost bodies ${n0} -> ${w.bodies.length}`);
}

// Slingshot: comet should gain speed or turn sharply.
{
  const w = new World();
  buildScenario(w, "sling");
  const comet = w.bodies.reduce((a, b) => (a.mass < b.mass ? a : b));
  const v0 = Math.hypot(comet.vx, comet.vy);
  let maxV = v0;
  const heading0 = Math.atan2(comet.vy, comet.vx);
  for (let i = 0; i < Math.round(10 / DT); i++) {
    w.step(DT);
    const c = w.bodies.find((b) => b.id === comet.id);
    if (!c) break;
    maxV = Math.max(maxV, Math.hypot(c.vx, c.vy));
  }
  const c = w.bodies.find((b) => b.id === comet.id);
  const heading1 = c ? Math.atan2(c.vy, c.vx) : heading0;
  let turn = Math.abs(heading1 - heading0);
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  console.log("sling v0", v0.toFixed(1), "max", maxV.toFixed(1), "turn", ((turn * 180) / Math.PI).toFixed(0));
  assert(c != null, "comet lost");
  assert(maxV > v0 * 1.05 || turn > 0.5, "slingshot was too gentle");
}

function distances(world: World) {
  const b = world.bodies;
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) out.push(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y));
  }
  return out.sort((a, c) => a - c);
}

console.log("orrery selftest ok");
