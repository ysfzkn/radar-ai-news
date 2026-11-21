// Draws the share card, public/og.png (1200 × 630), with nothing but Node: shapes as signed
// distances with a pixel of anti-aliasing, words in a 5 × 7 pixel face, PNG written with node:zlib.
// The picture: the scope on the page colour with its hard shadow, a sweep and the day's blips;
// beside it the mark `)))`, the name and the address. Run it again after changing the drawing:
//   node scripts/og-image.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1200;
const H = 630;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// The colour table of src/styles/tokens.css.
const C = {
  bg: hex("#f7f7f4"),
  surface: hex("#ffffff"),
  ink: hex("#17181a"),
  muted: hex("#5a5e66"),
  line: hex("#e4e4df"),
  border: hex("#83868c"),
  accent: hex("#c2371a"),
  accentSoft: hex("#fbeae5"),
  security: hex("#9f1239"),
  model: hex("#4338ca"),
  protocol: hex("#0f6b63"),
  tooling: hex("#8a4b06"),
  framework: hex("#1d4fbf"),
};

const px = new Float64Array(W * H * 3);
for (let i = 0; i < W * H; i++) px.set(C.bg, i * 3);

/** Paints `colour` over every pixel by the coverage `cover(x, y)` (0 to 1) inside the box. */
function paint(colour, box, cover) {
  const [x0, y0, x1, y1] = box.map((v, i) => Math.max(0, Math.min(i % 2 ? H : W, Math.round(v))));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = cover(x + 0.5, y + 0.5);
      if (a <= 0) continue;
      const k = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) px[k + c] += (colour[c] - px[k + c]) * Math.min(1, a);
    }
  }
}

const aa = (d) => Math.max(0, Math.min(1, 0.5 - d));
const disc = (cx, cy, r, colour) => paint(colour, [cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2], (x, y) => aa(Math.hypot(x - cx, y - cy) - r));
const ring = (cx, cy, r, w, colour) =>
  paint(colour, [cx - r - w, cy - r - w, cx + r + w, cy + r + w], (x, y) => aa(Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2));
const rect = (x0, y0, x1, y1, colour) => paint(colour, [x0, y0, x1, y1], () => 1);

function segment(ax, ay, bx, by, w, colour) {
  const box = [Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w];
  paint(colour, box, (x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return aa(Math.hypot(x - ax - t * dx, y - ay - t * dy) - w / 2);
  });
}

/** An arc from angle a0 to a1 (radians, a0 < a1, y down) with round caps. */
function arc(cx, cy, r, a0, a1, w, colour) {
  const ends = [a0, a1].map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  paint(colour, [cx - r - w, cy - r - w, cx + r + w, cy + r + w], (x, y) => {
    let a = Math.atan2(y - cy, x - cx);
    while (a < a0) a += 2 * Math.PI;
    const d = a <= a1 ? Math.abs(Math.hypot(x - cx, y - cy) - r) : Math.min(...ends.map(([ex, ey]) => Math.hypot(x - ex, y - ey)));
    return aa(d - w / 2);
  });
}

/** A filled sector from a0 to a1, at 4 × 4 samples a pixel. */
function wedge(cx, cy, r, a0, a1, colour, strength) {
  paint(colour, [cx - r, cy - r, cx + r, cy + r], (x, y) => {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const sx = x - 0.5 + (i + 0.5) / 4;
        const sy = y - 0.5 + (j + 0.5) / 4;
        if (Math.hypot(sx - cx, sy - cy) > r) continue;
        let a = Math.atan2(sy - cy, sx - cx);
        while (a < a0) a += 2 * Math.PI;
        if (a <= a1) n++;
      }
    }
    return (n / 16) * strength;
  });
}

// The 5 × 7 pixel face: only the letters the card uses.
const FACE = {
  A: ".###.#...##...#######...##...##...#",
  C: ".#####....#....#....#....#.....####",
  D: "####.#...##...##...##...##...#####.",
  E: "######....#....####.#....#....#####",
  H: "#...##...##...#######...##...##...#",
  I: "#####..#....#....#....#....#..#####",
  K: "#...##..#.#.#..##...#.#..#..#.#...#",
  L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##.#.##...##...##...#",
  N: "#...###..##.#.##..###...##...##...#",
  O: ".###.#...##...##...##...##...#.###.",
  R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.",
  T: "#####..#....#....#....#....#....#..",
  U: "#...##...##...##...##...##...#.###.",
  Y: "#...##...#.#.#...#....#....#....#..",
  Z: "#####....#...#...#...#...#....#####",
  F: "######....#....####.#....#....#....",
  W: "#...##...##...##.#.##.#.###.###...#",
  "+": ".......#....#..#####..#....#.......",
  ".": "..............................##...",
  "·": "...............#...................",
  "/": "....#...#....#...#....#...#....#...",
  " ": "...................................",
};

