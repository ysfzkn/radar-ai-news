import { html } from "hono/html";
import { COPY } from "../copy";
import { CATEGORIES, PUBLISH_LIMITS, type Lang } from "../schema";
import type { StoryFull } from "../stories";
import { categoryLabel, externalLink, formatDate, storyPath, timeLeft, type View } from "./layout";

type TextSet = StoryFull["texts"][Lang];
type TextField = keyof TextSet;

// What the edit form shows: the stored story, or what the user typed when a save failed.
export interface Draft {
  category: string;
  try_url: string;
  texts: Record<Lang, TextSet>;
}

const LANGS: readonly Lang[] = ["tr", "en"];
const FIELDS: readonly TextField[] = ["title", "summary", "dev_line"];
const ROWS: Record<TextField, number> = { title: 2, summary: 5, dev_line: 3 };
const NOTE_MAX = 500;
const BLANK: TextSet = { title: "", summary: "", dev_line: "" };

const textsOf = (s: StoryFull, lang: Lang): TextSet => s.texts[lang] ?? BLANK;

export function draftFrom(s: StoryFull): Draft {
  return {
    category: s.category,
    try_url: s.fact_card.try_url ?? "",
    texts: { tr: { ...textsOf(s, "tr") }, en: { ...textsOf(s, "en") } },
  };
}

const list = (items: string[]): string => (items.length > 0 ? items.join(", ") : COPY.none);

function statusLine(s: StoryFull, now: Date): View {
  const parts: View[] = [html`<span class="status">${COPY.statusLine[s.status]}</span>`];
  if (s.status === "review") {
    const left = timeLeft(s.expires_at, now);
    parts.push(html`<span class="${left.warn ? "warn" : ""}">${left.text}</span>`);
  } else if (s.status === "published") {
    if (s.publish_mode) parts.push(html`<span>${COPY.publishMode[s.publish_mode]}</span>`);
    if (s.published_at) parts.push(html`<span>${COPY.publishedAt(formatDate(s.published_at))}</span>`);
  } else if (s.decided_at) {
    parts.push(html`<span>${COPY.decidedAt(formatDate(s.decided_at))}</span>`);
  }
  parts.push(html`<span>${categoryLabel(s.category)}</span>`, html`<span>${COPY.sourceCount(s.source_count)}</span>`);
  if (s.edited) parts.push(html`<span>${COPY.edited}</span>`);
  return html`<p class="status-line">${parts.map((p, i) => (i === 0 ? p : html` · ${p}`))}</p>`;
}

function factCard(s: StoryFull): View {
  const f = s.fact_card;
  return html`<section aria-labelledby="fact-h">
<h2 id="fact-h">${COPY.factCardHeading}</h2>
<dl class="facts">
<dt>${COPY.fact.what}</dt><dd>${f.what || COPY.none}</dd>
<dt>${COPY.fact.who}</dt><dd>${list(f.who)}</dd>
<dt>${COPY.fact.numbers}</dt><dd>${list(f.numbers)}</dd>
<dt>${COPY.fact.versions}</dt><dd>${list(f.versions)}</dd>
<dt>${COPY.fact.tryUrl}</dt><dd>${f.try_url ? externalLink(f.try_url) : COPY.none}</dd>
</dl>
</section>`;
}

function sources(s: StoryFull): View {
  const items = s.sources.map(
    (src) => html`<li>${externalLink(src.url, src.name || src.url)} <span class="muted">${COPY.tier(src.tier)}</span></li>`,
  );
  return html`<section aria-labelledby="sources-h">
<h2 id="sources-h">${COPY.sourcesHeading}</h2>
<p class="main-source"><span class="muted">${COPY.mainSource}:</span> ${externalLink(s.source_url)}</p>
<ul class="sources">${items}</ul>
</section>`;
}

function textField(lang: Lang, field: TextField, value: string): View {
  const id = `${lang}_${field}`;
  const limit = PUBLISH_LIMITS[field];
  const over = value.length > limit;
  return html`<div class="field">
<label for="${id}">${COPY.fields[field]}</label>
<textarea id="${id}" name="${id}" rows="${ROWS[field]}" lang="${lang}" data-limit="${limit}" aria-describedby="${id}_count">${value}</textarea>
<p class="${over ? "counter warn" : "counter"}" id="${id}_count">${value.length} / ${limit}</p>
</div>`;
}

const versionField = (s: StoryFull) => html`<input type="hidden" name="version" value="${s.version}">`;

