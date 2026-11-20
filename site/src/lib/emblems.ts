// The eight category emblems: paper cut-outs in a 48-unit box. Each is a tile (the flat field)
// and two layers of cut paper above it, the middle one in a mid tint of the category's colour and
// the top one in the colour itself; each layer casts a hard ink shadow on what lies below.
// Pure geometry, no DOM: Emblem.astro draws it, a test checks it.
import type { Category } from "./schema";

/** One cut-out shape: an SVG path, with holes where `holes` is set (drawn even-odd). */
export interface Cut {
  d: string;
  holes?: boolean;
}

/** One sheet of paper: its shapes share one shadow. */
export type Sheet = Cut[];

export interface EmblemDrawing {
  /** Sheets of the middle layer, bottom first. */
  mid: Sheet[];
  /** Sheets of the top layer, bottom first. */
  top: Sheet[];
}

/** The drawing's box, the tile on it, and how far each layer's shadow falls. */
export const EMBLEM_BOX = 48;
export const TILE = { x: 4, y: 4, size: 36, radius: 3 } as const;
export const TILE_SHADOW = 2.5;
export const SHEET_SHADOW = 1.6;

const n = (v: number) => +v.toFixed(2);
const pt = (x: number, y: number) => `${n(x)} ${n(y)}`;

const circle = (cx: number, cy: number, r: number) =>
  `M${pt(cx - r, cy)}A${n(r)} ${n(r)} 0 1 0 ${pt(cx + r, cy)}A${n(r)} ${n(r)} 0 1 0 ${pt(cx - r, cy)}Z`;

