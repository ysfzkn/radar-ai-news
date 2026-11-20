import { COPY } from "./copy";
import type { Category, Lang } from "./schema";

/** Weekday index (0 = Sunday) of a "YYYY-MM-DD" date, by plain UTC arithmetic. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month: month - 1, day };
}

export function longDate(date: string, lang: Lang): string {
  const { year, month, day } = parts(date);
  const copy = COPY[lang];
  const weekday = copy.weekdays[weekdayOf(date)];
  const monthName = copy.months[month];
  return lang === "tr"
    ? `${day} ${monthName} ${year} ${weekday}`
    : `${weekday}, ${day} ${monthName} ${year}`;
}

/** "20 Kasım" / "20 November": the edition masthead's big line, without weekday and year. */
export function dayMonth(date: string, lang: Lang): string {
  const { month, day } = parts(date);
  return `${day} ${COPY[lang].months[month]}`;
}

/** "Cuma" / "Friday". */
export function weekdayName(date: string, lang: Lang): string {
  return COPY[lang].weekdays[weekdayOf(date)];
}

/** "2026". */
export function yearOf(date: string): string {
  return String(parts(date).year);
}

/** "Sayı 4 · 20 Kasım 2026 · Radar": an edition page's <title>. */
export function editionTitle(number: number, date: string, lang: Lang): string {
  const { year, month, day } = parts(date);
  const copy = COPY[lang];
  return `${copy.issue(number)} · ${day} ${copy.months[month]} ${year} · ${copy.siteName}`;
}

export function shortDate(date: string, lang: Lang): string {
  const { month, day } = parts(date);
  return `${day} ${COPY[lang].monthsShort[month]}`;
}

/**
 * "47. hafta · 16–22 Kasım 2026" for week "2026-W47" from Monday to Sunday;
 * both ends in full when the week crosses a month: "28 Aralık 2026 – 3 Ocak 2027".
 */
export function weekHeading(id: string, from: string, to: string, lang: Lang): string {
  return `${weekName(id, lang)} · ${dateRange(from, to, lang)}`;
}

/** "2026-W07" -> "7. hafta" / "Week 7". */
export function weekName(id: string, lang: Lang): string {
  return COPY[lang].weekLabel(Number(id.slice(id.indexOf("W") + 1)));
}

/** "16–22 Kasım 2026", or both ends in full across a month: "28 Aralık 2026 – 3 Ocak 2027". */
export function dateRange(from: string, to: string, lang: Lang): string {
  const months = COPY[lang].months;
  const a = parts(from);
  const b = parts(to);
  const full = (d: typeof a) => `${d.day} ${months[d.month]} ${d.year}`;
  return a.year === b.year && a.month === b.month ? `${a.day}–${full(b)}` : `${full(a)} – ${full(b)}`;
}

/** "https://www.a2ui.org/x" -> "a2ui.org"; "" if it does not parse. */
export function hostLabel(url: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const host = new URL(candidate).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/** The url when it is absolute http(s), else null: the only way a URL reaches an href. */
export function httpUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// The class that gives an element its category's colour, from the known list only.
const CATEGORY_CLASS: Record<Category, string> = {
  protocol: "cat-protocol",
  model: "cat-model",
  framework: "cat-framework",
  tooling: "cat-tooling",
  research: "cat-research",
  security: "cat-security",
  industry: "cat-industry",
  policy: "cat-policy",
};

/** "cat-security" for "security"; the stylesheet maps it to the category's colour and tint. */
export function categoryClass(category: Category): string {
  return CATEGORY_CLASS[category];
}
