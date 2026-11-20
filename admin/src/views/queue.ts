import { html } from "hono/html";
import { COPY } from "../copy";
import { CATEGORIES, type Status } from "../schema";
import { NO_FILTER, QUERY_MAX, searchTerms, type QueueFilter, type StorySummary } from "../stories";
import {
  RADAR_MARK,
  categoryLabel,
  duration,
  formatDate,
  hostOf,
  listHref,
  storyPath,
  timeLeft,
  type View,
} from "./layout";
import { reasonList } from "./reasons";

const WARN_MS = 6 * 60 * 60 * 1000;

const chip = (text: string, tone?: "accent" | "warn" | "ok"): View =>
  html`<span class="${tone ? `chip ${tone}` : "chip"}">${text}</span>`;

// The chip that says where the story stands: time left, how it was published, or when it came in.
function stateChip(s: StorySummary, now: Date): View {
  if (s.status === "review") {
    const left = timeLeft(s.expires_at, now);
    return chip(left.text, left.warn ? "warn" : undefined);
  }
  if (s.status === "published") return s.publish_mode ? chip(COPY.publishMode[s.publish_mode], "ok") : html``;
  return chip(COPY.receivedAt(formatDate(s.created_at)));
}

// "4 kaynak · example.com"; the host only for an http(s) main source.
function meta(s: StorySummary): string {
  const host = hostOf(s.source_url);
  return host ? `${COPY.sourceCount(s.source_count)} · ${host}` : COPY.sourceCount(s.source_count);
}

function card(s: StorySummary, now: Date): View {
  return html`<li class="card">
<p class="chips">${chip(categoryLabel(s.category))}${s.edited ? chip(COPY.edited, "accent") : ""}${stateChip(s, now)}</p>
<h2 class="card-title"><a href="${storyPath(s.uid)}">${s.title_tr}</a></h2>
<p class="meta">${meta(s)}</p>
${s.reasons.length > 0 ? reasonList(s.reasons) : ""}
</li>`;
}

function pager(status: Status, filter: QueueFilter, page: { current: number; hasMore: boolean }): View {
  if (page.current <= 1 && !page.hasMore) return html``;
  return html`<div class="pager">
${page.current > 1 ? html`<a class="pager-link" rel="prev" href="${listHref(status, filter, page.current - 1)}">${COPY.prevPage}</a>` : ""}
${page.hasMore ? html`<a class="pager-link next" rel="next" href="${listHref(status, filter, page.current + 1)}">${COPY.nextPage}</a>` : ""}
</div>`;
}

// The whole review queue at a glance: how many wait, how many went out today (Istanbul day), how
// long the oldest has waited and how long until it expires (the oldest is always the first to expire).
export interface QueueStrip {
  waiting: number;
  today: number;
  oldest: { created_at: string; expires_at: string } | null;
}

function strip(s: QueueStrip, now: Date): View {
  const stat = (label: string, value: string, warn = false) =>
    html`<div class="${warn ? "stat warn-stat" : "stat"}"><dt>${label}</dt><dd>${value}</dd></div>`;
  const left = s.oldest ? Date.parse(s.oldest.expires_at) - now.getTime() : null;
  return html`<section class="strip-wrap" aria-label="${COPY.stripLabel}"><dl class="strip">
${stat(COPY.stripWaiting, String(s.waiting))}
${stat(COPY.stripToday, String(s.today))}
${stat(COPY.stripOldest, s.oldest ? COPY.ago(duration(now.getTime() - Date.parse(s.oldest.created_at))) : COPY.stripNone)}
${stat(COPY.stripNextExpiry, left === null ? COPY.stripNone : COPY.within(duration(left)), left !== null && left < WARN_MS)}
</dl></section>`;
}

// The search box (a GET form that works without script) and the category chips (plain links).
function search(status: Status, f: QueueFilter, total: number | null): View {
  const chipLink = (label: string, cat: string | null) =>
    html`<li><a class="chip-link" href="${listHref(status, { q: f.q, cat })}"${f.cat === cat ? html` aria-current="true"` : ""}>${label}</a></li>`;
  const active = f.q !== "" || f.cat !== null;
  // The results line names only the words the search used.
  const terms = searchTerms(f.q);
  return html`<form class="search" method="get" action="/admin" role="search">
<input type="hidden" name="status" value="${status}">
${f.cat ? html`<input type="hidden" name="cat" value="${f.cat}">` : ""}
<label class="visually-hidden" for="q">${COPY.searchLabel}</label>
<div class="search-row">
<input type="search" id="q" name="q" value="${f.q}" maxlength="${QUERY_MAX}" placeholder="${COPY.searchPlaceholder}" enterkeyhint="search" autocomplete="off">
<button type="submit">${COPY.searchButton}</button>
</div>
</form>
<nav class="filter" aria-label="${COPY.categoryFilter}"><ul class="filter-chips">
${chipLink(COPY.allCategories, null)}
${CATEGORIES.map((c) => chipLink(categoryLabel(c), c))}
</ul></nav>
${active ? html`<p class="results">${total === null ? "" : COPY.results(total)}${f.cat ? html` · <strong>${categoryLabel(f.cat)}</strong>` : ""}${terms.used.length > 0 ? html` · <strong>“${terms.used.join(" ")}”</strong>` : ""}${terms.ignored > 0 ? html` · ${COPY.termsIgnored(terms.ignored)}` : ""} <a class="clear" href="${listHref(status)}">${COPY.clearFilter}</a></p>` : ""}`;
}

function emptyState(status: Status, filtered: boolean): View {
  if (filtered) return html`<div class="empty"><p>${COPY.emptyFiltered}</p></div>`;
  if (status !== "review") return html`<div class="empty"><p>${COPY.emptyOther}</p></div>`;
  return html`<div class="empty all-done">${RADAR_MARK}<p class="empty-title">${COPY.emptyReviewTitle}</p><p>${COPY.emptyReview}</p><p><a href="/admin/edition">${COPY.emptyToEdition}</a></p></div>`;
}

export function queueView(
  status: Status,
  stories: StorySummary[],
  now: Date,
  page: { current: number; hasMore: boolean },
  opts: { filter?: QueueFilter; total?: number | null; strip?: QueueStrip | null } = {},
): View {
  const filter = opts.filter ?? NO_FILTER;
  const filtered = filter.q !== "" || filter.cat !== null;
  return html`<h1 class="visually-hidden">${COPY.tabs[status]}</h1>
${opts.strip ? strip(opts.strip, now) : ""}
${search(status, filter, opts.total ?? null)}
${stories.length === 0 ? emptyState(status, filtered) : html`<ul class="cards">${stories.map((s) => card(s, now))}</ul>`}
${pager(status, filter, page)}`;
}
