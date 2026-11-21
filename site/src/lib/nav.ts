// The top strip's dial (Masthead.astro): which station a page tunes to, and the small counts the
// stories show beside it. Pure, so the same page is built the same way every time.
import { routes } from "./routes";
import type { Lang } from "./schema";

export type Section = "today" | "archive" | "week" | "about";

/** The dial's stations, left to right. */
export const SECTIONS: readonly Section[] = ["today", "archive", "week", "about"];

/** An edition with fewer stories than this shows earlier stories as ghosts on its scope … */
export const GHOST_FEW = 5;
/** … at most this many. */
export const GHOST_LIMIT = 8;

const EDITION = /^\/(?:en\/)?\d{4}-\d{2}-\d{2}\/$/;

/**
 * The station a page belongs to: the page itself (`exact`), or the nearest section. The newest
 * edition's own address is today's, an older edition and a topic are the archive's, a week is the
 * weeks'. The subscribe page and the 404 page are on no station.
 */
export function navSection(lang: Lang, path: string, latest: string | null): { section: Section; exact: boolean } | null {
  const r = routes[lang];
  const exact: Record<Section, string> = { today: r.home, archive: r.archive, week: r.weekIndex, about: r.about };
  for (const section of SECTIONS) if (path === exact[section]) return { section, exact: true };
  if (EDITION.test(path)) return { section: latest && path === r.edition(latest) ? "today" : "archive", exact: false };
  if (path.startsWith(r.topic("").slice(0, -1))) return { section: "archive", exact: false };
  if (path.startsWith(r.weekIndex)) return { section: "week", exact: false };
  return null;
}

/** The signal bars of a story: one for a single source, two for 2–3, three for 4 or more. */
export function signalLevel(sourceCount: number): 1 | 2 | 3 {
  return sourceCount >= 4 ? 3 : sourceCount >= 2 ? 2 : 1;
}
