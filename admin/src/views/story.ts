import { html } from "hono/html";
import { COPY } from "../copy";
import { CATEGORIES, PUBLISH_LIMITS, isHttpUrl, type Lang } from "../schema";
import { NOTE_MAX, restorable, type Position, type StoryFull, type Tab } from "../stories";
import { categoryLabel, externalLink, formatDate, listHref, storyHref, storyPath, timeLeft, type View } from "./layout";
import { reasonList } from "./reasons";

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
const BLANK: TextSet = { title: "", summary: "", dev_line: "" };
const FORM_ID = "story-form";

const textsOf = (s: StoryFull, lang: Lang): TextSet => s.texts[lang] ?? BLANK;

export function draftFrom(s: StoryFull): Draft {
  return {
    category: s.category,
    try_url: s.fact_card.try_url ?? "",
    texts: { tr: { ...textsOf(s, "tr") }, en: { ...textsOf(s, "en") } },
  };
}

const list = (items: string[]): string => (items.length > 0 ? items.join(", ") : COPY.none);

// The same chip classes as the queue cards.
const chip = (text: string, tone?: "accent" | "warn" | "ok" | "status"): View =>
  html`<span class="${tone ? `chip ${tone}` : "chip"}">${text}</span>`;

function statusChips(s: StoryFull, now: Date): View {
  const chips: View[] = [chip(COPY.statusLine[s.status], s.status === "published" ? "ok" : "status")];
  if (s.status === "review") {
    const left = timeLeft(s.expires_at, now);
    chips.push(chip(left.text, left.warn ? "warn" : undefined));
  } else if (s.status === "published") {
    if (s.publish_mode) chips.push(chip(COPY.publishMode[s.publish_mode]));
    if (s.published_at) chips.push(chip(COPY.publishedAt(formatDate(s.published_at))));
  } else if (s.decided_at) {
    chips.push(chip(COPY.decidedAt(formatDate(s.decided_at))));
  }
  chips.push(chip(categoryLabel(s.category)), chip(COPY.sourceCount(s.source_count)));
  if (s.edited) chips.push(chip(COPY.edited, "accent"));
  return html`<p class="chips">${chips}</p>`;
}

function reasons(s: StoryFull): View {
  if (s.reasons.length === 0) return html``;
  return html`<section class="panel reasons-panel" aria-labelledby="reasons-h">
<h2 id="reasons-h">${COPY.reasonsHeading}</h2>
${reasonList(s.reasons)}
</section>`;
}

// How the story will look on the reader site, from the form's values: an approximation of the
// site's story block (length and wrapping, not a pixel copy). app.js keeps each part in step with
// its field (ids `pv_` + the field's id). The tag shows the Turkish category label in both.
function preview(d: Draft): View {
  const block = (lang: Lang) => {
    const t = d.texts[lang];
    const en = lang === "en";
    return html`<div class="pv-story"${en ? html` lang="en"` : ""}>
<p class="pv-lang"${en ? html` lang="tr"` : ""}>${COPY.langs[lang]}</p>
<p class="pv-meta"><span class="pv-tag" id="pv_${lang}_category"${en ? html` lang="tr"` : ""}>${categoryLabel(d.category)}</span></p>
<p class="pv-title" id="pv_${lang}_title">${t.title}</p>
<p class="pv-summary" id="pv_${lang}_summary">${t.summary}</p>
<p class="pv-why"><span class="pv-why-label">${COPY.previewDev[lang]}</span> <span id="pv_${lang}_dev_line">${t.dev_line}</span></p>
</div>`;
  };
  return html`<section class="panel preview" aria-labelledby="preview-h">
<h2 id="preview-h">${COPY.previewHeading}</h2>
${LANGS.map(block)}
</section>`;
}

function factCard(s: StoryFull): View {
  const f = s.fact_card;
  return html`<section class="panel" aria-labelledby="fact-h">
<h2 id="fact-h">${COPY.factCardHeading}</h2>
<dl class="facts">
<dt>${COPY.fact.what}</dt><dd lang="en">${f.what || COPY.none}</dd>
<dt>${COPY.fact.who}</dt><dd lang="en">${list(f.who)}</dd>
<dt>${COPY.fact.numbers}</dt><dd lang="en">${list(f.numbers)}</dd>
<dt>${COPY.fact.versions}</dt><dd lang="en">${list(f.versions)}</dd>
<dt>${COPY.fact.tryUrl}</dt><dd>${f.try_url ? externalLink(f.try_url) : COPY.none}</dd>
</dl>
</section>`;
}

function sources(s: StoryFull): View {
  const items = s.sources.map(
    (src) => html`<li>${externalLink(src.url, src.name || src.url)} <span class="muted">${COPY.tier(src.tier)}</span></li>`,
  );
  return html`<section class="panel" aria-labelledby="sources-h">
<h2 id="sources-h">${COPY.sourcesHeading}</h2>
<p class="main-source"><span class="muted">${COPY.mainSource}:</span> ${externalLink(s.source_url)}</p>
<ul class="sources">${items}</ul>
</section>`;
}

