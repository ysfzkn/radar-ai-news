import { html } from "hono/html";
import { COPY } from "../copy";
import type { Status } from "../schema";
import type { StorySummary } from "../stories";
import { categoryLabel, formatDate, storyPath, timeLeft, type View } from "./layout";

function card(s: StorySummary, now: Date): View {
  let foot: View;
  if (s.status === "review") {
    const left = timeLeft(s.expires_at, now);
    foot = html`<p class="${left.warn ? "time warn" : "time"}">${left.text}</p>`;
  } else if (s.status === "published") {
    foot = html`<p class="time">${s.publish_mode ? COPY.publishMode[s.publish_mode] : ""}</p>`;
  } else {
    foot = html`<p class="time">${COPY.receivedAt(formatDate(s.created_at))}</p>`;
  }
  return html`<li class="card">
<p class="meta">${categoryLabel(s.category)} · ${COPY.sourceCount(s.source_count)}${s.edited ? html` · <span class="edited">${COPY.edited}</span>` : ""}</p>
<h2 class="card-title"><a href="${storyPath(s.uid)}">${s.title_tr}</a></h2>
${s.reasons.length > 0 ? html`<ul class="reasons">${s.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ""}
${foot}
</li>`;
}

export function queueView(status: Status, stories: StorySummary[], now: Date): View {
  const empty = status === "review" ? COPY.emptyReview : COPY.emptyOther;
  return html`<h1 class="visually-hidden">${COPY.tabs[status]}</h1>
${stories.length === 0 ? html`<p class="empty">${empty}</p>` : html`<ul class="cards">${stories.map((s) => card(s, now))}</ul>`}`;
}
