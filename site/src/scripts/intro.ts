// The loading screen. boot.js has already decided, before the first paint, whether this view opens
// (the first page of a browser session): if so <html> carries `intro` and the stylesheet paints the
// page ink. Here a scope takes over: three range rings, the day's headlines running round them as
// glyphs, a sweep that turns over them and lights each glyph and each story's blip as it passes,
// a counter from 000 to 100 with a status line. Then the rings close into the brand mark `)))`,
// the issue shows under it for a beat, and an iris opens from the mark while the mark flies to its
// place in the top strip. Every beat is counted from when this script starts, never from the
// navigation, so a slow network does not cut the opening short. Anything that removes `intro` (a
// press, a key, a hidden tab, boot.js's 3500 ms cap) ends it on the next frame. Text reaches only
// the canvas, never the DOM.

const root = document.documentElement;

/** The beats: the scan, the rings closing into the mark, the mark held, the iris opening. */
const SCAN = 1450;
const CLOSE = 300;
const HOLD = 140;
const OPEN = 420;
/** The counter reaches 100 as the rings close. */
const COUNT = SCAN + CLOSE;

/** The mark's arcs (Mark.astro: `M x 4 A 13 13 0 0 1 x 20` in a 24-unit box). */
const ARCS = [5, 11, 17];
const RADIUS = 13;
const HALF = Math.asin(8 / RADIUS);
const SHIFT = Math.sqrt(RADIUS * RADIUS - 64);
const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;

const WORDS = {
  tr: {
    status: ["SİNYAL ARANIYOR", "KAYNAKLAR TARANIYOR", "BASKI DİZİLİYOR", "HAZIR"],
    place: "41.01°K 28.98°D · İSTANBUL",
    skip: "ATLAMAK İÇİN BİR TUŞA BAS",
    tap: "ATLAMAK İÇİN DOKUN",
  },
  en: {
    status: ["ACQUIRING SIGNAL", "SCANNING SOURCES", "SETTING THE EDITION", "READY"],
    place: "41.01°N 28.98°E · ISTANBUL",
    skip: "PRESS ANY KEY TO SKIP",
    tap: "TAP TO SKIP",
  },
};

interface Glyph {
  ch: string;
  /** Its bearing, clockwise from straight up, in [0, TAU). */
  at: number;
  r: number;
}

interface Blip {
  x: number;
  y: number;
  at: number;
}