// "14 / 90" under a field, counted as the server counts (trimmed), in the danger colour over the
// limit. app.js keeps it live; it never disables a button: the server is the judge.
export function counter(id: string, value: string, limit: number): View {
  const n = value.trim().length;
  return html`<p class="${n > limit ? "counter over" : "counter"}" id="${id}_count">${n} / ${limit}</p>`;
}

function textField(lang: Lang, field: TextField, value: string): View {
  const id = `${lang}_${field}`;
  const limit = PUBLISH_LIMITS[field];
  return html`<div class="field">
<label for="${id}">${COPY.fields[field]}</label>
<textarea id="${id}" name="${id}" rows="${ROWS[field]}" lang="${lang}" data-limit="${limit}" aria-describedby="${id}_count">${value}</textarea>
${counter(id, value, limit)}
</div>`;
}

// The try link's limit, as the ingest contract and the edit check have it.
const URL_MAX = 2000;

const versionField = (s: StoryFull) => html`<input type="hidden" name="version" value="${s.version}">`;

// Shown by app.js while the form differs from what the page loaded with.
const unsavedNotice = html`<p class="unsaved" id="unsaved" role="status" hidden>${COPY.unsaved}</p>`;

// The main source, one click from the checkbox; only for an http(s) URL.
const sourceLink = (s: StoryFull): View | string =>
  isHttpUrl(s.source_url)
    ? html`<a class="source-link" href="${s.source_url}" target="_blank" rel="noopener noreferrer">${COPY.openSource}</a>`
    : "";

// The buttons point at the one form; each picks its route with formaction.
function actionBar(s: StoryFull): View {
  const save = (cls: string) =>
    html`<button type="submit" class="${cls}" id="save-button" form="${FORM_ID}" formaction="${storyPath(s.uid)}/edit">${COPY.save}</button>`;
  if (s.status !== "review")
    return html`<div class="action-bar">
${unsavedNotice}
<div class="bar-buttons">${save("primary")}</div>
</div>`;
  return html`<div class="action-bar">
<div class="bar-check">
<div class="check"><input type="checkbox" id="checked" name="checked" value="on"><label for="checked">${COPY.checked}</label></div>
${sourceLink(s)}
</div>
${unsavedNotice}
<div class="bar-buttons decide">
${save("secondary")}
<a class="bar-reject" href="#reject-card">${COPY.barReject}</a>
<button type="submit" class="primary" id="approve-button" form="${FORM_ID}" formaction="${storyPath(s.uid)}/approve" aria-describedby="approve-note">${COPY.approve}</button>
</div>
</div>`;
}

function editForm(s: StoryFull, d: Draft, dirty: boolean): View {
  const options = CATEGORIES.map(
    (c) => html`<option value="${c}"${c === d.category ? html` selected` : ""}>${categoryLabel(c)}</option>`,
  );
  const groups = LANGS.map(
    (lang) => html`<fieldset class="panel lang-group">
<legend>${COPY.langs[lang]}</legend>
${FIELDS.map((f) => textField(lang, f, d.texts[lang][f]))}
</fieldset>`,
  );
  return html`<section class="edit" aria-labelledby="edit-h">
<h2 id="edit-h">${COPY.editHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/edit" id="${FORM_ID}" class="stack"${dirty ? html` data-dirty="1"` : ""}>
${versionField(s)}
<div class="panel stack">
<div class="field">
<label for="category">${COPY.category}</label>
<select id="category" name="category">${options}</select>
</div>
<div class="field">
<label for="try_url">${COPY.fact.tryUrl}</label>
<input id="try_url" name="try_url" type="url" inputmode="url" value="${d.try_url}" data-limit="${URL_MAX}" aria-describedby="try_url_hint try_url_count">
<p class="hint" id="try_url_hint">${COPY.tryUrlHint}</p>
${counter("try_url", d.try_url, URL_MAX)}
</div>
</div>
<p class="hint">${COPY.limitHint}</p>
${groups}
${s.status === "review" ? html`<p class="hint" id="approve-note">${COPY.approveNote}</p>` : ""}
${actionBar(s)}
</form>
</section>`;
}

function noteField(id: string, label: string, required: boolean): View {
  return html`<div class="field">
<label for="${id}">${label}</label>
<textarea id="${id}" name="note" rows="2" maxlength="${NOTE_MAX}"${required ? html` required` : ""} data-limit="${NOTE_MAX}" aria-describedby="${id}_count"></textarea>
${counter(id, "", NOTE_MAX)}
</div>`;
}

