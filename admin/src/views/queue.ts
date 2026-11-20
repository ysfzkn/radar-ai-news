import { html } from "hono/html";
import { COPY } from "../copy";
import type { Status } from "../schema";
import type { StorySummary } from "../stories";
import { categoryLabel, durationLeft, formatDate, hostOf, storyPath, timeLeft, type View } from "./layout";
import { reasonList } from "./reasons";

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

const pageHref = (status: Status, page: number): string => `/admin?status=${status}&page=${page}`;

function pager(status: Status, page: { current: number; hasMore: boolean }): View {
  if (page.current <= 1 && !page.hasMore) return html``;
  return html`<div class="pager">
${page.current > 1 ? html`<a class="pager-link" rel="prev" href="${pageHref(status, page.current - 1)}">${COPY.prevPage}</a>` : ""}
${page.hasMore ? html`<a class="pager-link next" rel="next" href="${pageHref(status, page.current + 1)}">${COPY.nextPage}</a>` : ""}
</div>`;
}

// The whole review queue: how many stories wait and when the first of them expires.
export interface QueueSummary {
  count: number;
  soonestExpiry: string;
}

export function queueView(
  status: Status,
  stories: StorySummary[],
  now: Date,
  page: { current: number; hasMore: boolean },
  summary: QueueSummary | null = null,
): View {
  const empty = status === "review" ? COPY.emptyReview : COPY.emptyOther;
  const line =
    status === "review" && summary && summary.count > 0 && stories.length > 0
      ? html`<p class="queue-summary">${COPY.queueSummary(summary.count, durationLeft(summary.soonestExpiry, now))}</p>`
      : "";
  return html`<h1 class="visually-hidden">${COPY.tabs[status]}</h1>
${line}
${stories.length === 0 ? html`<p class="empty">${empty}</p>` : html`<ul class="cards">${stories.map((s) => card(s, now))}</ul>`}
${pager(status, page)}`;
}
