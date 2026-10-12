import { useEffect, useRef, useState } from "react";
import { Focus, Pause, Play, Trash2 } from "lucide-react";
import {
  DT,
  PRESETS,
  World,
  clearTrails,
  formatEnergy,
  radiusFor,
  separate,
  type CollisionMode,
  type PresetId,
} from "@/lib/orrery/physics";
import { SCENARIOS, applyScenario, type ScenarioId } from "@/lib/orrery/scenarios";
import {
  HTML_LANG,
  LANGS,
  LANG_CODE,
  LANG_NAME,
  STRINGS,
  presetLabel,
  readLang,
  scenarioLabel,
  scenarioTitle,
  type Lang,
} from "@/lib/orrery/i18n";
import { makeStarfield, renderScene, type Aim, type Camera } from "@/components/orrery/draw";

type Stats = { n: number; energy: string; mass: string | null; speed: string | null };

const DEFAULTS = {
  preset: "planet" as PresetId,
  speed: 1,
  collision: "merge" as CollisionMode,
  trails: true,
};

function readSaved() {
  try {
    const raw = localStorage.getItem("orrery-v1");
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<typeof DEFAULTS>;
    const preset = PRESETS.some((x) => x.id === p.preset) ? (p.preset as PresetId) : DEFAULTS.preset;
    const speed = typeof p.speed === "number" ? Math.min(3, Math.max(0.25, p.speed)) : 1;
    const collision: CollisionMode = p.collision === "bounce" ? "bounce" : "merge";
    const trails = typeof p.trails === "boolean" ? p.trails : true;
    return { preset, speed, collision, trails };
  } catch {
    return DEFAULTS;
  }
}

type Api = { world: World; frame: () => void; paint: () => void };

