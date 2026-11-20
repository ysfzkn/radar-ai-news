// The stylesheet and the script, served from /admin/app.css and /admin/app.js.

export const CSS = `:root {
  color-scheme: light;
  --bg: #f7f7f4;
  --surface: #ffffff;
  --ink: #17181a;
  --muted: #5a5e66;
  --line: #e4e4df;
  --control-border: #83868c;
  --chip: #efefeb;
  --accent: #c2371a;
  --accent-soft: #fbeae5;
  --warn: #8a5300;
  --warn-soft: #fdf1dc;
  --danger: #b3261e;
  --danger-soft: #fbe9e7;
  --ok: #256b4a;
  --ok-soft: #e6f2ec;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --text-sm: 0.875rem;
  --text-md: 1rem;
  --text-lg: 1.1875rem;
  --text-xl: 1.5rem;
  --leading: 1.6;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2.5rem;
  --radius: 0.5rem;
  --tap: 2.75rem;
  --measure: 45rem;
}

*, *::before, *::after { box-sizing: border-box; }

/* Keep a focused element clear of the sticky header and the sticky action bar. */
html { scroll-padding-top: 6rem; }
html:has(.action-bar) { scroll-padding-bottom: 8.5rem; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: var(--text-md) / var(--leading) var(--font);
  -webkit-text-size-adjust: 100%;
}

.wrap, .top-inner {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 0 var(--space-4);
}

main { padding-bottom: var(--space-6); }

a { color: inherit; text-underline-offset: 0.2em; text-decoration-thickness: 1px; text-decoration-color: var(--accent); }
a:hover { text-decoration-thickness: 2px; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

h1, h2, h3 { line-height: 1.3; margin: 0; }
h2 { font-size: var(--text-sm); font-weight: 600; color: var(--muted); letter-spacing: 0.02em; margin-bottom: var(--space-2); }
h3 { font-size: var(--text-md); font-weight: 600; margin-bottom: var(--space-2); }
p { margin: 0; }

.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.muted, .meta, .hint, .counter, .who { color: var(--muted); font-size: var(--text-sm); }
.warn { color: var(--warn); font-weight: 600; }

/* Header */
.top { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--line); }
.top-inner {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  column-gap: var(--space-4); padding-top: var(--space-1); padding-bottom: var(--space-1);
}
.brand {
  display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--tap);
  font-size: var(--text-lg); line-height: 1; text-decoration: none;
}
.mark { flex: none; width: 18px; height: 18px; }
.mark-arc { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linecap: round; }
.wordmark { font-weight: 700; letter-spacing: -0.01em; }
.brand-suffix { color: var(--muted); font-weight: 500; }
.who { flex-basis: 100%; padding-bottom: var(--space-2); overflow-wrap: anywhere; }

/* Tabs */
.tabs {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2);
  list-style: none; margin: var(--space-4) 0 var(--space-5); padding: 0;
}
.tabs a {
  display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--tap);
  padding: 0 var(--space-4); white-space: nowrap; text-decoration: none; font-weight: 500;
  background: var(--chip); color: var(--ink); border: 1px solid transparent; border-radius: 999px;
  transition: border-color 120ms ease;
}
.tabs a:hover { border-color: var(--control-border); }
.tabs a[aria-current="page"] { background: var(--ink); border-color: var(--ink); color: var(--surface); font-weight: 600; }
.tab-count { font-size: var(--text-sm); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--muted); }
.tabs a[aria-current="page"] .tab-count { color: inherit; }

/* Messages */
.notice {
  padding: var(--space-3) var(--space-4); margin-bottom: var(--space-5); font-weight: 500;
  background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--ink); border-radius: var(--radius);
}
/* The confirmation after an action: ok text on its soft tint (5.6:1). */
.notice.done { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-soft); border-left-color: var(--ok); }
.empty {
  padding: var(--space-6) var(--space-4); text-align: center; color: var(--muted);
  border: 1px dashed var(--control-border); border-radius: 0.75rem;
}
.empty .mark { display: block; width: 28px; height: 28px; margin: 0 auto var(--space-3); }

/* Queue */
.cards { display: grid; gap: var(--space-3); list-style: none; margin: 0; padding: 0; }
.card {
  position: relative; padding: var(--space-4); background: var(--surface);
  border: 1px solid var(--line); border-radius: 0.75rem; transition: border-color 120ms ease;
}
.card:hover { border-color: var(--control-border); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
.chip {
  display: inline-block; padding: 0.125rem var(--space-2); border-radius: 999px;
  background: var(--chip); color: var(--muted); font-size: var(--text-sm); font-weight: 500; line-height: 1.5;
}
.chip.accent { background: var(--accent-soft); color: var(--accent); }
.chip.warn { background: var(--warn-soft); color: var(--warn); font-weight: 600; }
.chip.ok { background: var(--ok-soft); color: var(--ok); }
.chip.risk { background: var(--danger-soft); color: var(--danger); }
.chip.verify { background: var(--warn-soft); color: var(--warn); }
.card-title {
  margin: var(--space-2) 0 var(--space-1); font-size: var(--text-lg); font-weight: 600;
  color: var(--ink); letter-spacing: 0; overflow-wrap: anywhere;
}
.card-title a { text-decoration: none; }
.card-title a::after { content: ""; position: absolute; inset: 0; border-radius: 0.75rem; }
.card:hover .card-title a { text-decoration: underline; text-decoration-color: var(--accent); }
@supports selector(:has(*)) {
  .card-title a:focus-visible { outline: none; }
  .card:has(.card-title a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
}
.queue-summary { margin-bottom: var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.reasons { list-style: none; margin: 0; padding: 0; overflow-wrap: anywhere; }
.reasons li + li { margin-top: var(--space-2); }
.reasons .chip { margin-right: var(--space-1); }
.card .reasons { margin-top: var(--space-2); font-size: var(--text-sm); }

/* Paging */
.pager { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-5); }
.pager-link {
  display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 var(--space-5);
  background: var(--surface); border: 1px solid var(--control-border); border-radius: 999px;
  font-weight: 600; text-decoration: none; transition: border-color 120ms ease;
}
.pager-link:hover { border-color: var(--ink); }
.pager-link.next { margin-left: auto; }

/* Story: one column below 64rem; the side column's sections fall into the page order. */
.back { margin: calc(-1 * var(--space-2)) 0 var(--space-2); }
.back a { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--muted); }
.story { display: flex; flex-direction: column; gap: var(--space-4); }
.story-side { display: contents; }
.story-main { display: contents; }
/* Head, reasons, fact card, sources; then the form, the preview, the decision card, history. */
.story-main > * { order: 1; }
.preview { order: 2; }
.story-main > .danger-card { order: 3; }
.history-panel { order: 4; }
.story-head .chips { margin-top: var(--space-3); }
.story-title { font-size: var(--text-xl); font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.chip.status { color: var(--ink); font-weight: 600; }
main > section { margin-top: var(--space-6); }
.panel { padding: var(--space-4); background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; }
.facts, .texts { margin: 0; }
.facts dt, .texts dt { font-size: var(--text-sm); color: var(--muted); }
.facts dd, .texts dd { margin: 0 0 var(--space-3); overflow-wrap: anywhere; }
.facts dd:last-child, .texts dd:last-child { margin-bottom: 0; }
.sources { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.sources li { padding: var(--space-2) 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.main-source { overflow-wrap: anywhere; }
.plain-url { overflow-wrap: anywhere; color: var(--muted); }
.history { list-style: none; margin: 0; padding: 0; }
.history li { padding: var(--space-2) 0; border-top: 1px solid var(--line); }
.history li:last-child { padding-bottom: 0; }
.history .note { margin-top: var(--space-1); padding-left: var(--space-3); border-left: 2px solid var(--line); overflow-wrap: anywhere; }

/* Preview: an approximation of the site's story block, in the admin's font. */
.pv-story { overflow-wrap: anywhere; }
.pv-story + .pv-story { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--line); }
.pv-lang { margin-bottom: var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.pv-meta { margin-bottom: var(--space-2); }
.pv-tag {
  display: inline-block; padding: 0.125rem var(--space-2); border: 1px solid var(--ink);
  font-size: 0.8125rem; letter-spacing: 0.04em; line-height: 1.5; text-transform: uppercase;
}
.pv-title { margin-bottom: var(--space-2); font-size: 1.125rem; font-weight: 700; line-height: 1.3; }
.pv-summary { margin-bottom: var(--space-3); font-size: var(--text-sm); }
.pv-dev {
  padding: var(--space-3); font-size: var(--text-sm);
  background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--accent);
}
.pv-dev-label { margin-bottom: var(--space-1); color: var(--accent); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }

/* Forms */
.stack > * + * { margin-top: var(--space-4); }
.field label, .lang-group legend { display: block; font-weight: 600; margin-bottom: var(--space-1); }
fieldset.lang-group { margin: 0; min-width: 0; }
.lang-group legend { float: left; width: 100%; padding: 0; font-size: var(--text-lg); margin-bottom: var(--space-3); }
.lang-group legend + * { clear: both; }
.lang-group .field + .field { margin-top: var(--space-4); }
input[type="url"], select, textarea {
  display: block; width: 100%; min-height: var(--tap); padding: var(--space-2) var(--space-3);
  font: inherit; color: var(--ink); background: var(--surface);
  border: 1px solid var(--control-border); border-radius: var(--radius);
}
textarea { resize: vertical; line-height: 1.5; }
input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--accent); }
.counter { text-align: right; margin-top: var(--space-1); font-variant-numeric: tabular-nums; }
.counter.warn { color: var(--warn); }
.hint { margin-top: var(--space-1); }
.check { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap); }
.check input { width: 1.375rem; height: 1.375rem; margin: 0; accent-color: var(--ink); flex: none; }
.check label { font-weight: 500; }

/* Buttons */
.actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
button {
  min-height: var(--tap); padding: 0 var(--space-5); font: inherit; font-weight: 600;
  border-radius: var(--radius); cursor: pointer; border: 1px solid var(--control-border);
  background: var(--surface); color: var(--ink); transition: border-color 120ms ease, background-color 120ms ease;
}
button:hover { border-color: var(--ink); }
.primary { background: var(--ink); border-color: var(--ink); color: var(--surface); width: 100%; }
.primary:hover { background: #2c2e32; border-color: #2c2e32; }
.danger { border-color: var(--danger); color: var(--danger); }

/* The action bar sticks to the bottom of the viewport while the form is on screen. */
.action-bar {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; flex-direction: column; gap: var(--space-2);
  margin: var(--space-4) calc(-1 * var(--space-4)) 0; padding: var(--space-3) var(--space-4);
  background: var(--surface); border-top: 1px solid var(--line);
}
.action-bar.dirty { border-color: var(--warn); }
.bar-check { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--space-4); }
.source-link { display: inline-flex; align-items: center; min-height: var(--tap); font-weight: 500; margin-left: auto; }
.unsaved { color: var(--warn); font-size: var(--text-sm); font-weight: 600; }
.unsaved[hidden] { display: none; }
.bar-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.bar-buttons button { width: 100%; padding: 0 var(--space-3); }
.bar-buttons button:only-child { grid-column: 1 / -1; }

/* Reject and take-down */
.danger-card { padding: var(--space-4); background: var(--danger-soft); border-radius: 0.75rem; }
.danger-card h2 { color: var(--danger); }
.danger-card .danger { background: var(--surface); }
.danger:hover, .danger-card .danger:hover { background: var(--danger); color: var(--surface); }

@media (min-width: 40rem) {
  html { scroll-padding-top: 4.5rem; }
  html:has(.action-bar) { scroll-padding-bottom: 5.5rem; }
  .who { flex-basis: auto; padding-bottom: 0; }
  .tabs { display: flex; flex-wrap: wrap; }
  .primary { width: auto; }
  .action-bar { flex-direction: row; align-items: center; justify-content: space-between; flex-wrap: wrap; column-gap: var(--space-4); }
  .source-link { margin-left: 0; }
  .bar-buttons { display: flex; margin-left: auto; }
  .bar-buttons button { width: auto; padding: 0 var(--space-5); }
}

/* From 64rem: two columns, at most 72rem wide; the side column stays in view while editing. */
@media (min-width: 64rem) {
  @supports selector(:has(*)) {
    body:has(.story) .wrap, body:has(.story) .top-inner { max-width: 72rem; }
    .story { display: grid; grid-template-columns: minmax(0, 1fr) 22rem; column-gap: var(--space-6); row-gap: var(--space-5); align-items: start; }
    .story-head { grid-column: 1; grid-row: 1; }
    .story-main { grid-column: 1; grid-row: 2; display: flex; flex-direction: column; gap: var(--space-5); }
    .preview { order: 0; }
    .story-side {
      grid-column: 2; grid-row: 1 / span 2; position: sticky; top: 4.5rem;
      display: flex; flex-direction: column; gap: var(--space-4);
      max-height: calc(100vh - 5.5rem); overflow-y: auto; padding: 2px; margin: -2px;
    }
    .story-side { scrollbar-width: thin; scrollbar-color: var(--control-border) transparent; }
    .action-bar { margin: var(--space-4) 0 var(--space-2); border: 1px solid var(--line); border-radius: 0.75rem; bottom: var(--space-2); }
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

// Live counters, the unsaved-changes notice, the live preview and the save key. The page works
// without it; the server enforces every limit.
export const JS = `"use strict";
document.addEventListener("DOMContentLoaded", function () {
  var fields = document.querySelectorAll("textarea[data-limit]");
  Array.prototype.forEach.call(fields, function (field) {
    var limit = Number(field.getAttribute("data-limit"));
    var counter = document.getElementById(field.id + "_count");
    if (!counter || !limit) return;
    var update = function () {
      var n = field.value.length;
      counter.textContent = n + " / " + limit;
      counter.classList.toggle("warn", n > limit);
    };
    field.addEventListener("input", update);
    update();
  });

  var form = document.getElementById("story-form");
  if (!form) return;
  var bar = form.querySelector(".action-bar");
  var notice = document.getElementById("unsaved");
  // The story's fields as typed; the checkbox and the hidden version are not story text.
  var snapshot = function () {
    var values = [];
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "submit") values.push(el.value);
    });
    return JSON.stringify(values);
  };
  var initial = snapshot();
  // Set by the server when the page re-renders typed text that was not saved.
  var kept = form.hasAttribute("data-dirty");
  var dirty = false;
  var onLeave = function (event) {
    event.preventDefault();
    event.returnValue = "";
  };
  var setDirty = function (next) {
    if (next === dirty) return;
    dirty = next;
    if (bar) bar.classList.toggle("dirty", dirty);
    if (notice) notice.hidden = !dirty;
    if (dirty) window.addEventListener("beforeunload", onLeave);
    else window.removeEventListener("beforeunload", onLeave);
  };
  var check = function () { setDirty(kept || snapshot() !== initial); };
  if (kept) setDirty(true);
  form.addEventListener("input", check);
  form.addEventListener("change", check);
  form.addEventListener("submit", function () { kept = false; setDirty(false); });

  // The preview follows the form, as text only: each part has the id "pv_" + its field's id.
  // Synced once at load too, for values the browser restored into the fields.
  Array.prototype.forEach.call(form.querySelectorAll("textarea"), function (field) {
    var part = document.getElementById("pv_" + field.id);
    if (!part) return;
    var show = function () { part.textContent = field.value; };
    field.addEventListener("input", show);
    show();
  });
  var category = document.getElementById("category");
  if (category) {
    var showCategory = function () {
      var option = category.options[category.selectedIndex];
      var label = option ? option.text : "";
      ["pv_tr_category", "pv_en_category"].forEach(function (id) {
        var tag = document.getElementById(id);
        if (tag) tag.textContent = label;
      });
    };
    category.addEventListener("change", showCategory);
    showCategory();
  }

  // Ctrl+S / Cmd+S saves through the Kaydet button, so its formaction applies.
  var save = document.getElementById("save-button");
  if (save) {
    document.addEventListener("keydown", function (event) {
      var isSave = (event.ctrlKey || event.metaKey) && typeof event.key === "string" && event.key.toLowerCase() === "s";
      if (!isSave) return;
      // In a field of another form (the reject or take-down note) the key is left to the browser.
      var target = event.target;
      if (target && target.form && target.form !== form) return;
      event.preventDefault();
      if (event.repeat) return;
      if (typeof form.requestSubmit === "function") form.requestSubmit(save);
      else save.click();
    });
  }
});
`;
