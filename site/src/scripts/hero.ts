// The home page's hero, live: what moves on the radar globe of lib/globe.ts, on one canvas between
// the build's two still layers (behind it the shadow, the halo, the globe's body and its parallels;
// in front the near halves of the bezel and the orbit). It turns; a red sweep goes round it every
// 6 s and lights the points it passes; the satellite runs its orbit; the day's stories stand on it
// as pins, and their labels (text the page already has, hidden from assistive tech) follow them,
// brightest just after the sweep. A mouse turns the globe a little toward it. It draws only while
// the hero is on screen and the tab is visible (a hidden tab gets no frames); under reduced motion or the reader's pause it is
// one still frame. After the opening (boot.js, intro.ts) the points gather into the globe once.
// Without this script the page keeps the build's picture of the same still frame.

import { BOX, LEVELS, SHADES, SPIN, SWEEP, TAU, TILT, TRAIL, ink, lattice, onSphere, orbit, persp, tone, view } from "../lib/globe";

type V = [number, number, number];

const root = document.documentElement;
const ACCENT = "194 55 26";
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const calm = () => reduce.matches || root.classList.contains("still");
const mod = (n: number) => ((n % TAU) + TAU) % TAU;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function run(hero: HTMLElement, box: HTMLElement, canvas: HTMLCanvasElement, copy: HTMLElement): void {
  const ctx = canvas.getContext("2d")!;
  const tags = [...box.querySelectorAll<HTMLElement>(".hero-tag")].map((el) => ({ el, lat: +el.dataset.lat!, lon: +el.dataset.lon!, seen: 0 }));
  const colours: string[] = [];
  for (let l = 0; l < LEVELS * SHADES; l++) colours.push(ink(l / SHADES | 0, l % SHADES));

  // Fewer points for a small screen or a machine of few cores.
  const n = innerWidth < 640 || navigator.hardwareConcurrency < 5 ? 1500 : 2400;
  const { xyz, w: weight } = lattice(n);
  const lon = weight.map((_, i) => Math.atan2(xyz[i * 3], xyz[i * 3 + 2]));
  const dots = [0, 0, 0, 0, 0].map(() => new Float32Array(n));

  let [W, R, dpr, clock, last, frame, yaw, pitch, goalYaw, goalPitch] = [0, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  let avoid = [0, 0, 0, 0];
  // A pin outside [lo, hi] is off the screen and its label hidden; past `edge` a label hangs to
  // the left of its pin, so the window's edge does not cut it.
  let [lo, hi, edge] = [0, 0, 0];
  let onScreen = true;
  // The gathering after the opening, while the clock runs its first 2.2 s (−1: none).
  let enter = root.classList.contains("intro") && !calm() ? 0 : -1;

  const draw = () => {
    const e = enter ? 1 : clamp(clock / 2.2);
    const c = W / 2;
    const world = SPIN + (clock * TAU) / 110 - 2.2 * (1 - e) ** 3;
    const a = world + yaw;
    const t = TILT + pitch;
    const sweep = SWEEP + (clock * TAU) / 6;
    const P = (v: V): V => {
      const p = persp(v[2]) * R;
      return [c + v[0] * p, c - v[1] * p, v[2]];
    };
    const line = (alpha: number, width: number, rgb = ACCENT) => {
      ctx.strokeStyle = `rgb(${rgb}/${alpha})`;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const disc = (x: number, y: number, r: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    };
    // The near half of a great circle through the poles at longitude `lam`, turned by `by` (with
    // `half`, only the meridian itself, pole to pole).
    const meridian = (lam: number, by: number, half = 0) => {
      ctx.beginPath();
      let on = false;
      for (let i = 0; i <= 64; i++) {
        const k = half ? (i / 64 - 0.5) * Math.PI : (i / 64) * TAU;
        const q = P(view(Math.cos(k) * Math.sin(lam), Math.sin(k), Math.cos(k) * Math.cos(lam), by, t));
        if (q[2] >= 0 && on) ctx.lineTo(q[0], q[1]);
        else ctx.moveTo(q[0], q[1]);
        on = q[2] >= 0;
      }
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, W);
    for (let i = 0; i < 6; i++) {
      meridian((i * Math.PI) / 6, a);
      line(0.13, 0.8, "23 24 26");
    }

    // The near points: where each is seen, its tone, how lit it is by the sweep; drawn one tone at a time.
    const [px, py, size, flare, key] = dots;
    for (let i = 0; i < n; i++) {
      const v = view(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], a, t);
      const [level, shade, s] = tone(...v, weight[i]);
      const local = enter ? 1 : clamp((e - ((i * 0.618) % 1) * 0.55) / 0.45);
      const out = 1 + 0.9 * (1 - local) ** 2;
      [px[i], py[i]] = P([v[0] * out, v[1] * out, v[2] * out]);
      size[i] = Math.max(0.55, s * R);
      const d = mod(sweep - lon[i] - world);
      flare[i] = local < 1 || d > TRAIL ? 0 : (1 - d / TRAIL) ** 3;
      key[i] = v[2] < 0 || !local ? -1 : Math.round(level * local) * SHADES + shade;
    }
    colours.forEach((colour, k) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (key[i] !== k) continue;
        ctx.moveTo(px[i] + size[i], py[i]);
        ctx.arc(px[i], py[i], size[i], 0, TAU);
      }
      ctx.fill();
    });
    for (let i = 0; i < n; i++) {
      const f = flare[i];
      if (f < 0.02 || key[i] < 0) continue;
      disc(px[i], py[i], size[i] * 3.2, `rgb(${ACCENT}/${0.16 * f})`);
      disc(px[i], py[i], size[i] * (1 + 0.5 * f), `rgb(${ACCENT}/${0.1 + 0.9 * f})`);
    }
    for (const [width, alpha] of [[12, 0.06], [5, 0.14], [1.6, 0.95]]) {
      meridian(sweep, yaw, 1);
      line(alpha, width);
    }

    // The satellite, while it is on the near side of its orbit.
    const s = P(view(...orbit(1.9 + clock / 3), 0, TILT));
    if (s[2] > 0) {
      const k = R * 0.026;
      ctx.fillStyle = "#17181a";
      ctx.fillRect(s[0] - k, s[1] - k / 5, k * 2, k / 2.5);
      ctx.fillRect(s[0] - k / 3, s[1] - k / 3, k / 1.5, k / 1.5);
    }

    // The pins, with a ring that leaves each as the sweep passes, and their labels.
    for (const tag of tags) {
      const b = P(view(...onSphere(tag.lat, tag.lon), a, t));
      const tip = P(view(...onSphere(tag.lat, tag.lon, 1.2), a, t));
      const near = clamp(b[2] * 3 + 0.2) * clamp((e - 0.8) * 5);
      if (mod(sweep - tag.lon - world) < 0.2) tag.seen = clock;
      const age = clock - tag.seen;
      ctx.globalAlpha = near;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(tip[0], tip[1]);
      line(0.85, 1.4, "23 24 26");
      ctx.beginPath();
      ctx.arc(b[0], b[1], 3 + age * 26, 0, TAU);
      line(0.7 * clamp(1 - age / 1.4), 1.5);
      disc(tip[0], tip[1], 4.5, `rgb(${ACCENT})`);
      line(1, 2, "255 255 255");
      ctx.globalAlpha = 1;
      const [x, y] = tip;
      const hidden = (x > avoid[0] && x < avoid[2] && y > avoid[1] && y < avoid[3]) || x < lo || x > hi;
      // Where the label stands and how strongly, as custom properties the stylesheet applies.
      const style = tag.el.style;
      style.setProperty("--at", `${x | 0}px ${y | 0}px`);
      style.setProperty("--on", String(hidden ? 0 : near * (0.5 + 0.5 * Math.exp(-age / 3))));
      tag.el.classList.toggle("is-left", x > edge);
    }
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    yaw += (goalYaw - yaw) * 0.05;
    pitch += (goalPitch - pitch) * 0.05;
    draw();
    frame = requestAnimationFrame(tick);
  };
  const go = () => {
    if (enter === 0 && !root.classList.contains("intro")) hero.classList.add("is-entering");
    const live = onScreen && !calm() && !root.classList.contains("intro");
    if (live && !frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
    if (!live) {
      // Stopped after the opening: the globe is whole.
      if (!root.classList.contains("intro")) enter = -1;
      cancelAnimationFrame(frame);
      frame = 0;
      draw();
    }
  };
  const measure = () => {
    W = box.offsetWidth;
    R = W / BOX;
    const [x, y] = [box.offsetLeft, box.offsetTop];
    [lo, hi] = [8 - x, hero.offsetWidth - x - 8];
    edge = hi - Math.min(292, hero.offsetWidth / 2);
    const [l, t] = [copy.offsetLeft - x - 16, copy.offsetTop - y - 16];
    avoid = [l, t, l + copy.offsetWidth + 32, t + copy.offsetHeight + 32];
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(W * dpr);
    if (!frame) draw();
  };

  measure();
  hero.classList.add("is-live");
  new ResizeObserver(measure).observe(hero);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    go();
  }).observe(hero);
  new MutationObserver(go).observe(root, { attributeFilter: ["class"] });
  reduce.addEventListener("change", go);
  hero.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    goalYaw = (event.clientX / innerWidth - 0.5) * 0.6;
    goalPitch = (event.clientY / innerHeight - 0.5) * 0.2;
  });
  hero.addEventListener("pointerleave", () => (goalYaw = goalPitch = 0));
  go();
}

// Its own failure stays its own: the hero keeps the build's picture.
try {
  const hero = document.querySelector<HTMLElement>(".hero");
  const box = hero?.querySelector<HTMLElement>(".hero-globe");
  const canvas = box?.querySelector("canvas");
  const copy = hero?.querySelector<HTMLElement>(".hero-copy");
  if (hero && box && canvas && copy) run(hero, box, canvas, copy);
} catch {
  // The still globe stands.
}
