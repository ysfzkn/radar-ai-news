// The scope: where each story of an edition sits on the instrument (plan 7, decision D2).
// Pure and deterministic, so a page is built the same way every time.
//
// Geometry is in the instrument's own units: the drawing runs from -100 to 100 on both axes,
// the centre at 0, bearing 0 straight up and bearings turning clockwise.

export type Ring = 1 | 2 | 3;

export interface Placed {
  uid: string;
  ring: Ring;
  /** Bearing in whole degrees, 0 to 359. */
  angle: number;
}

/** Half the drawing's width: the box runs from -SCOPE_HALF to SCOPE_HALF. */
export const SCOPE_HALF = 100;

/** Ring radii, innermost first. 25 units apart: one whole hit area (2 × BLIP_HIT), so blips on
 *  neighbouring rings never share a target. */
export const RING_RADIUS: Record<Ring, number> = { 1: 30, 2: 55, 3: 80 };

/**
 * A blip's tap target radius. On a phone the card is capped at 280px and the drawing is 261px
 * across its 200 units, so a target of 25 units is 32.6px; on a wider screen it is larger.
 */
export const BLIP_HIT = 12.5;

/** The dot drawn inside the hit area. */
export const BLIP_DOT = 7;

/**
 * Least bearing between two blips of one ring. Never under 22°; on the two inner rings 22° would
 * let two hit areas overlap, so each ring keeps the chord between neighbours at least 2 × BLIP_HIT.
 */
export const MIN_GAP: Record<Ring, number> = { 1: 50, 2: 27, 3: 22 };

/**
 * The most blips the rings can hold at their least gap: 7 + 13 + 16 = 36. Nudged bearings leave
 * gaps, so a crowded edition may fill the rings with fewer; editions have 5 to 8 stories.
 */
export const RING_CAPACITY = ([1, 2, 3] as Ring[]).reduce((n, ring) => n + Math.floor(360 / MIN_GAP[ring]), 0);

/** Sources per ring: the louder a story, the nearer the centre. */
export const RING_SOURCES: Record<Ring, string> = { 1: "5+", 2: "3–4", 3: "1–2" };

export function ringFor(sourceCount: number): Ring {
  if (sourceCount >= 5) return 1;
  if (sourceCount >= 3) return 2;
  return 3;
}

/** The uid's first four hex digits spread over 0–359°. */
export function baseAngle(uid: string): number {
  const n = Number.parseInt(uid.slice(0, 4), 16);
  return Number.isFinite(n) ? Math.floor((n * 360) / 65536) : 0;
}

const apart = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** The free bearing on a ring nearest to `want` (trying +1°, −1°, +2°, … in turn), or null. */
function freeBearing(taken: number[], want: number, gap: number): number | null {
  for (let d = 0; d <= 180; d++) {
    for (const angle of d === 0 ? [want] : [want + d, want - d]) {
      const a = ((angle % 360) + 360) % 360;
      if (taken.every((t) => apart(t, a) >= gap)) return a;
    }
  }
  return null;
}

/**
 * Places the stories in the order given (an edition's order: most sources first). Each takes
 * its bearing from its uid, nudged until it keeps MIN_GAP from the blips already on its ring;
 * if its ring has no room it spills to the next ring outward (and from the outermost, inward).
 */
export function placeBlips(stories: { uid: string; source_count: number }[]): Placed[] {
  const taken: Record<Ring, number[]> = { 1: [], 2: [], 3: [] };
  return stories.map(({ uid, source_count }) => {
    const want = baseAngle(uid);
    const home = ringFor(source_count);
    const outward = ([1, 2, 3] as Ring[]).filter((r) => r >= home);
    const inward = ([3, 2, 1] as Ring[]).filter((r) => r < home);
    for (const ring of [...outward, ...inward]) {
      const angle = freeBearing(taken[ring], want, MIN_GAP[ring]);
      if (angle !== null) {
        taken[ring].push(angle);
        return { uid, ring, angle };
      }
    }
    // No ring has room (at most RING_CAPACITY blips fit, fewer once nudged bearings leave gaps):
    // stack on the outermost ring at the uid's own bearing.
    return { uid, ring: 3 as Ring, angle: want };
  });
}

const round = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** A blip's centre in drawing units. */
export function blipPoint(ring: Ring, angle: number): { x: number; y: number } {
  const r = RING_RADIUS[ring];
  const rad = (angle * Math.PI) / 180;
  return { x: round(r * Math.sin(rad)), y: round(-r * Math.cos(rad)) };
}

/** The 15° step (0–23) at which the sweep passes a bearing; the stylesheet turns it into a delay. */
export function sweepStep(angle: number): number {
  return Math.round((((angle % 360) + 360) % 360) / 15) % 24;
}
