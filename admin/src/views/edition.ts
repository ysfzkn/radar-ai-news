import { html } from "hono/html";
import { COPY } from "../copy";
import { NOTE_MAX, type EditionRow } from "../stories";
import { categoryLabel, formatTime, storyHref, storyPath, type View } from "./layout";

// Each row's take-down sits behind a disclosure, so no click removes a story by accident; the note
// is required, as on the story page, and the form says it came from here so the answer comes back here.
function row(s: EditionRow, i: number): View {
  const note = `note_${i}`;
  return html`<li class="card edition-row">
<p class="chips"><span class="chip ok">${formatTime(s.published_at)}</span><span class="chip">${categoryLabel(s.category)}</span>${s.publish_mode ? html`<span class="chip">${COPY.publishMode[s.publish_mode]}</span>` : ""}</p>
<h2 class="card-title"><a href="${storyHref(s.uid, "edition")}">${s.title_tr}</a></h2>
<details class="takedown">
<summary>${COPY.editionTakeDown}</summary>
<form method="post" action="${storyPath(s.uid)}/unpublish" class="stack">
<input type="hidden" name="version" value="${s.version}">
<input type="hidden" name="from" value="edition">
<div class="field">
<label for="${note}">${COPY.unpublishNote}</label>
<textarea id="${note}" name="note" rows="2" maxlength="${NOTE_MAX}" required data-limit="${NOTE_MAX}" aria-describedby="${note}_count"></textarea>
<p class="counter" id="${note}_count">0 / ${NOTE_MAX}</p>
</div>
<div class="actions"><button type="submit" class="danger">${COPY.unpublish}</button></div>
</form>
</details>
</li>`;
}

export function editionView(rows: EditionRow[], dayLabel: string): View {
  return html`<h1 class="page-title">${COPY.editionHeading} <span class="page-date">${dayLabel}</span></h1>
<p class="hint page-intro">${COPY.editionIntro}</p>
${rows.length === 0 ? html`<div class="empty"><p>${COPY.editionEmpty}</p></div>` : html`<ol class="cards edition">${rows.map(row)}</ol>`}`;
}