function words(text, x, y, scale, colour) {
  let at = x;
  for (const ch of text) {
    const glyph = FACE[ch];
    if (!glyph) throw new Error(`no glyph for ${ch}`);
    for (let i = 0; i < 35; i++) {
      if (glyph[i] !== "#") continue;
      const gx = at + (i % 5) * scale;
      const gy = y + Math.floor(i / 5) * scale;
      rect(gx, gy, gx + scale, gy + scale, colour);
    }
    at += 6 * scale;
  }
  return at - scale;
}

// The scope: a white face over a hard ink shadow, rings and a cross in hairlines, ticks on the rim.
const sx = 318;
const sy = 315;
const R = 236;
disc(sx + 10, sy + 10, R + 2, C.ink);
disc(sx, sy, R + 2, C.ink);
disc(sx, sy, R - 1, C.surface);
for (const r of [80, 158]) ring(sx, sy, r, 2, C.line);
ring(sx, sy, R - 18, 2, C.line);
segment(sx - R + 18, sy, sx + R - 18, sy, 2, C.line);
segment(sx, sy - R + 18, sx, sy + R - 18, 2, C.line);
for (let i = 0; i < 72; i++) {
  const a = (i / 72) * 2 * Math.PI;
  const long = i % 6 === 0 ? 14 : 6;
  const c = Math.cos(a);
  const s = Math.sin(a);
  segment(sx + c * (R - 4), sy + s * (R - 4), sx + c * (R - 4 - long), sy + s * (R - 4 - long), 2, C.border);
}
// The sweep, pointing up and to the right, with its fading trail.
const beam = -Math.PI / 2 + 0.95;
for (let k = 0; k < 6; k++) wedge(sx, sy, R - 18, beam - 1.0 + k * 0.16, beam, C.accent, 0.045);
segment(sx, sy, sx + Math.cos(beam) * (R - 18), sy + Math.sin(beam) * (R - 18), 4, C.accent);
// The day's blips, in their categories' colours; the one the sweep just passed rings.
const blips = [
  [0.45, -0.2, C.security],
  [0.62, 0.35, C.model],
  [-0.3, 0.55, C.protocol],
  [-0.62, -0.28, C.tooling],
  [0.05, 0.78, C.framework],
];
for (const [bx, by, colour] of blips) disc(sx + bx * R, sy + by * R, 12, colour);
ring(sx + 0.45 * R, sy - 0.2 * R, 24, 2.5, C.accent);
disc(sx, sy, 6, C.ink);

// The mark: three arcs, as in Mark.astro (`M x 4 A 13 13 0 0 1 x 20`), 9 px a unit.
const u = 9;
const mx = 622;
const my = 160;
const half = Math.asin(8 / 13);
const shift = Math.sqrt(13 * 13 - 64);
for (const x of [5, 11, 17]) arc(mx + (x - shift) * u, my + 12 * u, 13 * u, -half, half, 2.25 * u, C.accent);

// The name beside it, then a rule, the line and the address.
words("RADAR", 846, 230, 11, C.ink);
rect(646, 380, 1140, 384, C.ink);
words("TECH + AI NEWS", 646, 422, 4, C.ink);
words("RADAR.OZKANYUSUF.COM", 646, 494, 4, C.muted);
// The two languages, as the strip's switch: TR on the chip, EN beside it, in one outline.
rect(1022, 414, 1140, 458, C.border);
rect(1024, 416, 1138, 456, C.bg);
rect(1024, 416, 1080, 456, C.line);
rect(1080, 416, 1082, 456, C.border);
words("TR", 1030, 422, 4, C.ink);
words("EN", 1089, 422, 4, C.muted);
// A thin accent rule along the foot, like the edition's progress line.
rect(0, H - 8, W, H, C.accent);

// The PNG: 8-bit RGB, no interlace, one zlib stream of filter-0 rows.
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.round(px[y * W * 3 + x]);
}
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../public/og.png", import.meta.url), png);
console.log(`public/og.png: ${png.length} bytes`);
