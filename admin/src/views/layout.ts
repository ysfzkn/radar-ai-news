import { html } from "hono/html";
import { COPY } from "../copy";
import { isHttpUrl, type Status } from "../schema";

export type View = ReturnType<typeof html>;

export const STATUSES: readonly Status[] = ["review", "published", "rejected", "expired"];
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

// "14 sa": hours rounded down; under one hour, minutes. Never negative.
export function durationLeft(expiresAt: string, now: Date): string {
  const left = msLeft(expiresAt, now);
  const hours = Math.floor(left / 3_600_000);
  return hours >= 1 ? COPY.hours(hours) : COPY.minutes(Math.floor(left / 60_000));
}

// "Kalan süre: 14 sa", and whether less than six hours are left.
export function timeLeft(expiresAt: string, now: Date): { text: string; warn: boolean } {
  return { text: COPY.timeLeft(durationLeft(expiresAt, now)), warn: msLeft(expiresAt, now) < WARN_MS };
}

// The host name of an http(s) URL; null for anything else.
export function hostOf(url: string): string | null {
  return isHttpUrl(url) ? new URL(url).hostname : null;
}

export const categoryLabel = (value: string): string => COPY.categories[value] ?? value;

// An outbound link when the URL is http(s); otherwise the text alone.
export function externalLink(url: string, label: string = url): View {
  return isHttpUrl(url)
    ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : html`<span class="plain-url">${label === url ? url : `${label} (${url})`}</span>`;
}

export const storyPath = (uid: string): string => `/admin/stories/${encodeURIComponent(uid)}`;

// The product's radar mark: a dot at the lower left and five quarter arcs around it, the three
// inner ones lit. Built from constants only; its colours come from the stylesheet.
const ARC_RADII = [5, 8.5, 12, 15.5, 19] as const;
const LIT_ARCS = 3;

function radarMark(): View {
  const arcs = ARC_RADII.map(
    (r, i) => html`<path class="${i < LIT_ARCS ? "mark-lit" : "mark-dim"}" d="M4 ${20 - r}A${r} ${r} 0 0 1 ${4 + r} 20"/>`,
  );
  return html`<svg class="mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle class="mark-dot" cx="4" cy="20" r="2"/>${arcs}</svg>`;
}

export interface Shell {
  title: string;
  email: string;
  counts: Record<Status, number>;
  active: Status | null;
  message?: string | undefined;
  body: View;
}

export function layout(p: Shell): View {
  const tabs = STATUSES.map(
    (s) =>
      html`<li><a href="/admin?status=${s}"${p.active === s ? html` aria-current="page"` : ""}>${COPY.tabs[s]} <span class="tab-count">${p.counts[s]}</span></a></li>`,
  );
  return html`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${p.title} · ${COPY.appName}</title>
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/app.js" defer></script>
</head>
<body>
<header class="top">
<div class="top-inner">
<a class="brand" href="/admin">${radarMark()}<span class="wordmark">${COPY.brand}</span> <span class="brand-suffix">${COPY.brandSuffix}</span></a>
<span class="who">${p.email}</span>
</div>
</header>
<nav class="wrap" aria-label="${COPY.queueHeading}"><ul class="tabs">${tabs}</ul></nav>
<main class="wrap">
${p.message ? html`<p class="notice" role="alert">${p.message}</p>` : ""}
${p.body}
</main>
</body>
</html>`;
}