function editForm(s: StoryFull, d: Draft): View {
  const options = CATEGORIES.map(
    (c) => html`<option value="${c}"${c === d.category ? html` selected` : ""}>${categoryLabel(c)}</option>`,
  );
  const groups = LANGS.map(
    (lang) => html`<fieldset class="lang-group">
<legend>${COPY.langs[lang]}</legend>
${FIELDS.map((f) => textField(lang, f, d.texts[lang][f]))}
</fieldset>`,
  );
  return html`<section aria-labelledby="edit-h">
<h2 id="edit-h">${COPY.editHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/edit" class="stack">
${versionField(s)}
<div class="field">
<label for="category">${COPY.category}</label>
<select id="category" name="category">${options}</select>
</div>
<div class="field">
<label for="try_url">${COPY.fact.tryUrl}</label>
<input id="try_url" name="try_url" type="url" inputmode="url" value="${d.try_url}" aria-describedby="try_url_hint">
<p class="hint" id="try_url_hint">${COPY.tryUrlHint}</p>
</div>
<p class="hint">${COPY.limitHint}</p>
${groups}
<div class="actions"><button type="submit" class="secondary">${COPY.save}</button></div>
</form>
</section>`;
}

function reviewDecision(s: StoryFull): View {
  return html`<section aria-labelledby="decide-h" class="decide">
<h2 id="decide-h">${COPY.decisionHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/approve" class="stack">
${versionField(s)}
<p class="hint">${COPY.approveHint}</p>
<div class="check"><input type="checkbox" id="checked" name="checked" value="on" required><label for="checked">${COPY.checked}</label></div>
<div class="actions"><button type="submit" class="primary">${COPY.approve}</button></div>
</form>
<form method="post" action="${storyPath(s.uid)}/reject" class="stack destructive">
${versionField(s)}
<div class="field">
<label for="reject_note">${COPY.rejectNote}</label>
<textarea id="reject_note" name="note" rows="2" maxlength="${NOTE_MAX}"></textarea>
</div>
<div class="actions"><button type="submit" class="danger">${COPY.reject}</button></div>
</form>
</section>`;
}

function publishedDecision(s: StoryFull): View {
  return html`<section aria-labelledby="decide-h" class="decide">
<h2 id="decide-h">${COPY.decisionHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/unpublish" class="stack destructive">
${versionField(s)}
<div class="field">
<label for="unpublish_note">${COPY.unpublishNote}</label>
<textarea id="unpublish_note" name="note" rows="2" maxlength="${NOTE_MAX}" required></textarea>
</div>
<div class="actions"><button type="submit" class="danger">${COPY.unpublish}</button></div>
</form>
</section>`;
}

function readOnlyTexts(s: StoryFull): View {
  const groups = LANGS.map((lang) => {
    const t = textsOf(s, lang);
    return html`<div class="lang-group">
<h3>${COPY.langs[lang]}</h3>
<dl class="texts" lang="${lang}">
<dt lang="tr">${COPY.fields.title}</dt><dd>${t.title}</dd>
<dt lang="tr">${COPY.fields.summary}</dt><dd>${t.summary}</dd>
<dt lang="tr">${COPY.fields.dev_line}</dt><dd>${t.dev_line}</dd>
</dl>
</div>`;
  });
  return html`<section aria-labelledby="texts-h">
<h2 id="texts-h">${COPY.textsHeading}</h2>
<p class="hint">${COPY.readOnly}</p>
${groups}
</section>`;
}

function history(s: StoryFull): View {
  const items = s.events.map(
    (e) => html`<li>
<p><span class="muted">${formatDate(e.at)}</span> ${COPY.actions[e.action] ?? e.action} · ${COPY.actors[e.actor] ?? e.actor}</p>
${e.note ? html`<p class="note">${e.note}</p>` : ""}
</li>`,
  );
  return html`<section aria-labelledby="history-h">
<h2 id="history-h">${COPY.historyHeading}</h2>
<ol class="history">${items}</ol>
</section>`;
}

export function storyView(s: StoryFull, now: Date, draft: Draft = draftFrom(s)): View {
  const editable = s.status === "review" || s.status === "published";
  return html`<p class="back"><a href="/admin?status=${s.status}">${COPY.back}</a></p>
<article>
<h1 class="story-title">${textsOf(s, "tr").title}</h1>
${statusLine(s, now)}
${s.reasons.length > 0
  ? html`<section aria-labelledby="reasons-h">
<h2 id="reasons-h">${COPY.reasonsHeading}</h2>
<ul class="reasons">${s.reasons.map((r) => html`<li>${r}</li>`)}</ul>
</section>`
  : ""}
${factCard(s)}
${sources(s)}
${editable ? editForm(s, draft) : readOnlyTexts(s)}
${s.status === "review" ? reviewDecision(s) : s.status === "published" ? publishedDecision(s) : ""}
${history(s)}
</article>`;
}

export function notFoundView(): View {
  return html`<h1 class="story-title">${COPY.notFound}</h1>
<p class="back"><a href="/admin">${COPY.back}</a></p>`;
}
