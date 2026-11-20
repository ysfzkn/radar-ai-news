// The opening (plan 7, D4 and D5). boot.js has already decided, before the first paint, whether
// this view opens: if so <html> carries `intro` and the stylesheet paints the page ink. Here the
// day's headlines are laid as glyphs along the brand mark's three arcs `)))`, a sweep passes and
// lights them, they scatter and the ink fades to the page. Anything that removes `intro` (a click,
// a key, a hidden tab, boot.js's 1500 ms timer) ends it on the next frame. Glyphs reach only the
// canvas, never the DOM.

const root = document.documentElement;

/** The whole opening, counted from the navigation: never longer than this. */
const BUDGET = 1200;
const SWEEP = 700;
const FADE = 400;

interface Glyph {
  ch: string;
  x: number;
  y: number;
  /** Rotation along its arc. */
  turn: number;
  /** Bearing from the sweep's pivot, at which the sweep lights it. */
  bearing: number;
  /** Where it flies when the glyphs scatter. */
  dx: number;
  dy: number;
}

function finish(canvas?: HTMLCanvasElement): void {
  canvas?.remove();
  root.classList.remove("intro", "intro-live");
}

/** A small deterministic spread for the scatter. */
const spread = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The mark's arcs (Mark.astro: `M x 4 A 13 13 0 0 1 x 20` for x = 5, 11, 17 in a 24-unit box),
 * each a band of three rows of glyphs, scaled to the screen.
 */
function layout(text: string, w: number, h: number, size: number): { glyphs: Glyph[]; pivot: [number, number] } {
  // With their glyph rows the arcs span x 4.3 to 20.5 and y 4 to 20 in mark units; the sweep's
  // pivot (the first arc's centre) sits at x -5.25. Centre arcs and pivot together where they
  // fit; on a narrow screen the arcs keep the width and the pivot moves off the left edge.
  const unit = Math.min((w * 0.8) / 15.5, (h * 0.66) / 16);
  const ox = Math.min(w / 2 - 7.6 * unit, w * 0.9 - 20.5 * unit);
  const oy = h / 2 - 12 * unit;
  const half = Math.asin(8 / 13);
  const advance = size * 0.64;
  const rows = [-0.7, 0, 0.7];
  const glyphs: Glyph[] = [];
  const pivot: [number, number] = [ox + -5.25 * unit, oy + 12 * unit];
  let k = 0;
  let band = 0;
  for (const x of [5, 11, 17]) {
    const cx = ox + (x - Math.sqrt(13 * 13 - 8 * 8)) * unit;
    const cy = oy + 12 * unit;
    for (const row of rows) {
      const r = (13 + row) * unit;
      // Each row starts somewhere else in the headlines, so no two rows repeat each other.
      k = Math.floor((band++ * text.length) / 9);
      const count = Math.floor((2 * half * r) / advance);
      for (let i = 0; i < count; i++) {
        const a = -half + ((i + 0.5) / count) * 2 * half;
        const gx = cx + r * Math.cos(a);
        const gy = cy + r * Math.sin(a);
        const ch = text[k++ % text.length];
        if (ch === " ") continue;
        const away = Math.atan2(gy - pivot[1], gx - pivot[0]);
        const reach = (0.25 + spread(k) * 0.75) * size * 9;
        glyphs.push({
          ch,
          x: gx,
          y: gy,
          turn: a + Math.PI / 2,
          bearing: away,
          dx: Math.cos(away + (spread(k + 7) - 0.5) * 0.6) * reach,
          dy: Math.sin(away + (spread(k + 7) - 0.5) * 0.6) * reach,
        });
      }
    }
  }
  return { glyphs, pivot };
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
  const size = Math.round(Math.max(10, Math.min(18, Math.min(w, h) / 34)));
  const font = `600 ${size}px ${token("--font-label", "monospace")}`;
  const lang = root.lang === "en" ? "en" : "tr";
  const text = titles.join(" · ").toLocaleUpperCase(lang) + " · ";
  const { glyphs, pivot } = layout(text, w, h, size);
  // The sweep turns over the arcs, from above them to below.
  const from = Math.atan2(-0.62, 1) - 0.25;
  const to = -from;

  // Squeeze the timing when the page took long to get here; never past the budget.
  const scale = Math.min(1, left / (SWEEP + FADE));
  const sweep = SWEEP * scale;
  const fade = FADE * scale;
  const start = performance.now();

  const draw = (t: number) => {
    const beam = from + (to - from) * Math.min(1, t / sweep);
    const out = Math.max(0, (t - sweep) / fade);
    const ease = out * out * (3 - 2 * out);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1 - ease;
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, h);
    // The beam: a faint wedge behind an accent edge, until the scatter.
    if (out === 0) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(pivot[0], pivot[1]);
      ctx.arc(pivot[0], pivot[1], w + h, beam - 0.22, beam);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pivot[0], pivot[1]);
      ctx.lineTo(pivot[0] + Math.cos(beam) * (w + h), pivot[1] + Math.sin(beam) * (w + h));
      ctx.stroke();
    }
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const g of glyphs) {
      // Lit as the beam passes: accent at first, settling to the page colour.
      const since = beam - g.bearing;
      const lit = since >= 0;
      const fresh = lit ? Math.max(0, 1 - since / 0.35) : 0;
      ctx.globalAlpha = (lit ? 0.55 + 0.45 * (1 - fresh) : 0.14) * (1 - ease);
      ctx.fillStyle = fresh > 0.3 ? accent : bg;
      const x = g.x + g.dx * ease;
      const y = g.y + g.dy * ease;
      const c = Math.cos(g.turn + ease * 0.5);
      const s = Math.sin(g.turn + ease * 0.5);
      ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * x, dpr * y);
      ctx.fillText(g.ch, 0, 0);
    }
    ctx.globalAlpha = 1;
  };

  draw(0);
  document.body.append(canvas);
  // The canvas now covers the page; the stylesheet's plain ink cover gives way to it.
  root.classList.add("intro-live");

  const tick = () => {
    const t = performance.now() - start;
    if (!root.classList.contains("intro") || t >= sweep + fade) {
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