function finish(canvas?: HTMLCanvasElement): void {
  canvas?.remove();
  root.classList.remove("intro", "intro-live");
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Bearing clockwise from straight up, in [0, TAU). */
const bearing = (x: number, y: number) => (Math.atan2(y, x) - TOP + TAU) % TAU;

function run(): void {
  if (!root.classList.contains("intro")) return;
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
  const words = WORDS[lang];
  const skip = matchMedia("(pointer: coarse)").matches ? words.tap : words.skip;
  const up = (s: string) => s.toLocaleUpperCase(lang);
  const read = (selector: string) =>
    [...document.querySelectorAll(selector)].map((el) => (el.textContent ?? "").trim()).filter(Boolean);

  // The headlines of this page, else its description: read as text, drawn only on the canvas.
  const titles = read(".story-title, .row-lead, .list-title");
  const about = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? document.title;
  const text = up((titles.length ? titles : [about]).join(" · ")) + " · ";
  // The issue, read from the masthead as text ("SAYI 4 · 20 KASIM"); elsewhere the page's own name.
  const issue = up(
    [document.querySelector(".masthead .mh-no"), document.querySelector(".masthead .mh-big")]
      .map((el) => (el?.textContent ?? "").trim())
      .filter(Boolean)
      .join(" · ") || document.title.split(" · ")[0],
  );

  const small = Math.min(w, h);
  const R = Math.min(w * 0.4, h * 0.3, 300);
  const cx = w / 2;
  const cy = h / 2 - small * 0.03;
  const rings = [0.38, 0.67, 0.96].map((f) => f * R);
  const size = Math.round(Math.max(9, Math.min(14, R / 17)));
  const label = w < 600 ? 11 : 12;
  const pad = w < 600 ? 16 : 28;

  // The glyphs: one row just inside each ring, each row starting somewhere else in the text.
  const glyphs: Glyph[] = [];
  rings.forEach((ring, band) => {
    const r = ring - size * 0.95;
    const count = Math.floor((TAU * r) / (size * 0.74));
    let k = Math.floor((band * text.length) / 3);
    for (let i = 0; i < count; i++) {
      const ch = text[k++ % text.length];
      if (ch !== " ") glyphs.push({ ch, at: (i / count) * TAU, r });
    }
  });

  // The blips: the scope's own (the day's stories where they sit on the edition's scope), else a
  // few placed from the text, so every page has its own picture.
  const blips: Blip[] = [...document.querySelectorAll(".blip g")]
    .map((g) => (g.getAttribute("transform") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [])
    .filter((p) => p.length === 2)
    .map(([x, y]) => ({ x: (x / 100) * R, y: (y / 100) * R, at: bearing(x, y) }));
  for (let i = 0; blips.length < 5 && i < 5; i++) {
    const code = text.charCodeAt(i * 7) || 7;
    const a = ((code * 37 + i * 71) % 360) * (Math.PI / 180);
    const r = rings[i % 3] - R * 0.12;
    blips.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, at: bearing(Math.cos(a), Math.sin(a)) });
  }

  // The mark, where the rings close: the window's centre, at least 96 px.
  const markUnit = Math.max(96, small * 0.22) / 24;
  const markX = cx - 12.4 * markUnit;
  const markY = cy - 12 * markUnit;
  // Where it lands: the mark beside the wordmark, if it is on screen.
  const target = document.querySelector(".wordmark .mark")?.getBoundingClientRect();
  const lands = !!target && target.width > 0 && target.bottom > 0 && target.top < h;
  const far = Math.hypot(w, h);
  const start = performance.now();

  const font = (weight: number, px: number) => {
    ctx.font = `${weight} ${px}px ${mono}`;
  };
  const write = (s: string, x: number, y: number, align: CanvasTextAlign, room = Infinity) => {
    if (ctx.measureText(s).width > room) return;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };

  /** The three arcs at step p from the rings (0) to the mark (1), with the mark at (mx, my) and unit u. */
  const arcs = (p: number, mx: number, my: number, u: number) => {
    ARCS.forEach((x, i) => {
      const span = lerp(Math.PI, HALF, p);
      ctx.beginPath();
      ctx.arc(lerp(cx, mx + (x - SHIFT) * u, p), lerp(cy, my + 12 * u, p), lerp(rings[i], RADIUS * u, p), -span, span);
      ctx.stroke();
    });
  };

  const draw = (t: number) => {
    const close = smooth((t - SCAN) / CLOSE);
    const open = smooth((t - SCAN - CLOSE - HOLD) / OPEN);
    const rest = 1 - close;
    // The sweep: 1.2 turns over the scan, clockwise from straight up.
    const turned = TAU * 1.2 * Math.min(1, t / SCAN);
    const beam = TOP + turned;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    // The ink, with the iris opening in it from the mark's centre; an accent rim on its edge.
    const hole = open * far;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    if (hole > 0) ctx.arc(cx, cy, hole, 0, TAU, true);
    ctx.fill("evenodd");
    if (hole > 0) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, hole, 0, TAU);
      ctx.stroke();
    }
    ctx.lineCap = "round";

    if (rest > 0) {
      ctx.globalAlpha = rest;
      // The plate: a cross and the ticks round the outer ring.
      ctx.strokeStyle = bg;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.12 * rest;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy);
      ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx, cy + R);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const long = i % 6 === 0 ? 9 : 4;
        ctx.moveTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
        ctx.lineTo(cx + Math.cos(a) * (R + 6 + long), cy + Math.sin(a) * (R + 6 + long));
      }
      ctx.stroke();
      // The beam: a faint wedge behind an accent edge.
      if (t < SCAN) {
        ctx.globalAlpha = 0.16 * rest;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, beam - 0.55, beam);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = rest;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(beam) * R, cy + Math.sin(beam) * R);
        ctx.stroke();
      }
      // The glyphs: dim until the beam passes, a flash of accent, then the page colour.
      font(600, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const g of glyphs) {
        const since = turned - g.at;
        const behind = ((since % TAU) + TAU) % TAU;
        ctx.globalAlpha = (since >= 0 ? 0.92 : 0.2) * rest;
        ctx.fillStyle = since >= 0 && behind < 0.4 ? accent : bg;
        const a = TOP + g.at;
        const c = Math.cos(a + Math.PI / 2);
        const s = Math.sin(a + Math.PI / 2);
        ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * (cx + Math.cos(a) * g.r), dpr * (cy + Math.sin(a) * g.r));
        ctx.fillText(g.ch, 0, 0);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The blips: lit as the beam passes, each with an echo ring that leaves and fades.
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      for (const b of blips) {
        const since = turned - b.at;
        if (since < 0) continue;
        const k = clamp((((since % TAU) + TAU) % TAU) / 2.2);
        ctx.globalAlpha = rest;
        ctx.beginPath();
        ctx.arc(cx + b.x, cy + b.y, 4, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = (1 - k) * rest;
        ctx.beginPath();
        ctx.arc(cx + b.x, cy + b.y, 4 + k * 22, 0, TAU);
        ctx.stroke();
      }
    }

    // The rings, drawn in at the start, closing into the mark, which then flies to the top strip.
    const fly = lands ? open : 0;
    const u = lerp(markUnit, lands ? target!.width / 24 : markUnit, fly);
    const mx = lerp(markX, lands ? target!.left : markX, fly);
    const my = lerp(markY, lands ? target!.top : markY, fly);
    ctx.globalAlpha = lands ? 1 : 1 - open;
    ctx.strokeStyle = close > 0 ? accent : bg;
    ctx.lineWidth = lerp(1.25, 2.25 * u, close);
    if (close === 0) {
      ctx.globalAlpha = 0.5;
      rings.forEach((r, i) => {
        const drawn = clamp((t - i * 90) / 420);
        if (drawn === 0) return;
        ctx.beginPath();
        ctx.arc(cx, cy, r, TOP, TOP + drawn * TAU);
        ctx.stroke();
      });
    } else {
      arcs(close, mx, my, u);
    }

    // The labels: the issue and the place at the top, the counter and its status at the bottom.
    ctx.globalAlpha = 1 - open;
    ctx.fillStyle = bg;
    ctx.textBaseline = "alphabetic";
    font(600, label);
    write(`RADAR ))) ${issue}`, pad, pad + label, "left", w - 2 * pad);
    ctx.globalAlpha = 0.6 * (1 - open);
    write(words.place, w - pad, pad + label, "right", w / 2 - pad * 1.5);
    const pct = Math.round(100 * smooth(t / COUNT) ** 0.8);
    const status = words.status[pct >= 100 ? 3 : pct >= 62 ? 2 : pct >= 28 ? 1 : 0];
    const big = Math.round(Math.max(30, Math.min(56, small * 0.09)));
    const base = h - pad - label * 2.2;
    ctx.globalAlpha = 1 - open;
    font(700, big);
    write(String(pct).padStart(3, "0"), pad, base, "left");
    const numberWidth = ctx.measureText("000").width;
    font(700, Math.round(big * 0.42));
    write("%", pad + numberWidth + 6, base - big * 0.42, "left");
    font(600, label);
    const cursor = Math.floor(t / 260) % 2 ? " " : "_";
    write(`> ${status}${cursor}`, pad, base + label * 1.9, "left");
    ctx.globalAlpha = 0.55 * (1 - open);
    // The way out: beside the status on a wide screen, under the issue on a narrow one.
    if (w < 600) write(skip, pad, pad + label * 2.8, "left");
    else write(skip, w - pad, base + label * 1.9, "right");
    // A hairline under it all that fills with the counter.
    ctx.fillStyle = bg;
    ctx.globalAlpha = 0.18 * (1 - open);
    ctx.fillRect(pad, h - pad, w - 2 * pad, 1);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 1 - open;
    ctx.fillRect(pad, h - pad - 1, ((w - 2 * pad) * pct) / 100, 2);
    // Under the closed mark, the issue for a beat.
    const named = smooth((t - SCAN - CLOSE * 0.8) / 120);
    if (named > 0 && open < 1) {
      ctx.globalAlpha = named * (1 - open);
      ctx.fillStyle = bg;
      font(600, Math.max(12, label + 1));
      ctx.textAlign = "center";
      ctx.fillText(issue, cx, markY + 24 * markUnit + label * 2.4);
    }
    ctx.globalAlpha = 1;
  };

  draw(0);
  document.body.append(canvas);
  // The canvas now covers the page; the stylesheet's plain ink cover gives way to it.
  root.classList.add("intro-live");

  const end = SCAN + CLOSE + HOLD + OPEN;
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
