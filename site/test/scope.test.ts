import { describe, expect, it } from "vitest";
import {
  BLIP_HIT,
  MIN_GAP,
  RING_RADIUS,
  SCOPE_HALF,
  baseAngle,
  blipPoint,
  placeBlips,
  ringFor,
  sweepStep,
} from "../src/lib/scope";

const uid = (hex4: string, n = 0) => `${hex4}${n.toString(16).padStart(28, "0")}`;

/** Circular distance of two bearings in degrees, 0 to 180. */
const apart = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Twelve stories as an edition sorts them: most sources first. */
const twelve = [7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1].map((count, i) => ({
  uid: uid((0x1000 + i * 0x0400).toString(16), i),
  source_count: count,
}));

describe("ringFor", () => {
  it("puts 5+ sources on ring 1, 3–4 on ring 2 and 1–2 on ring 3", () => {
    expect([9, 5, 4, 3, 2, 1, 0].map(ringFor)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });
});

describe("baseAngle", () => {
  it("maps the uid's first four hex digits onto 0–359 degrees", () => {
    expect(baseAngle(uid("0000"))).toBe(0);
    expect(baseAngle(uid("8000"))).toBe(180);
    expect(baseAngle(uid("4000"))).toBe(90);
    expect(baseAngle(uid("ffff"))).toBe(359);
    expect(baseAngle(uid("FFFF"))).toBe(359);
  });
});

describe("placeBlips", () => {
  it("places one story at its own bearing on its ring", () => {
    expect(placeBlips([{ uid: uid("4000"), source_count: 3 }])).toEqual([{ uid: uid("4000"), ring: 2, angle: 90 }]);
  });

  it("is deterministic: the same input gives the same output, in input order", () => {
    const first = placeBlips(twelve);
    expect(placeBlips(twelve.map((s) => ({ ...s })))).toEqual(first);
    expect(first.map((b) => b.uid)).toEqual(twelve.map((s) => s.uid));
  });

  it("keeps twelve stories at least 22° apart on every ring, and more where a ring is small", () => {
    const crowded = twelve.map((s, i) => ({ ...s, uid: uid("1234", i) }));
    for (const input of [twelve, crowded]) {
      const placed = placeBlips(input);
      for (const ring of [1, 2, 3] as const) {
        const on = placed.filter((b) => b.ring === ring);
        for (let i = 0; i < on.length; i++) {
          for (let j = i + 1; j < on.length; j++) {
            expect(apart(on[i].angle, on[j].angle)).toBeGreaterThanOrEqual(Math.max(22, MIN_GAP[ring]));
          }
        }
      }
      for (const b of placed) {
        expect(Number.isInteger(b.angle)).toBe(true);
        expect(b.angle).toBeGreaterThanOrEqual(0);
        expect(b.angle).toBeLessThan(360);
      }
    }
  });

  it("nudges a blip off a taken bearing instead of stacking it", () => {
    const placed = placeBlips([
      { uid: uid("0000", 1), source_count: 3 },
      { uid: uid("0000", 2), source_count: 3 },
    ]);
    expect(placed[0].angle).toBe(0);
    expect(placed[1].ring).toBe(2);
    expect(apart(placed[0].angle, placed[1].angle)).toBe(MIN_GAP[2]);
  });

  it("spills to the next ring outward when a ring is full", () => {
    const loud = Array.from({ length: 12 }, (_, i) => ({ uid: uid("2000", i), source_count: 8 }));
    const placed = placeBlips(loud);
    const capacity = Math.floor(360 / MIN_GAP[1]);
    expect(placed.filter((b) => b.ring === 1)).toHaveLength(capacity);
    expect(placed.filter((b) => b.ring === 2)).toHaveLength(12 - capacity);
    // The spilled ones are the last in order, so the loudest keep the centre.
    expect(placed.slice(0, capacity).every((b) => b.ring === 1)).toBe(true);
  });
});

describe("blipPoint", () => {
  it("puts bearing 0 straight up and turns clockwise", () => {
    const r = RING_RADIUS[3];
    expect(blipPoint(3, 0)).toEqual({ x: 0, y: -r });
    expect(blipPoint(3, 90)).toEqual({ x: r, y: 0 });
    expect(blipPoint(3, 180)).toEqual({ x: 0, y: r });
    expect(blipPoint(3, 270)).toEqual({ x: -r, y: 0 });
  });

  it("keeps every blip's whole hit area inside the instrument for 1 and 12 stories", () => {
    for (const input of [[{ uid: uid("e000"), source_count: 1 }], twelve]) {
      for (const b of placeBlips(input)) {
        const { x, y } = blipPoint(b.ring, b.angle);
        expect(Math.abs(x) + BLIP_HIT).toBeLessThanOrEqual(SCOPE_HALF);
        expect(Math.abs(y) + BLIP_HIT).toBeLessThanOrEqual(SCOPE_HALF);
      }
    }
  });

  it("never lets two hit areas of twelve stories overlap", () => {
    const points = placeBlips(twelve).map((b) => blipPoint(b.ring, b.angle));
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(d).toBeGreaterThanOrEqual(2 * BLIP_HIT);
      }
    }
  });
});

describe("sweepStep", () => {
  it("rounds a bearing to the nearest 15° step, 0 to 23", () => {
    expect([0, 7, 8, 15, 180, 352, 353, 359].map(sweepStep)).toEqual([0, 0, 1, 1, 12, 23, 0, 0]);
  });
});
