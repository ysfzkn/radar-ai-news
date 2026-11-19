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

// Hours rounded down; under one hour, minutes. Never negative.
export function timeLeft(expiresAt: string, now: Date): { text: string; warn: boolean } {
  const left = Math.max(0, Date.parse(expiresAt) - now.getTime());
  const hours = Math.floor(left / 3_600_000);
  const text = hours >= 1 ? COPY.hours(hours) : COPY.minutes(Math.floor(left / 60_000));
  return { text: COPY.timeLeft(text), warn: left < WARN_MS };
}

export const categoryLabel = (value: string): string => COPY.categories[value] ?? value;

// An outbound link when the URL is http(s); otherwise the text alone.
export function externalLink(url: string, label: string = url): View {
  return isHttpUrl(url)
    ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : html`<span class="plain-url">${label === url ? url : `${label} (${url})`}</span>`;
}

export const storyPath = (uid: string): string => `/admin/stories/${encodeURIComponent(uid)}`;

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
<meta name="color-scheme" content="light dark">
<title>${p.title} · ${COPY.appName}</title>
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/app.js" defer></script>
</head>
<body>
<header class="top">
<div class="brand-row"><a class="brand" href="/admin">${COPY.appName}</a><span class="who">${p.email}</span></div>
<nav aria-label="${COPY.queueHeading}"><ul class="tabs">${tabs}</ul></nav>
</header>
<main>
${p.message ? html`<p class="notice" role="alert">${p.message}</p>` : ""}
${p.body}
</main>
</body>
</html>`;
}
