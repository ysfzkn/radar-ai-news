// The home page's globe as numbers: its lattice of points, where the day's stories stand on it, and
// how a point is seen (turned about the axis, tipped toward the reader, put in perspective, lit).
// Hero.astro draws one frame of it as an SVG at build; scripts/hero.ts draws it live on a canvas.
// Units: the globe's radius is 1; x to the right, y up, z toward the reader.

export const TAU = Math.PI * 2;
/** The camera looks down on the globe by this much (radians). */
export const TILT = 0.38;
/** The camera's distance in radii: nearer points are a little larger. */
const DIST = 4.4;
/** The light, from the upper left and in front, in view space (unit length). */
const LIGHT = [-0.52, 0.6, 0.61];
/** The still frame's turn and sweep (radians). */
export const SPIN = 0.9;
export const SWEEP = 0.35;
/** Behind the sweep, points stay lit over this angle (radians). */
export const TRAIL = 0.8;
/** The equatorial bezel and the tipped orbit, in radii, and the orbit's inclination. */
export const BEZEL = 1.3;
export const ORBIT = 1.52;
export const INCLINE = 1.05;
/** The square box the scene is drawn in is this many radii wide (Hero.astro's viewBox, the CSS box). */
export const BOX = 3.6;
/** A dot's tone is drawn from this many strengths and shadows. */
export const LEVELS = 10;
export const SHADES = 4;

/** `n` points spread evenly over the sphere (a Fibonacci lattice), each with its weight: heavier
 * on the "land" of a smooth noise field, so the globe has a coastline without a map. */
export function lattice(n: number): { xyz: Float32Array; w: Float32Array } {
  const xyz = new Float32Array(n * 3);
  const w = new Float32Array(n);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(1 - y * y);
    const x = Math.cos(g * i) * r;
    const z = Math.sin(g * i) * r;
    xyz.set([x, y, z], i * 3);
    const land =
      Math.sin(2.7 * x + 1.3) * Math.sin(2.1 * y + 0.6) * Math.sin(2.4 * z + 2.1) +
      0.45 * Math.sin(5.1 * x - 4.3 * z + 0.7) * Math.cos(4.7 * y + 1.9);
    w[i] = land > 0.08 ? 1.4 : 0.55;
  }
  return { xyz, w };
}

/** Turns (x, y, z) by `a` about the vertical axis, then tips it toward the reader by `t`. */
export function view(x: number, y: number, z: number, a: number, t: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x1 = x * c + z * s;
  const z1 = z * c - x * s;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return [x1, y * ct - z1 * st, y * st + z1 * ct];
}

/** How much larger a point at depth z looks. */
export const persp = (z: number) => DIST / (DIST - z);

/** The radius of the globe's outline as the camera sees it, in radii: DIST / √(DIST² − 1). */
export const LIMB = 1.027;

/** A point of the tipped orbit at angle k (before the camera's turn and tip). */
export function orbit(k: number): [number, number, number] {
  const [x, y, z] = [Math.cos(k), Math.sin(k) * Math.sin(INCLINE), Math.sin(k) * Math.cos(INCLINE)];
  // Its node turned a little, so the ring crosses the globe on a diagonal.
  return [(x * 0.77 - z * 0.64) * ORBIT, y * ORBIT, (z * 0.77 + x * 0.64) * ORBIT];
}

/** A point on the unit sphere, seen: its strength (0 pale and far … 1 near) and its shadow (0 lit … 1
 * past the terminator), each as a level, and its radius in radii. */
export function tone(x: number, y: number, z: number, w: number): [number, number, number] {
  const d = (z + 1) / 2;
  const lambert = x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2];
  const shadow = Math.min(1, Math.max(0, 0.55 - lambert * 1.25));
  const strength = Math.min(1, 0.12 + 0.88 * d ** 1.3 * (0.45 + 0.45 * w));
  const size = 0.0088 * persp(z) * (0.35 + 0.75 * d) * w;
  return [Math.round(strength * (LEVELS - 1)), Math.round(shadow * (SHADES - 1)), size];
}

/** The colour of a strength level and a shadow level: from the warm paper (none) to a warm
 * grey-brown in the light or a near-black past the terminator (full). */
export function ink(level: number, shade: number): string {
  const s = level / (LEVELS - 1);
  const k = shade / (SHADES - 1);
  return `hsl(34 ${Math.round(25 - s * (6 + 15 * k))}% ${Math.round(89 - s * (58 + 26 * k))}%)`;
}

/** The light falling on the globe's body: its brightest point on the disc (as fractions of the
 * radius), toward the light (LIGHT × 0.55, y down). */
export const HIGHLIGHT = [-0.286, -0.33];

/** Where the `i`-th of `n` stories stands: latitude and longitude (radians), spread round the
 * globe in story order, in a band either side of the equator. */
export function pin(i: number, n: number): [number, number] {
  const band = [0.42, -0.28, 0.7, -0.05, 0.25, -0.5, 0.55, 0.1, -0.35, 0.36];
  return [band[i % band.length], 0.3 - (i * TAU) / Math.max(n, 1)];
}

/** The unit-sphere point of a latitude and longitude (longitude 0 faces the reader). */
export function onSphere(lat: number, lon: number, r = 1): [number, number, number] {
  return [Math.cos(lat) * Math.sin(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.cos(lon) * r];
}
