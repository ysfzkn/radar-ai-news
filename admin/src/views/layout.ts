import { html } from "hono/html";
import { COPY } from "../copy";
import { isHttpUrl, type Status } from "../schema";
import { NO_FILTER, type QueueFilter, type Tab } from "../stories";

export type View = ReturnType<typeof html>;

export const STATUSES: readonly Status[] = ["review", "published", "rejected", "expired"];
export const TABS: readonly Tab[] = [...STATUSES, "edition"];
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year
const WARN_MS = 6 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

// "20 Kas 14:05", Istanbul time.
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + ISTANBUL_OFFSET_MS);
  return `${d.getUTCDate()} ${COPY.months[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const msLeft = (expiresAt: string, now: Date): number => Math.max(0, Date.parse(expiresAt) - now.getTime());

// "20 Kas", Istanbul time.
export function formatDay(now: Date): string {
  const d = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  return `${d.getUTCDate()} ${COPY.months[d.getUTCMonth()]}`;
}

// "14:05", Istanbul time.
export function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + ISTANBUL_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// "14 sa": hours rounded down; under one hour, minutes. Never negative.
export function duration(ms: number): string {
  const left = Math.max(0, ms);
  const hours = Math.floor(left / 3_600_000);
  return hours >= 1 ? COPY.hours(hours) : COPY.minutes(Math.floor(left / 60_000));
}

export const durationLeft = (expiresAt: string, now: Date): string => duration(msLeft(expiresAt, now));

// "Kalan süre: 14 sa", and whether less than six hours are left.
export function timeLeft(expiresAt: string, now: Date): { text: string; warn: boolean } {
  return { text: COPY.timeLeft(durationLeft(expiresAt, now)), warn: msLeft(expiresAt, now) < WARN_MS };
}

// The host name of an http(s) URL; null for anything else.
export function hostOf(url: string): string | null {
  return isHttpUrl(url) ? new URL(url).hostname : null;
}

// Own keys only: a hand-crafted value such as "constructor" is shown as itself.
export const categoryLabel = (value: string): string =>
  Object.hasOwn(COPY.categories, value) ? COPY.categories[value]! : value;

// An outbound link when the URL is http(s); otherwise the text alone.
export function externalLink(url: string, label: string = url): View {
  return isHttpUrl(url)
    ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : html`<span class="plain-url">${label === url ? url : `${label} (${url})`}</span>`;
}

export const storyPath = (uid: string): string => `/admin/stories/${encodeURIComponent(uid)}`;

// A story's address as reached from a tab; only the edition tab is carried (`?from=edition`),
// since every other tab is the story's own status.
export const storyHref = (uid: string, tab: Tab | null = null): string =>
  tab === "edition" ? `${storyPath(uid)}?from=edition` : storyPath(uid);

// A list's address with the queue's search kept; the parameters are encoded, never raw.
export function listHref(tab: Tab, filter: QueueFilter = NO_FILTER, page?: number): string {
  const params = new URLSearchParams();
  if (tab !== "edition") params.set("status", tab);
  if (filter.q) params.set("q", filter.q);
  if (filter.cat) params.set("cat", filter.cat);
  if (page !== undefined) params.set("page", String(page));
  const query = params.toString();
  const base = tab === "edition" ? "/admin/edition" : "/admin";
  return query ? `${base}?${query}` : base;
}

// The product's mark, the echo arcs: three equal arcs of radius 13 from (x, 4) to (x, 20), bulging
// right. Built from constants only; its colour comes from the stylesheet.
const ECHO_XS = [5, 11, 17] as const;
export const RADAR_MARK = html`<svg class="mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ECHO_XS.map(
  (x) => html`<path class="mark-arc" d="M${x} 4A13 13 0 0 1 ${x} 20"/>`,
)}</svg>`;

// The live site, linked from the header.
export const SITE_URL = "https://radar.ozkanyusuf.com";

// A page of the admin: one of the list tabs, or a page of the header: the run page ("Çalıştır")
// or the newsletter's readers ("Aboneler").
export type Page = Tab | "run" | "subscribers";

export interface Shell {
  title: string;
  email: string;
  // The edition tab's number is today's published count; without it the tab shows none.
  counts: Record<Status, number> & { edition?: number };
  active: Page | null;
  message?: string | undefined;
  // A confirmation of what just happened; an error message wins over it.
  done?: string | undefined;
  // The queue's search, kept on the tab links.
  filter?: QueueFilter;
  body: View;
}

// The status notice: an error (alert) or, failing that, a confirmation (status).
function notice(p: Shell): View | string {
  if (p.message) return html`<p class="notice" role="alert">${p.message}</p>`;
  if (p.done) return html`<p class="notice done" role="status">${p.done}</p>`;
  return "";
}

// The shortcut sheet, opened by "?" or the footer button; app.js shows the button and drives it.
function shortcutSheet(): View {
  const rows = COPY.shortcuts.map(([keys, what]) => html`<dt>${keys.map((k, i) => html`${i > 0 ? " / " : ""}<kbd>${k}</kbd>`)}</dt><dd>${what}</dd>`);
  return html`<dialog class="sheet" id="shortcuts" aria-labelledby="shortcuts-h">
<h2 id="shortcuts-h">${COPY.shortcutsHeading}</h2>
<dl class="keys">${rows}</dl>
<p class="hint">${COPY.shortcutsNote}</p>
<div class="actions"><button type="button" id="shortcuts-close">${COPY.close}</button></div>
</dialog>`;
}

export function layout(p: Shell): View {
  const filter = p.filter ?? NO_FILTER;
  const tabs: View[] = TABS.map((t) => {
    const count = t === "edition" ? p.counts.edition : p.counts[t];
    return html`<li><a href="${listHref(t, filter)}"${p.active === t ? html` aria-current="page"` : ""}>${COPY.tabs[t]}${count === undefined ? "" : html` <span class="tab-count">${count}</span>`}</a></li>`;
  });
  return html`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${p.counts.review > 0 ? `(${p.counts.review}) ` : ""}${p.title} · ${COPY.appName}</title>
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/app.js" defer></script>
</head>
<body>
<header class="top">
<div class="top-inner">
<a class="brand" href="/admin">${RADAR_MARK}<span class="wordmark">${COPY.brand}</span> <span class="brand-suffix">${COPY.brandSuffix}</span></a>
<nav class="top-links" aria-label="${COPY.mainNav}">
<a class="top-link run-link" href="/admin/run"${p.active === "run" ? html` aria-current="page"` : ""}>${COPY.run.tab}</a>
<a class="top-link subs-link" href="/admin/subscribers"${p.active === "subscribers" ? html` aria-current="page"` : ""}>${COPY.subscribers.tab}</a>
<a class="top-link site-link" href="${SITE_URL}" target="_blank" rel="noopener noreferrer" aria-label="${COPY.siteLinkLabel}">${COPY.siteLink} ↗</a>
</nav>
<p class="who"><span class="visually-hidden">${COPY.signedInAs} </span>${p.email}</p>
</div>
</header>
<nav class="wrap tabs-wrap" aria-label="${COPY.queueHeading}"><ul class="tabs">${tabs}</ul></nav>
<main class="wrap">
${notice(p)}
${p.body}
</main>
<footer class="wrap foot"><button type="button" class="kbd-hint" id="shortcuts-open" aria-haspopup="dialog" hidden>${COPY.kbdHint} <kbd>?</kbd></button></footer>
${shortcutSheet()}
</body>
</html>`;
}
