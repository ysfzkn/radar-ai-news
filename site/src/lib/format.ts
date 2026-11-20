import { COPY } from "./copy";
import type { Lang } from "./schema";

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
