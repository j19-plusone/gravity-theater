import { TRAIL_POINTS, type Body, type World } from "@/lib/orrery/physics";

export type Camera = { x: number; y: number; zoom: number };

export type Aim = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mass: number;
  color: number;
  radius: number;
  speed: number;
  path: Float32Array;
  count: number;
};

type StarDot = { x: number; y: number; z: number; r: number; a: number; warm: boolean };

const PALETTE = [
  { core: "#fff6df", mid: "#f2c27a", edge: "#c47a32", rgb: "242,194,122" },
  { core: "#f6f1e6", mid: "#d9cbb6", edge: "#8a7864", rgb: "217,203,182" },
  { core: "#e7f6f3", mid: "#8fd0c6", edge: "#2c6c66", rgb: "143,208,198" },
  { core: "#fbeee6", mid: "#e7a58f", edge: "#9a4e3c", rgb: "231,165,143" },
  { core: "#eef2e6", mid: "#c5d1a6", edge: "#5c6b4e", rgb: "197,209,166" },
];

export function makeStarfield(n = 150): StarDot[] {
  let s = 1_234_567;
  const rnd = () => {
    s = (s * 16807) % 2_147_483_647;
    return (s - 1) / 2_147_483_646;
  };
  const dots: StarDot[] = [];
  for (let i = 0; i < n; i++) {
    dots.push({
      x: rnd(),
      y: rnd(),
      z: 0.25 + rnd() * 0.75,
      r: rnd() < 0.88 ? 0.7 : 1.35,
      a: 0.18 + rnd() * 0.5,
      warm: rnd() > 0.86,
    });
  }
  return dots;
}

export function renderScene(opts: {
  ctx: CanvasRenderingContext2D;
  world: World;
  cam: Camera;
  aim: Aim | null;
  selectedId: number | null;
  stars: StarDot[];
  width: number;
  height: number;
  dpr: number;
  reduce: boolean;
}) {
  const { ctx, world, cam, aim, width: w, height: h, dpr, reduce } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, opts.stars, cam, w, h);

  ctx.save();
  if (!reduce && world.shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * world.shake, (Math.random() - 0.5) * world.shake);
  }
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  if (world.trails) drawTrails(ctx, world, cam.zoom);
  drawSparks(ctx, world, cam.zoom);
  if (aim && aim.count > 1) drawPredict(ctx, aim, cam.zoom);
  const order = world.bodies.slice().sort((a, b) => a.mass - b.mass);
  for (const b of order) drawBody(ctx, b, world.time, opts.selectedId === b.id, cam.zoom);
  if (aim) drawAim(ctx, aim, cam.zoom);
  ctx.restore();

  if (aim && aim.speed > 0) {
    const p = worldToScreen(aim.x1, aim.y1, cam, w, h);
    ctx.font = "500 12px Outfit, sans-serif";
    ctx.fillStyle = "#ebe6d8";
    ctx.fillText(aim.speed.toFixed(0), p.x + 10, p.y - 8);
  }

  const vg = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.2, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  vg.addColorStop(0, "rgba(7,9,14,0)");
  vg.addColorStop(1, "rgba(7,9,14,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function worldToScreen(x: number, y: number, cam: Camera, w: number, h: number) {
  return {
    x: (x - cam.x) * cam.zoom + w / 2,
    y: (y - cam.y) * cam.zoom + h / 2,
  };
}

