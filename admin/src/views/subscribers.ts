import { html } from "hono/html";
import { COPY } from "../copy";
import type { LastMailing, SubscriberRow, SubscriberTotals } from "../subscribers";
import { formatDate, type View } from "./layout";

export interface SubscribersPage {
  totals: SubscriberTotals;
  last: LastMailing | null;
  rows: SubscriberRow[];
  page: { current: number; hasMore: boolean };
  // Whether the Worker can send at all (key, sender and its own address set).
  sending: boolean;
}

export const subscribersHref = (page?: number): string =>
  page !== undefined && page > 1 ? `/admin/subscribers?page=${page}` : "/admin/subscribers";

// "2026-11-23" -> "23 Kas": the day of an edition, already an Istanbul day.
function formatEditionDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const month = COPY.months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : day;
}

function row(s: SubscriberRow): View {
  const c = COPY.subscribers;
  const confirmed = s.status === "confirmed";
  const meta = [
    c.langs[s.lang],
    c.joined(formatDate(s.created_at)),
    ...(confirmed && s.confirmed_at ? [c.confirmedAt(formatDate(s.confirmed_at))] : []),
    ...(confirmed ? [s.mailed_day ? c.lastMailed(formatEditionDay(s.mailed_day)) : c.neverMailed] : []),
  ];
  // The confirmation is a plain disclosure: the button that deletes is one step away, without script.
  return html`<li class="sub-row">
<div class="sub-main"><p class="sub-email">${s.email}</p><p class="meta">${meta.join(" · ")}</p></div>
<span class="${confirmed ? "chip ok" : "chip warn"}">${c.statuses[s.status]}</span>
<details class="takedown sub-remove"><summary>${c.remove}</summary>
<form method="post" action="/admin/subscribers/${s.id}/delete" class="stack">
<p class="hint">${c.removeHint}</p>
<div class="actions"><button type="submit" class="danger">${c.removeConfirm}</button></div>
</form>
</details>
</li>`;
}

export function subscribersView(p: SubscribersPage): View {
  const c = COPY.subscribers;
  const stat = (label: string, value: string) => html`<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`;
  const total = p.totals.confirmed + p.totals.pending;
  const pager = html`<div class="pager">
${p.page.current > 1 ? html`<a class="pager-link" rel="prev" href="${subscribersHref(p.page.current - 1)}">${COPY.prevPage}</a>` : ""}
${p.page.hasMore ? html`<a class="pager-link next" rel="next" href="${subscribersHref(p.page.current + 1)}">${COPY.nextPage}</a>` : ""}
</div>`;
  return html`<h1 class="page-title">${c.title}</h1>
<p class="hint page-intro">${c.intro}</p>
${p.sending ? "" : html`<p class="notice warn" role="status">${c.notSending}</p>`}
<section class="strip-wrap" aria-label="${c.stripLabel}"><dl class="strip sub-strip">
${stat(c.confirmed, String(p.totals.confirmed))}
${stat(c.pending, String(p.totals.pending))}
${stat(c.byLang, c.langSplit(p.totals.tr, p.totals.en))}
${stat(c.lastSend, p.last ? c.lastSendValue(formatEditionDay(p.last.day), p.last.readers) : c.noSendYet)}
</dl></section>
<section class="panel" aria-labelledby="subs-h">
<h2 id="subs-h">${c.listHeading}</h2>
${
  p.rows.length === 0
    ? html`<p class="empty-line">${total === 0 ? c.empty : c.emptyPage}</p>`
    : html`<ol class="subs">${p.rows.map(row)}</ol>`
}
</section>
${pager}`;
}
