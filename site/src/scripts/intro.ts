// The opening (plan 7, D4 and D5). boot.js has already decided, before the first paint, whether
// this view opens: if so <html> carries `intro` and the stylesheet paints the page ink. Here the
// day's headlines are laid as glyphs along the brand mark's three arcs `)))`, a sweep passes and
// lights each arc and its glyphs, the glyphs draw together into the mark itself with the issue
// under it for an instant, and the ink fades to the page. Anything that removes `intro` (a click,
// a key, a hidden tab, boot.js's 1500 ms timer) ends it on the next frame. Glyphs reach only the
// canvas, never the DOM.

const root = document.documentElement;

/** The whole opening, counted from the navigation: never longer than this. */
const BUDGET = 1200;
/** The four beats: the sweep, the glyphs meeting in the mark, the mark held, the fade. */
const SWEEP = 520;
const MEET = 200;
const HOLD = 170;
const FADE = 250;

/** The mark's arcs (Mark.astro: `M x 4 A 13 13 0 0 1 x 20` in a 24-unit box). */
const ARCS = [5, 11, 17];
const RADIUS = 13;
const HALF = Math.asin(8 / RADIUS);
const SHIFT = Math.sqrt(RADIUS * RADIUS - 8 * 8);

interface Glyph {
  ch: string;
  /** Position in mark units (the 24-unit box), so it can be drawn at any scale. */
  qx: number;
  qy: number;
  /** Rotation along its arc. */
  turn: number;
  /** Bearing from the sweep's pivot, at which the sweep lights it. */
  bearing: number;
}

function finish(canvas?: HTMLCanvasElement): void {
  canvas?.remove();
  root.classList.remove("intro", "intro-live");
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * The arcs at screen scale: `unit` pixels per mark unit, the box's corner at (ox, oy), each arc
 * a band of three rows of glyphs. Centred where they fit; on a narrow screen the arcs keep the
 * width and the sweep's pivot (the first arc's centre) moves off the left edge.
 */
function frame(w: number, h: number) {
  const unit = Math.min((w * 0.8) / 15.5, (h * 0.66) / 16);
  const ox = Math.min(w / 2 - 7.6 * unit, w * 0.9 - 20.5 * unit);
  const oy = h / 2 - 12 * unit;
  return { unit, ox, oy, pivot: [ox + (ARCS[0] - SHIFT) * unit, oy + 12 * unit] as const };
}

function layout(text: string, w: number, h: number, size: number): Glyph[] {
  const { unit, ox, oy, pivot } = frame(w, h);
  const advance = size * 0.66;
  // Rows a line apart, in mark units.
  const gap = (size * 1.12) / unit;
  const glyphs: Glyph[] = [];
  let k = 0;
  let band = 0;
  for (const x of ARCS) {
    const cx = x - SHIFT;
    for (const row of [-gap, 0, gap]) {
      const r = RADIUS + row;
      // Each row starts somewhere else in the headlines, so no two rows repeat each other.
      k = Math.floor((band++ * text.length) / 9);
      const count = Math.floor((2 * HALF * r * unit) / advance);
      for (let i = 0; i < count; i++) {
        const a = -HALF + ((i + 0.5) / count) * 2 * HALF;
        const qx = cx + r * Math.cos(a);
        const qy = 12 + r * Math.sin(a);
        const ch = text[k++ % text.length];
        if (ch === " ") continue;
        const bearing = Math.atan2(oy + qy * unit - pivot[1], ox + qx * unit - pivot[0]);
        glyphs.push({ ch, qx, qy, turn: a + Math.PI / 2, bearing });
      }
    }
  }
  return glyphs;
}