function drawStars(ctx: CanvasRenderingContext2D, stars: StarDot[], cam: Camera, w: number, h: number) {
  for (const s of stars) {
    const px = ((s.x * w - cam.x * s.z * 0.05 * cam.zoom) % w + w) % w;
    const py = ((s.y * h - cam.y * s.z * 0.05 * cam.zoom) % h + h) % h;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = s.warm ? "#e4a04a" : "#ebe6d8";
    ctx.beginPath();
    ctx.arc(px, py, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTrails(ctx: CanvasRenderingContext2D, world: World, zoom: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";
  const stride = TRAIL_POINTS * 2;
  for (const b of world.bodies) {
    const count = b.trailCount;
    if (count < 2) continue;
    const pal = PALETTE[b.color % PALETTE.length];
    const start = count === TRAIL_POINTS ? b.trailHead : 0;
    ctx.lineWidth = Math.max(1 / zoom, b.radius * 0.16);
    if (count < 10) {
      trace(ctx, b, start, 0, count, stride);
      ctx.strokeStyle = `rgba(${pal.rgb},0.45)`;
      ctx.stroke();
      continue;
    }
    const chunks = 5;
    const per = Math.floor(count / chunks);
    for (let c = 0; c < chunks; c++) {
      const from = c * per;
      const to = c === chunks - 1 ? count : (c + 1) * per + 1;
      trace(ctx, b, start, from, to, stride);
      const alpha = 0.06 + (c / (chunks - 1)) * 0.5;
      ctx.strokeStyle = `rgba(${pal.rgb},${alpha})`;
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

function trace(ctx: CanvasRenderingContext2D, b: Body, start: number, from: number, to: number, stride: number) {
  ctx.beginPath();
  for (let k = from; k < to; k++) {
    const idx = (start + k * 2) % stride;
    const x = b.trail[idx];
    const y = b.trail[idx + 1];
    if (k === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawSparks(ctx: CanvasRenderingContext2D, world: World, zoom: number) {
  ctx.globalCompositeOperation = "lighter";
  for (const s of world.particles) {
    const pal = PALETTE[s.color % PALETTE.length];
    const a = Math.max(0, s.life / s.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(${pal.rgb},1)`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(0.8 / zoom, 1.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawPredict(ctx: CanvasRenderingContext2D, aim: Aim, zoom: number) {
  ctx.beginPath();
  ctx.moveTo(aim.x0, aim.y0);
  for (let i = 0; i < aim.count; i++) ctx.lineTo(aim.path[i * 2], aim.path[i * 2 + 1]);
  ctx.strokeStyle = "rgba(125,205,196,0.8)";
  ctx.lineWidth = 1.3 / zoom;
  ctx.setLineDash([5 / zoom, 6 / zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBody(ctx: CanvasRenderingContext2D, b: Body, time: number, selected: boolean, zoom: number) {
  const pal = PALETTE[b.color % PALETTE.length];
  const sp = Math.hypot(b.vx, b.vy);
  ctx.save();
  ctx.translate(b.x, b.y);

  if (b.mass < 14 && sp > 22) {
    const len = Math.min(54, (sp - 22) * 0.55);
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    const g = ctx.createLinearGradient(0, 0, -ux * len, -uy * len);
    g.addColorStop(0, `rgba(${pal.rgb},0.7)`);
    g.addColorStop(1, `rgba(${pal.rgb},0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.4 / zoom, b.radius * 0.55);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-ux * len, -uy * len);
    ctx.stroke();
  }

  if (b.kind !== "dust") {
    const glowR = b.kind === "star" ? b.radius * 5.2 : b.kind === "giant" ? b.radius * 3 : b.radius * 2.3;
    const glow = ctx.createRadialGradient(0, 0, b.radius * 0.4, 0, 0, glowR);
    glow.addColorStop(0, `rgba(${pal.rgb},0.33)`);
    glow.addColorStop(1, `rgba(${pal.rgb},0)`);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  if (b.kind === "star") {
    ctx.save();
    ctx.rotate(time * 0.08);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,246,223,0.45)";
    ctx.lineWidth = 1.1 / zoom;
    const L = b.radius * 2.6;
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(L, 0);
    ctx.moveTo(0, -L);
    ctx.lineTo(0, L);
    ctx.stroke();
    ctx.restore();
  }

  const body = ctx.createRadialGradient(-b.radius * 0.32, -b.radius * 0.38, b.radius * 0.15, 0, 0, b.radius);
  body.addColorStop(0, pal.core);
  body.addColorStop(0.55, pal.mid);
  body.addColorStop(1, pal.edge);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
  ctx.fill();

  if (b.kind === "giant") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.rotate(-0.45 + time * 0.12);
    ctx.strokeStyle = "rgba(7,9,14,0.28)";
    ctx.lineWidth = b.radius * 0.16;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, i * b.radius * 0.28, b.radius * 1.2, b.radius * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (selected) {
    ctx.strokeStyle = "rgba(125,205,196,0.9)";
    ctx.lineWidth = 1.4 / zoom;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius + 4 / zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAim(ctx: CanvasRenderingContext2D, aim: Aim, zoom: number) {
  const pal = PALETTE[aim.color % PALETTE.length];
  ctx.save();
  ctx.translate(aim.x0, aim.y0);
  ctx.strokeStyle = `rgba(${pal.rgb},0.85)`;
  ctx.lineWidth = 1.2 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.arc(0, 0, aim.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const dx = aim.x1 - aim.x0;
  const dy = aim.y1 - aim.y0;
  if (Math.hypot(dx, dy) < 1) return;
  ctx.strokeStyle = "#e4a04a";
  ctx.lineWidth = 1.5 / zoom;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(aim.x0, aim.y0);
  ctx.lineTo(aim.x1, aim.y1);
  const ang = Math.atan2(dy, dx);
  const head = 9 / zoom;
  ctx.moveTo(aim.x1, aim.y1);
  ctx.lineTo(aim.x1 - head * Math.cos(ang - 0.45), aim.y1 - head * Math.sin(ang - 0.45));
  ctx.moveTo(aim.x1, aim.y1);
  ctx.lineTo(aim.x1 - head * Math.cos(ang + 0.45), aim.y1 - head * Math.sin(ang + 0.45));
  ctx.stroke();
}