export function Orrery() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<Api | null>(null);
  const [preset, setPreset] = useState<PresetId>(DEFAULTS.preset);
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const [paused, setPaused] = useState(false);
  const [collision, setCollision] = useState<CollisionMode>(DEFAULTS.collision);
  const [trails, setTrails] = useState(true);
  const [scenario, setScenario] = useState<ScenarioId | null>("system");
  const [selected, setSelected] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ n: 7, energy: "—", mass: null, speed: null });
  const [lang, setLang] = useState<Lang>("zh");
  const t = STRINGS[lang];

  const presetRef = useRef(PRESETS[2]);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const selectedRef = useRef<number | null>(null);
  const collisionRef = useRef(collision);
  const trailsRef = useRef(trails);
  const langRef = useRef<Lang>("zh");
  const actions = useRef<{ scenario?: (id: ScenarioId) => void; clear?: () => void }>({});

  presetRef.current = PRESETS.find((p) => p.id === preset) ?? PRESETS[2];
  speedRef.current = speed;
  pausedRef.current = paused;
  selectedRef.current = selected;
  collisionRef.current = collision;
  trailsRef.current = trails;
  langRef.current = lang;

  useEffect(() => {
    setLang(readLang());
  }, []);

  const skipLangSave = useRef(true);
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
    document.title = STRINGS[lang].appName;
    document.querySelector('meta[name="description"]')?.setAttribute("content", STRINGS[lang].description);
    if (skipLangSave.current) {
      skipLangSave.current = false;
      return;
    }
    try {
      localStorage.setItem("orrery-lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  useEffect(() => {
    const saved = readSaved();
    setPreset(saved.preset);
    setSpeed(saved.speed);
    setCollision(saved.collision);
    setTrails(saved.trails);
  }, []);

  const skipSave = useRef(true);
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    localStorage.setItem("orrery-v1", JSON.stringify({ preset, speed, collision, trails }));
  }, [preset, speed, collision, trails]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const world = new World();
    world.trails = trailsRef.current;
    world.collision = collisionRef.current;
    applyScenario(world, "system");
    world.collision = collisionRef.current;
    world.trails = trailsRef.current;

    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const stars = makeStarfield();
    const path = new Float32Array(160);
    let aim: Aim | null = null;
    let mode: "none" | "aim" | "pin" | "pan" | "pinch" = "none";
    const pointers = new Map<number, { x: number; y: number }>();
    let pinId = 0;
    let panLast = { x: 0, y: 0 };
    let pinchDist = 1;
    let pinchZoom = 1;
    let suppress = false;
    let spaceDown = false;
    let spaceUsed = false;
    const samples: { x: number; y: number; t: number }[] = [];
    let originX = 0;
    let originY = 0;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let statAcc = 0;
    let toastAt = 0;
    let prevTrails = world.trails;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let audio: AudioContext | null = null;

    const unlock = () => {
      if (!audio) audio = new AudioContext();
      if (audio.state === "suspended") void audio.resume();
    };
    const tone = (kind: "launch" | "merge" | "sling") => {
      if (reduce) return;
      unlock();
      if (!audio) return;
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.connect(g);
      g.connect(audio.destination);
      if (kind === "launch") {
        o.type = "triangle";
        o.frequency.setValueAtTime(210, t);
        o.frequency.exponentialRampToValueAtTime(84, t + 0.16);
        g.gain.setValueAtTime(0.035, t);
      } else if (kind === "merge") {
        o.type = "sine";
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.26);
        g.gain.setValueAtTime(0.05, t);
      } else {
        o.type = "sine";
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(620, t + 0.14);
        g.gain.setValueAtTime(0.02, t);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.start(t);
      o.stop(t + 0.3);
    };
    const toastMsg = (text: string) => {
      const now = performance.now();
      if (now - toastAt < 900) return;
      toastAt = now;
      setToast(text);
      window.setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 1400);
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return dpr;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      return dpr;
    };

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - canvas.clientWidth / 2) / cam.zoom + cam.x,
      y: (sy - canvas.clientHeight / 2) / cam.zoom + cam.y,
    });
    const localPos = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const before = screenToWorld(sx, sy);
      cam.zoom = Math.min(4.2, Math.max(0.12, cam.zoom * factor));
      const after = screenToWorld(sx, sy);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    };
    const insets = () => {
      const dock = document.querySelector("[data-dock]");
      const cr = canvas.getBoundingClientRect();
      if (!dock) return { left: 16, right: 16, top: 72, bottom: 220 };
      const r = dock.getBoundingClientRect();
      const side = r.height > cr.height * 0.55 && r.left - cr.left < 48;
      if (side) return { left: r.width + 36, right: 28, top: 28, bottom: 28 };
      return { left: 16, right: 16, top: 72, bottom: Math.max(24, cr.bottom - r.top + 16) };
    };
    const frame = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ins = insets();
      if (world.bodies.length === 0) {
        cam.x = 0;
        cam.y = 0;
        cam.zoom = 1;
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of world.bodies) {
        minX = Math.min(minX, b.x - b.radius);
        maxX = Math.max(maxX, b.x + b.radius);
        minY = Math.min(minY, b.y - b.radius);
        maxY = Math.max(maxY, b.y + b.radius);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const spanX = Math.max(64, (maxX - minX) * 1.22);
      const spanY = Math.max(64, (maxY - minY) * 1.22);
      const availW = Math.max(80, w - ins.left - ins.right);
      const availH = Math.max(80, h - ins.top - ins.bottom);
      cam.zoom = Math.min(3.4, Math.max(0.12, Math.min(availW / spanX, availH / spanY)));
      cam.x = cx - (ins.left + availW / 2 - w / 2) / cam.zoom;
      cam.y = cy - (ins.top + availH / 2 - h / 2) / cam.zoom;
    };
    const publish = () => {
      const sel = world.bodies.find((b) => b.id === selectedRef.current) ?? null;
      if (!sel && selectedRef.current != null) setSelected(null);
      setStats({
        n: world.bodies.length,
        energy: formatEnergy(world.energy()),
        mass: sel ? sel.mass.toFixed(1) : null,
        speed: sel ? Math.hypot(sel.vx, sel.vy).toFixed(1) : null,
      });
    };
    const paint = () => {
      renderScene({
        ctx,
        world,
        cam,
        aim,
        selectedId: selectedRef.current,
        stars,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        dpr: resize(),
        reduce,
      });
    };
    const refreshAim = () => {
      if (!aim) return;
      const spec = presetRef.current;
      aim.mass = spec.mass;
      aim.radius = radiusFor(spec.mass);
      aim.color = spec.kind === "star" ? 0 : (world.colorSeq % 4) + 1;
      const dx = aim.x1 - aim.x0;
      const dy = aim.y1 - aim.y0;
      const mag = Math.hypot(dx, dy) || 1;
      aim.count =
        aim.speed <= 0
          ? 0
          : world.predict(aim.x0, aim.y0, (dx / mag) * aim.speed, (dy / mag) * aim.speed, aim.mass, path);
      aim.path = path;
    };

    apiRef.current = { world, frame, paint };
    frame();
    publish();
    paint();

    const orrery = {
      ready: true,
      bodyCount: () => world.bodies.length,
      energy: () => world.energy(),
      masses: () => world.bodies.map((b) => Math.round(b.mass * 10) / 10),
      step: (n: number) => {
        for (let i = 0; i < n; i++) world.step(DT);
      },
      scenario: (id: ScenarioId) => actions.current.scenario?.(id),
      clear: () => actions.current.clear?.(),
    };
    (window as unknown as { __orrery?: typeof orrery }).__orrery = orrery;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (trailsRef.current && !prevTrails) clearTrails(world);
      prevTrails = trailsRef.current;
      world.trails = trailsRef.current;
      world.collision = collisionRef.current;
      const raw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const scale = pausedRef.current ? 0 : speedRef.current;
      acc += raw * scale;
      let steps = 0;
      while (acc >= DT && steps < 12) {
        world.step(DT);
        acc -= DT;
        steps += 1;
      }
      if (steps === 12) acc = 0;
      if (world.events.length) {
        const events = world.events.splice(0, world.events.length);
        if (events.includes("sling")) {
          tone("sling");
          toastMsg(STRINGS[langRef.current].toastSling);
        } else if (events.includes("merge")) {
          tone("merge");
          toastMsg(STRINGS[langRef.current].toastMerge);
        }
      }
      if (mode === "aim") refreshAim();
      paint();
      statAcc += raw;
      if (statAcc > 0.2) {
        statAcc = 0;
        publish();
      }
    };
    raf = requestAnimationFrame(loop);

    const onDown = (e: PointerEvent) => {
      if (e.button > 2) return;
      unlock();
      const p = localPos(e);
      if (e.button === 1 || e.button === 2 || spaceDown) {
        mode = "pan";
        spaceUsed = spaceDown;
        panLast = p;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      pointers.set(e.pointerId, p);
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size >= 2) {
        mode = "pinch";
        aim = null;
        world.pinned = null;
        const pts = [...pointers.values()];
        pinchDist = Math.max(8, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        pinchZoom = cam.zoom;
        panLast = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        return;
      }
      if (suppress) return;
      const wpt = screenToWorld(p.x, p.y);
      const hit = world.pick(wpt.x, wpt.y, cam.zoom);
      if (hit) {
        mode = "pin";
        pinId = hit.id;
        world.pinned = hit;
        world.pinX = hit.x;
        world.pinY = hit.y;
        setSelected(hit.id);
        samples.length = 0;
        samples.push({ x: hit.x, y: hit.y, t: performance.now() });
      } else {
        mode = "aim";
        originX = e.clientX;
        originY = e.clientY;
        const spec = presetRef.current;
        aim = {
          x0: wpt.x,
          y0: wpt.y,
          x1: wpt.x,
          y1: wpt.y,
          mass: spec.mass,
          radius: radiusFor(spec.mass),
          color: spec.kind === "star" ? 0 : (world.colorSeq % 4) + 1,
          speed: 0,
          path,
          count: 0,
        };
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = localPos(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (mode === "pinch" && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.max(8, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const before = screenToWorld(mid.x, mid.y);
        cam.zoom = Math.min(4.2, Math.max(0.12, pinchZoom * (dist / pinchDist)));
        const after = screenToWorld(mid.x, mid.y);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        cam.x -= (mid.x - panLast.x) / cam.zoom;
        cam.y -= (mid.y - panLast.y) / cam.zoom;
        panLast = mid;
        return;
      }
      if (mode === "pan") {
        cam.x -= (p.x - panLast.x) / cam.zoom;
        cam.y -= (p.y - panLast.y) / cam.zoom;
        panLast = p;
        return;
      }
      if (mode === "pin") {
        const body = world.bodies.find((b) => b.id === pinId);
        if (!body) return;
        const wpt = screenToWorld(p.x, p.y);
        world.pinned = body;
        world.pinX = wpt.x;
        world.pinY = wpt.y;
        body.x = wpt.x;
        body.y = wpt.y;
        body.vx = 0;
        body.vy = 0;
        const t = performance.now();
        samples.push({ x: wpt.x, y: wpt.y, t });
        while (samples.length > 1 && t - samples[0].t > 130) samples.shift();
        return;
      }
      if (mode === "aim" && aim) {
        const wpt = screenToWorld(p.x, p.y);
        aim.x1 = wpt.x;
        aim.y1 = wpt.y;
        const pix = Math.hypot(e.clientX - originX, e.clientY - originY);
        aim.speed = pix < 8 ? 0 : Math.min(220, pix * 0.42);
        refreshAim();
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === "pinch") {
        if (pointers.size < 2) {
          mode = "none";
          suppress = true;
        }
        return;
      }
      if (mode === "pan") {
        mode = "none";
        if (pointers.size === 0) suppress = false;
        return;
      }
      if (mode === "pin") {
        const body = world.bodies.find((b) => b.id === pinId);
        world.pinned = null;
        if (body) {
          const t = performance.now();
          const fresh = samples.filter((s) => t - s.t <= 140);
          let vx = 0;
          let vy = 0;
          if (fresh.length >= 2) {
            const a = fresh[0];
            const b = fresh[fresh.length - 1];
            const dt = (b.t - a.t) / 1000;
            if (dt > 0.016) {
              vx = ((b.x - a.x) / dt) * 0.7;
              vy = ((b.y - a.y) / dt) * 0.7;
            }
          }
          const sp = Math.hypot(vx, vy);
          if (sp > 360) {
            vx *= 360 / sp;
            vy *= 360 / sp;
          }
          body.vx = vx;
          body.vy = vy;
          separate(world, body);
          world.dirty = true;
        }
        mode = "none";
        return;
      }
      if (mode === "aim" && aim) {
        const dx = aim.x1 - aim.x0;
        const dy = aim.y1 - aim.y0;
        const mag = Math.hypot(dx, dy) || 1;
        const spec = presetRef.current;
        const body = world.add({
          x: aim.x0,
          y: aim.y0,
          vx: aim.speed > 0 ? (dx / mag) * aim.speed : 0,
          vy: aim.speed > 0 ? (dy / mag) * aim.speed : 0,
          mass: spec.mass,
          kind: spec.kind,
        });
        aim = null;
        mode = "none";
        if (!body) toastMsg(STRINGS[langRef.current].toastFull);
        else {
          tone("launch");
          setSelected(body.id);
        }
      }
      if (pointers.size === 0) suppress = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = localPos(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0011));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        spaceDown = true;
      } else if (e.key === "f" || e.key === "F") frame();
      else if (e.key === "[") setSpeed((s) => Math.max(0.25, Math.round((s - 0.25) * 100) / 100));
      else if (e.key === "]") setSpeed((s) => Math.min(3, Math.round((s + 0.25) * 100) / 100));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (!spaceUsed) setPaused((p) => !p);
      spaceDown = false;
      spaceUsed = false;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const ro = new ResizeObserver(() => {
      resize();
      paint();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      apiRef.current = null;
      audio?.close();
    };
  }, []);

  const runScenario = (id: ScenarioId) => {
    const api = apiRef.current;
    if (!api) return;
    applyScenario(api.world, id);
    api.world.trails = trailsRef.current;
    setScenario(id);
    setSelected(null);
    setCollision(api.world.collision);
    api.frame();
    api.paint();
    setStats({ n: api.world.bodies.length, energy: formatEnergy(api.world.energy()), mass: null, speed: null });
  };
  const onClear = () => {
    const api = apiRef.current;
    if (!api) return;
    api.world.clear();
    setScenario(null);
    setSelected(null);
    setStats({ n: 0, energy: "—", mass: null, speed: null });
    api.frame();
    api.paint();
  };
  actions.current.scenario = runScenario;
  actions.current.clear = onClear;

  const removeSelected = () => {
    const api = apiRef.current;
    if (!api || selected == null) return;
    api.world.removeId(selected);
    setSelected(null);
    setStats((s) => ({ ...s, n: api.world.bodies.length, mass: null, speed: null, energy: formatEnergy(api.world.energy()) }));
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-void text-paper">
      <canvas
        ref={canvasRef}
        className="sky absolute inset-0 h-full w-full"
        role="application"
        aria-label={t.canvas}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-4 pt-4 md:hidden">
        <div>
          <p className="font-display text-xs tracking-widest text-amber">ORRERY</p>
          <h1 className="text-xl font-medium leading-tight">{t.appName}</h1>
        </div>
        <div className="text-right text-sm text-mute">
          <div>
            <span className="tabular-nums text-paper">{stats.n}</span> {t.bodies}
          </div>
          {paused ? <div className="text-amber">{t.paused}</div> : null}
        </div>
      </header>
      {toast ? (
        <div className="pointer-events-none absolute top-20 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line bg-ink/90 px-4 py-2 text-sm md:top-6">
          {toast}
        </div>
      ) : null}
      {stats.n === 0 ? (
        <p className="pointer-events-none absolute top-1/4 left-1/2 z-10 w-64 -translate-x-1/2 text-center text-sm text-mute md:top-1/3">
          {t.empty}
        </p>
      ) : null}
      <aside
        data-dock
        className="dock absolute inset-x-3 bottom-3 z-10 flex max-h-[58dvh] flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-ink/85 p-3 backdrop-blur-md md:inset-y-4 md:right-auto md:bottom-4 md:left-4 md:max-h-none md:w-80"
      >
        <div className="hidden md:block">
          <p className="font-display text-xs tracking-widest text-amber">ORRERY</p>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-medium">{t.appName}</h1>
            {paused ? <span className="text-xs text-amber">{t.paused}</span> : null}
          </div>
          <p className="mt-1 text-sm text-mute">{t.tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-mute">{t.language}</span>
          <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label={t.language}>
            {LANGS.map((id) => {
              const on = lang === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  aria-label={LANG_NAME[id]}
                  title={LANG_NAME[id]}
                  onClick={() => setLang(id)}
                  className={
                    on
                      ? "h-9 min-w-0 flex-1 rounded-full bg-tide text-xs font-medium text-void"
                      : "h-9 min-w-0 flex-1 rounded-full border border-line text-xs text-paper"
                  }
                >
                  {LANG_CODE[id]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between text-sm text-mute">
          <span>
            {t.bodies} <span className="tabular-nums text-paper">{stats.n}</span>
          </span>
          <span>
            {t.energy} <span className="tabular-nums text-paper">{stats.energy}</span>
          </span>
        </div>
        <div className="chiprow" role="group" aria-label={t.massPresets}>
          {PRESETS.map((p) => {
            const on = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPreset(p.id)}
                className={
                  on
                    ? "h-11 shrink-0 rounded-full bg-amber px-3 text-sm font-medium text-void"
                    : "h-11 shrink-0 rounded-full border border-line px-3 text-sm text-paper"
                }
              >
                {presetLabel(lang, p.id)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={paused ? t.resume : t.pause}
            aria-pressed={paused}
            onClick={() => setPaused((v) => !v)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber text-void"
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex justify-between text-xs text-mute">
              <span>{t.time}</span>
              <span className="tabular-nums text-paper">{speed.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={speed}
              aria-label={t.timeScale}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
        </div>
        {stats.mass ? (
          <p className="text-sm text-mute">
            {t.mass} <span className="tabular-nums text-paper">{stats.mass}</span>
            <span className="px-2">·</span>
            {t.speed} <span className="tabular-nums text-paper">{stats.speed}</span>
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" aria-pressed={trails} onClick={() => setTrails((v) => !v)} className={chip(trails)}>
            {t.trails}
          </button>
          <button type="button" aria-pressed={collision === "merge"} onClick={() => setCollision("merge")} className={chip(collision === "merge")}>
            {t.merge}
          </button>
          <button type="button" aria-pressed={collision === "bounce"} onClick={() => setCollision("bounce")} className={chip(collision === "bounce")}>
            {t.bounce}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={onClear} className={chip(false)}>
            <Trash2 size={15} />
            {t.clear}
          </button>
          <button type="button" onClick={() => apiRef.current?.frame()} className={chip(false)}>
            <Focus size={15} />
            {t.frame}
          </button>
          <button type="button" disabled={selected == null} onClick={removeSelected} className={chip(false)}>
            {t.remove}
          </button>
        </div>
        <div className="chiprow" role="group" aria-label={t.scenarios}>
          {SCENARIOS.map((s) => {
            const on = scenario === s.id;
            return (
              <button
                key={s.id}
                type="button"
                title={scenarioTitle(lang, s.id)}
                aria-pressed={on}
                onClick={() => runScenario(s.id)}
                className={
                  on
                    ? "h-11 shrink-0 rounded-full bg-amber px-3 text-sm font-medium text-void"
                    : "h-11 shrink-0 rounded-full border border-line px-3 text-sm text-paper"
                }
              >
                {scenarioLabel(lang, s.id)}
              </button>
            );
          })}
        </div>
        <p className="hint-fine text-xs leading-relaxed text-mute">{t.hintFine}</p>
        <p className="hint-coarse text-xs leading-relaxed text-mute">{t.hintCoarse}</p>
      </aside>
    </main>
  );
}

function chip(on: boolean) {
  return on
    ? "inline-flex h-11 items-center justify-center gap-1 rounded-full bg-amber px-1 text-center text-xs font-medium leading-tight text-void"
    : "inline-flex h-11 items-center justify-center gap-1 rounded-full border border-line px-1 text-center text-xs leading-tight text-paper disabled:opacity-40";
}