function rejectCard(s: StoryFull): View {
  return html`<section class="danger-card" id="reject-card" aria-labelledby="decide-h">
<h2 id="decide-h">${COPY.decisionHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/reject" class="stack">
${versionField(s)}
${noteField("reject_note", COPY.rejectNote, false)}
<div class="actions"><button type="submit" class="danger">${COPY.reject}</button></div>
</form>
</section>`;
}

function takeDownCard(s: StoryFull, tab: Tab): View {
  return html`<section class="danger-card" aria-labelledby="decide-h">
<h2 id="decide-h">${COPY.decisionHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/unpublish" class="stack">
${versionField(s)}
${tab === "edition" ? html`<input type="hidden" name="from" value="edition">` : ""}
${noteField("unpublish_note", COPY.unpublishNote, true)}
<div class="actions"><button type="submit" class="danger">${COPY.unpublish}</button></div>
</form>
</section>`;
}

// A rejected story can go back to the queue while its 72 hours last; after that the page says why not.
function restoreCard(s: StoryFull, now: Date): View {
  if (!restorable(s, now))
    return html`<section class="panel restore-card" aria-labelledby="restore-h">
<h2 id="restore-h">${COPY.restoreHeading}</h2>
<p>${COPY.restoreExpired}</p>
</section>`;
  return html`<section class="panel restore-card" aria-labelledby="restore-h">
<h2 id="restore-h">${COPY.restoreHeading}</h2>
<form method="post" action="${storyPath(s.uid)}/restore" class="stack">
${versionField(s)}
<p class="hint">${COPY.restoreNote}</p>
<div class="actions"><button type="submit" id="restore-button">${COPY.restore}</button></div>
</form>
</section>`;
}

function readOnlyTexts(s: StoryFull): View {
  const groups = LANGS.map((lang) => {
    const t = textsOf(s, lang);
    return html`<div class="panel lang-group">
<h3>${COPY.langs[lang]}</h3>
<dl class="texts" lang="${lang}">
<dt lang="tr">${COPY.fields.title}</dt><dd>${t.title}</dd>
<dt lang="tr">${COPY.fields.summary}</dt><dd>${t.summary}</dd>
<dt lang="tr">${COPY.fields.dev_line}</dt><dd>${t.dev_line}</dd>
</dl>
</div>`;
  });
  return html`<section class="stack" aria-labelledby="texts-h">
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
  return html`<section class="panel history-panel" aria-labelledby="history-h">
<h2 id="history-h">${COPY.historyHeading}</h2>
<ol class="history">${items}</ol>
</section>`;
}

// One column below 64rem (head, reasons, fact card, sources, form, preview, decision card, history,
// by CSS order); from 64rem the side column (reasons to history) sits sticky on the right of the form.
// `dirty`: the draft holds typed text that is not saved (app.js then starts in the unsaved state).
// The way back to the list, and the story's place in it with the stories either side.
function storyTop(s: StoryFull, tab: Tab, position: Position | null): View {
  const back =
    tab === "edition"
      ? html`<a href="${listHref("edition")}">${COPY.backToEdition}</a>`
      : html`<a href="${listHref(s.status)}">${COPY.back}</a>`;
  const nav = position
    ? html`<nav class="story-nav" aria-label="${COPY.storyNav}">
${position.prev ? html`<a class="nav-link" id="story-prev" rel="prev" href="${storyHref(position.prev, tab)}">${COPY.prevStory}</a>` : ""}
<span class="nav-pos"><span class="visually-hidden">${COPY.position}: </span>${position.index} / ${position.total}</span>
${position.next ? html`<a class="nav-link" id="story-next" rel="next" href="${storyHref(position.next, tab)}">${COPY.nextStory}</a>` : ""}
</nav>`
    : "";
  return html`<div class="story-top"><p class="back">${back}</p>${nav}</div>`;
}

export interface StoryNav {
  tab: Tab;
  position: Position | null;
}

export function storyView(
  s: StoryFull,
  now: Date,
  draft: Draft = draftFrom(s),
  dirty = false,
  nav: StoryNav = { tab: s.status, position: null },
): View {
  const editable = s.status === "review" || s.status === "published";
  const decision =
    s.status === "review"
      ? rejectCard(s)
      : s.status === "published"
        ? takeDownCard(s, nav.tab)
        : s.status === "rejected"
          ? restoreCard(s, now)
          : "";
  return html`${storyTop(s, nav.tab, nav.position)}
<article class="story">
<div class="story-head">
<h1 class="story-title">${textsOf(s, "tr").title}</h1>
${statusChips(s, now)}
</div>
<div class="story-side">
${reasons(s)}
${editable ? preview(draft) : ""}
${factCard(s)}
${sources(s)}
${history(s)}
</div>
<div class="story-main">
${editable ? editForm(s, draft, dirty) : readOnlyTexts(s)}
${decision}
</div>
</article>`;
}

export function notFoundView(): View {
  return html`<h1 class="story-title">${COPY.notFound}</h1>
<p class="back"><a href="/admin">${COPY.back}</a></p>`;
}