function run(): void {
  if (!root.classList.contains("intro")) return;
  const titles = [...document.querySelectorAll(".story-title")]
    .map((el) => (el.textContent ?? "").trim())
    .filter(Boolean);
  const left = BUDGET - performance.now();
  if (titles.length === 0 || left < 500 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "intro-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    finish();
    return;
  }
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const css = getComputedStyle(root);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const ink = token("--ink", "#17181a");
  const accent = token("--accent", "#c2371a");
  const bg = token("--bg", "#f7f7f4");
  const mono = token("--font-label", "monospace");
  const lang = root.lang === "en" ? "en" : "tr";
  const size = Math.round(Math.max(14, Math.min(30, Math.min(w, h) / 20)));
  const text = titles.join(" · ").toLocaleUpperCase(lang) + " · ";
  const glyphs = layout(text, w, h, size);
  const { unit, ox, oy, pivot } = frame(w, h);
  // The issue, read from the masthead as text: "SAYI 4 · 20 KASIM".
  const issue = [document.querySelector(".masthead .mh-no"), document.querySelector(".masthead .mh-big")]
    .map((el) => (el?.textContent ?? "").trim())
    .filter(Boolean)
    .join(" · ")
    .toLocaleUpperCase(lang);
  // Where the mark resolves: the window's centre, at a fifth of its short side (at least 104 px).
  const markUnit = Math.max(104, Math.min(w, h) * 0.2) / 24;
  const mx = w / 2 - 11 * markUnit;
  const my = h / 2 - 14 * markUnit;
  // The sweep turns over the arcs, from above them to below.
  const from = Math.atan2(-0.62, 1) - 0.25;
  const to = -from;

  // Squeeze the timing when the page took long to get here; never past the budget.
  const scale = Math.min(1, left / (SWEEP + MEET + HOLD + FADE));
  const sweep = SWEEP * scale;
  const meet = MEET * scale;
  const hold = HOLD * scale;
  const fade = FADE * scale;
  const end = sweep + meet + hold + fade;
  const start = performance.now();

  /** The three arcs of the mark in mark units, drawn with the current transform. */
  const arcs = (until: number) => {
    for (const x of ARCS) {
      ctx.beginPath();
      ctx.arc(x - SHIFT, 12, RADIUS, -HALF, -HALF + 2 * HALF * until);
      ctx.stroke();
    }
  };

  const draw = (t: number) => {
    const beam = from + (to - from) * Math.min(1, t / sweep);
    const together = smooth((t - sweep) / meet);
    const gone = smooth((t - sweep - meet - hold) / fade);
    // From the arcs' scale and place to the mark's at the centre.
    const u = unit + (markUnit - unit) * together;
    const bx = ox + (mx - ox) * together;
    const by = oy + (my - oy) * together;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1 - gone;
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, h);
    if (t < sweep) {
      // The beam: a faint wedge behind an accent edge.
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(pivot[0], pivot[1]);
      ctx.arc(pivot[0], pivot[1], w + h, beam - 0.22, beam);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pivot[0], pivot[1]);
      ctx.lineTo(pivot[0] + Math.cos(beam) * (w + h), pivot[1] + Math.sin(beam) * (w + h));
      ctx.stroke();
      // Each arc lights in the accent as the beam crosses it, from its top down.
      const lit = Math.max(0, Math.min(1, (beam - from) / (to - from)));
      ctx.setTransform(dpr * unit, 0, 0, dpr * unit, dpr * ox, dpr * oy);
      ctx.lineWidth = (size * 0.16) / unit;
      ctx.lineCap = "round";
      arcs(lit);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      // The lit arcs draw together into the mark itself, which stays for the beat.
      ctx.globalAlpha = 1 - gone;
      ctx.strokeStyle = accent;
      ctx.lineCap = "round";
      ctx.setTransform(dpr * u, 0, 0, dpr * u, dpr * bx, dpr * by);
      ctx.lineWidth = 2.25 + ((size * 0.16) / unit - 2.25) * (1 - together);
      arcs(1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (issue) {
        ctx.globalAlpha = together * (1 - gone);
        ctx.fillStyle = bg;
        ctx.font = `600 ${Math.round(Math.max(13, size * 0.7))}px ${mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(issue, w / 2, my + 24 * markUnit + size * 0.6);
      }
    }
    // The glyphs: dim until the beam passes, then a flash of accent settling to the page colour
    // at full strength; as they draw into the mark they shrink and fade.
    const glyphSize = size * (u / unit);
    if (together < 1) {
      ctx.font = `700 ${Math.max(1, glyphSize)}px ${mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const g of glyphs) {
        const since = beam - g.bearing;
        const lit = since >= 0;
        const fresh = lit ? Math.max(0, 1 - since / 0.3) : 0;
        ctx.globalAlpha = (lit ? 1 : 0.24) * (1 - together) * (1 - gone);
        ctx.fillStyle = fresh > 0.25 ? accent : bg;
        const x = bx + g.qx * u;
        const y = by + g.qy * u;
        const c = Math.cos(g.turn);
        const s = Math.sin(g.turn);
        ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * x, dpr * y);
        ctx.fillText(g.ch, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  };

  draw(0);
  document.body.append(canvas);
  // The canvas now covers the page; the stylesheet's plain ink cover gives way to it.
  root.classList.add("intro-live");

  const tick = () => {
    const t = performance.now() - start;
    if (!root.classList.contains("intro") || t >= end) {
      finish(canvas);
      return;
    }
    draw(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

try {
  run();
} catch {
  finish();
}