const rect = (x: number, y: number, w: number, h: number) => `M${pt(x, y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;

const poly = (points: [number, number][]) => `M${points.map(([x, y]) => pt(x, y)).join("L")}Z`;

/** A bar with round ends from (x1, y1) to (x2, y2), `r` its half width. */
function capsule(x1: number, y1: number, x2: number, y2: number, r: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [nx, ny] = [(-(y2 - y1) / len) * r, ((x2 - x1) / len) * r];
  return (
    `M${pt(x1 + nx, y1 + ny)}L${pt(x2 + nx, y2 + ny)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${pt(x2 - nx, y2 - ny)}L${pt(x1 - nx, y1 - ny)}` +
    `A${n(r)} ${n(r)} 0 0 0 ${pt(x1 + nx, y1 + ny)}Z`
  );
}

/** A point at `deg` degrees (0 to the right, clockwise on screen) and radius `r` round (cx, cy). */
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy + r * Math.sin((deg * Math.PI) / 180),
];

/** A gear: `teeth` flat-topped teeth from radius `body` to `tip`. */
function gear(cx: number, cy: number, body: number, tip: number, teeth: number): string {
  const step = 360 / teeth;
  const points: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - 90;
    points.push(
      polar(cx, cy, body, a - step * 0.36),
      polar(cx, cy, tip, a - step * 0.2),
      polar(cx, cy, tip, a + step * 0.2),
      polar(cx, cy, body, a + step * 0.36),
    );
  }
  return poly(points);
}

/** A rosette (a seal's edge): `points` bumps between radius `inner` and `outer`. */
function rosette(cx: number, cy: number, inner: number, outer: number, points: number): string {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) out.push(polar(cx, cy, i % 2 ? inner : outer, (i * 180) / points - 90));
  return poly(out);
}

/** A wrench's open head: a disc round (cx, cy) with a jaw of half width `jaw` cut `depth` deep towards `deg`. */
function wrenchHead(cx: number, cy: number, r: number, deg: number, jaw: number, depth: number): string {
  const a = (deg * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [vx, vy] = [-uy, ux];
  const s = Math.sqrt(r * r - jaw * jaw);
  const at = (side: number, along: number) => pt(cx + side * jaw * vx + along * ux, cy + side * jaw * vy + along * uy);
  return `M${at(1, s)}L${at(1, s - depth)}L${at(-1, s - depth)}L${at(-1, s)}A${n(r)} ${n(r)} 0 1 0 ${at(1, s)}Z`;
}

export const EMBLEMS: Record<Category, EmblemDrawing> = {
  // Linked nodes: three rings joined in a closed triangle (an open V would be the share icon).
  protocol: {
    mid: [[{ d: capsule(12.5, 31, 31.5, 31, 1.7) }, { d: capsule(12.5, 31, 22, 14.5, 1.7) }, { d: capsule(31.5, 31, 22, 14.5, 1.7) }]],
    top: [
      [
        { d: circle(22, 14.5, 5.6) + circle(22, 14.5, 2.2), holes: true },
        { d: circle(12.5, 31, 5.6) + circle(12.5, 31, 2.2), holes: true },
        { d: circle(31.5, 31, 5.6) + circle(31.5, 31, 2.2), holes: true },
      ],
    ],
  },
  // Stacked layers: three plates seen from above, each its own sheet.
  model: {
    mid: [
      [{ d: poly([[22, 22.5], [35.5, 29.5], [22, 36.5], [8.5, 29.5]]) }],
      [{ d: poly([[22, 15.5], [35.5, 22.5], [22, 29.5], [8.5, 22.5]]) }],
    ],
    top: [[{ d: poly([[22, 8.5], [35.5, 15.5], [22, 22.5], [8.5, 15.5]]) }]],
  },
  // A scaffold: two standards and three ledgers, braced across both bays.
  framework: {
    mid: [
      [
        { d: rect(11, 8, 3.6, 29) },
        { d: rect(29.4, 8, 3.6, 29) },
        { d: rect(8.5, 10, 27, 3.2) },
        { d: rect(8.5, 20.9, 27, 3.2) },
        { d: rect(8.5, 31.8, 27, 3.2) },
      ],
    ],
    top: [[{ d: capsule(14.6, 20.9, 29.4, 13.2, 1.5) }, { d: capsule(14.6, 31.8, 29.4, 24.1, 1.5) }]],
  },
  // A gear with a spanner laid across it.
  tooling: {
    mid: [[{ d: gear(20, 20, 9.5, 13, 8) + circle(20, 20, 3.8), holes: true }]],
    top: [[{ d: capsule(11.5, 35, 27, 19.5, 2.4) }, { d: wrenchHead(29.6, 16.9, 6.4, -45, 2.3, 4.6) }]],
  },
  // A flask: the glass, then the liquid in it and one bubble.
  research: {
    mid: [
      [
        { d: "M18.5 9.5L18.5 17.5L9.8 32.2Q8 36.8 13 36.8L31 36.8Q36 36.8 34.2 32.2L25.5 17.5L25.5 9.5Z" },
        { d: rect(16, 6.5, 12, 3.4) },
      ],
    ],
    top: [[{ d: "M14.4 25.5L29.6 25.5L32.3 30.4Q34 34.6 30 34.6L14 34.6Q10 34.6 11.7 30.4Z" }, { d: circle(21, 19.5, 1.8) }]],
  },
  // A padlock: the shackle, then the body with its keyhole cut out.
  security: {
    mid: [[{ d: "M14 26V19.5A8 8 0 0 1 30 19.5V26H26.4V19.5A4.4 4.4 0 0 0 17.6 19.5V26Z" }]],
    top: [
      [
        {
          d:
            "M13.5 22H30.5Q33 22 33 24.5V34.5Q33 37 30.5 37H13.5Q11 37 11 34.5V24.5Q11 22 13.5 22Z" +
            "M20.9 30A2.7 2.7 0 1 1 23.1 30L23.7 33.6H20.3Z",
          holes: true,
        },
      ],
    ],
  },
  // Industry: a saw-tooth workshop with its windows cut out, and its chimney.
  industry: {
    mid: [
      [
        {
          d: "M8 37V19L15 24V19L22 24V19L29.5 24V37Z" + rect(10.6, 28.5, 2.8, 2.8) + rect(16.4, 28.5, 2.8, 2.8) + rect(22.2, 28.5, 2.8, 2.8),
          holes: true,
        },
      ],
    ],
    top: [[{ d: rect(29.5, 9, 5.5, 28) }]],
  },
  // A document with its lines cut out and a seal on a ribbon.
  policy: {
    mid: [
      [
        {
          d: "M10.5 7H25.5L32 13.5V37H10.5Z" + rect(14, 16, 11, 2) + rect(14, 21, 14, 2) + rect(14, 26, 7.5, 2),
          holes: true,
        },
      ],
    ],
    top: [
      [{ d: poly([[25.5, 7], [25.5, 13.5], [32, 13.5]]) }],
      [
        { d: poly([[26, 35], [24.4, 41.6], [27.2, 39.8], [29.8, 42], [31, 35.4]]) },
        { d: rosette(29, 32.2, 5.3, 6.4, 12) + circle(29, 32.2, 2.3), holes: true },
      ],
    ],
  },
};
