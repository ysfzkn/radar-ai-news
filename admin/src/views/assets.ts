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
/* Brand on the left; the run page and the live site on the right; the signed-in address under
   them on a phone, between them from 40rem. */
.top-inner {
  display: flex; flex-wrap: wrap; align-items: center;
  column-gap: var(--space-3); padding-top: var(--space-1); padding-bottom: var(--space-1);
}
.brand {
  display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--tap); margin-right: auto;
  font-size: var(--text-lg); line-height: 1; text-decoration: none;
}
.mark { flex: none; width: 18px; height: 18px; }
.mark-arc { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linecap: round; }
.wordmark { font-weight: 700; letter-spacing: -0.01em; }
.brand-suffix { color: var(--muted); font-weight: 500; }
.top-links { display: flex; align-items: center; gap: var(--space-2); }
.top-link {
  display: inline-flex; align-items: center; gap: 0.375rem; min-height: 2.25rem; padding: 0 var(--space-3);
  font-size: var(--text-sm); font-weight: 600; white-space: nowrap; text-decoration: none;
  color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 999px;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.top-link:hover { border-color: var(--control-border); }
/* A small play triangle before "Çalıştır", drawn in the text colour. */
.run-link::before {
  content: ""; width: 0.5rem; height: 0.625rem; background: currentColor;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}
.top-link[aria-current="page"] { background: var(--ink); border-color: var(--ink); color: var(--surface); }
.who { flex-basis: 100%; margin: 0; padding-bottom: var(--space-2); overflow-wrap: anywhere; line-height: 1.3; }

/* Tabs: an underlined bar. On a phone it scrolls sideways and fades at an edge with more to see. */
.tabs-wrap { margin-top: var(--space-2); }
.tabs {
  display: flex; gap: var(--space-1);
  list-style: none; margin: 0 0 var(--space-5); padding: 0; border-bottom: 1px solid var(--line);
}
.tabs a {
  display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--tap);
  padding: 0 var(--space-3); margin-bottom: -1px; white-space: nowrap; text-decoration: none; font-weight: 500;
  color: var(--muted); border-bottom: 2px solid transparent;
  transition: color 120ms ease, border-color 120ms ease;
}
.tabs a:hover { color: var(--ink); border-bottom-color: var(--control-border); }
.tabs a[aria-current="page"] { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
.tab-count {
  min-width: 1.5rem; padding: 0 0.375rem; border-radius: 999px; text-align: center;
  background: var(--chip); color: var(--muted);
  font-size: 0.8125rem; font-weight: 600; line-height: 1.5; font-variant-numeric: tabular-nums;
}
.tabs a[aria-current="page"] .tab-count { background: var(--ink); color: var(--surface); }
.tabs[data-more~="right"], .filter-chips[data-more~="right"] {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
}
.tabs[data-more~="left"], .filter-chips[data-more~="left"] {
  -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to left, #000 calc(100% - 2.5rem), transparent);
}
.tabs[data-more~="left"][data-more~="right"], .filter-chips[data-more~="left"][data-more~="right"] {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent);
  mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent);
}

/* Messages: one shape, a tone each. Neutral (an error) has the ink edge. */
.notice {
  padding: var(--space-3) var(--space-4); margin-bottom: var(--space-5); font-weight: 500;
  background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--ink); border-radius: var(--radius);
  overflow-wrap: anywhere;
}
/* The confirmation after an action: ok text on its soft tint (5.6:1). */
.notice.done { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-soft); border-left-color: var(--ok); }
/* Something that holds an action back: warn text on its soft tint. */
.notice.warn { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-soft); border-left-color: var(--warn); }
/* A plain state line. */
.notice.calm { color: var(--muted); border-left-color: var(--ok); font-weight: 400; }
.empty {
  padding: var(--space-6) var(--space-4); text-align: center; color: var(--muted);
  background: var(--surface); border: 1px dashed var(--control-border); border-radius: 0.75rem;
}
.empty .mark { display: block; width: 28px; height: 28px; margin: 0 auto var(--space-3); }
.empty-title { margin-bottom: var(--space-1); color: var(--ink); font-size: var(--text-lg); font-weight: 700; }
.empty a { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--ink); font-weight: 600; }
/* An empty list inside a panel: one quiet line. */
.empty-line { color: var(--muted); font-size: var(--text-sm); }

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
/* A waiting story with under six hours left: the warn colour on its edge as well as its chip. */
.card:has(.chip.warn) { border-left: 3px solid var(--warn); }
/* The row j and k have moved to. */
.card.is-selected { border-color: var(--ink); outline: 2px solid var(--accent); outline-offset: 2px; }

/* Status strip */
.strip-wrap { margin-top: 0; }
/* One panel cut into cells: the 1px gaps show the line colour behind them. */
.strip {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: 0 0 var(--space-4);
  background: var(--line); border: 1px solid var(--line); border-radius: 0.75rem; overflow: hidden;
}
.stat { min-width: 0; padding: var(--space-2) var(--space-3); background: var(--surface); }
.stat dt { color: var(--muted); font-size: 0.8125rem; line-height: 1.4; }
.stat dd { margin: 0; font-size: var(--text-lg); font-weight: 700; line-height: 1.35; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stat.warn-stat { background: var(--warn-soft); }
.stat.warn-stat dd { color: var(--warn); }

/* Search and category chips */
.search { margin-bottom: var(--space-3); }
.search-row { display: flex; gap: var(--space-2); }
.search-row input { flex: 1; min-width: 0; }
.search-row button { flex: none; }
.filter-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; margin: 0 0 var(--space-4); padding: 0; }
.chip-link {
  display: inline-flex; align-items: center; min-height: 2.25rem; padding: 0 var(--space-3);
  background: var(--chip); color: var(--ink); border: 1px solid transparent; border-radius: 999px;
  font-size: var(--text-sm); font-weight: 500; text-decoration: none; transition: border-color 120ms ease;
}
.chip-link:hover { border-color: var(--control-border); }
.chip-link[aria-current="true"] { background: var(--ink); border-color: var(--ink); color: var(--surface); font-weight: 600; }
.results { margin: calc(-1 * var(--space-2)) 0 var(--space-3); color: var(--muted); font-size: var(--text-sm); }
.results strong { color: var(--ink); font-weight: 600; }
.clear { display: inline-flex; align-items: center; min-height: var(--tap); margin-left: var(--space-2); color: var(--ink); font-weight: 600; }

/* Today's edition */
.page-title { font-size: var(--text-xl); font-weight: 700; letter-spacing: -0.01em; }
.page-date { color: var(--muted); font-weight: 500; }
.page-intro { margin: var(--space-1) 0 var(--space-4); }
.edition-row .takedown { position: relative; z-index: 1; margin-top: var(--space-2); }
.takedown summary {
  display: inline-flex; align-items: center; min-height: var(--tap); cursor: pointer;
  color: var(--danger); font-size: var(--text-sm); font-weight: 600;
}
.takedown[open] { padding: 0 var(--space-3) var(--space-3); background: var(--danger-soft); border-radius: var(--radius); }
.takedown .danger { background: var(--surface); }
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
/* Back to the list, then the story's place in it with the stories either side. */
.story-top {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 0 var(--space-3); margin: calc(-1 * var(--space-2)) 0 var(--space-2);
}
.story-top .back { margin: 0; }
.story-nav { display: flex; align-items: center; gap: var(--space-1); margin-left: auto; }
.nav-link {
  display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 var(--space-3);
  background: var(--chip); border: 1px solid transparent; border-radius: 999px;
  font-size: var(--text-sm); font-weight: 600; text-decoration: none; white-space: nowrap; transition: border-color 120ms ease;
}
.nav-link:hover { border-color: var(--control-border); }
.nav-pos { padding: 0 var(--space-2); color: var(--muted); font-size: var(--text-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
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
/* The story line as the site draws it: an inline ink pill (16.6:1), then the text; no box. */
.pv-why { font-size: 1rem; }
.pv-why-label {
  margin-right: 0.125rem; padding: 0.125rem 0.5rem; border-radius: 999px;
  background: var(--ink); color: var(--bg); font-size: 0.75rem;
  letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
}

/* Forms */
.stack > * + * { margin-top: var(--space-4); }
.field label, .lang-group legend { display: block; font-weight: 600; margin-bottom: var(--space-1); }
fieldset.lang-group { margin: 0; min-width: 0; }
.lang-group legend { float: left; width: 100%; padding: 0; font-size: var(--text-lg); margin-bottom: var(--space-3); }
.lang-group legend + * { clear: both; }
.lang-group .field + .field { margin-top: var(--space-4); }
input[type="url"], input[type="search"], select, textarea {
  display: block; width: 100%; min-height: var(--tap); padding: var(--space-2) var(--space-3);
  font: inherit; color: var(--ink); background: var(--surface);
  border: 1px solid var(--control-border); border-radius: var(--radius);
}
textarea { resize: vertical; line-height: 1.5; }
input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--accent); }
.counter { text-align: right; margin-top: var(--space-1); font-variant-numeric: tabular-nums; }
/* Over the limit: the danger colour; the server still decides. */
.counter.over { color: var(--danger); font-weight: 600; }
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
/* A button that cannot be used now; the reason is written next to it. */
button:disabled, button:disabled:hover {
  cursor: not-allowed; background: var(--chip); border-color: var(--line); color: var(--muted);
}

/* Panels with a heading and a link on one line. */
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.panel-link { display: inline-flex; align-items: center; min-height: var(--tap); margin: calc(-1 * var(--space-3)) 0; font-size: var(--text-sm); font-weight: 600; }

/* The run page */
.run-grid { display: grid; gap: var(--space-4); }
.run-col { display: grid; gap: var(--space-4); align-content: start; min-width: 0; }
.not-set-up { margin-bottom: var(--space-4); }
fieldset.modes { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: var(--space-2); }
.modes legend { padding: 0; margin-bottom: var(--space-2); font-weight: 600; }
.mode-option {
  display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3);
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); cursor: pointer;
  transition: border-color 120ms ease;
}
.mode-option:hover { border-color: var(--control-border); }
.mode-option:has(input:checked) { border-color: var(--ink); outline: 1px solid var(--ink); outline-offset: -2px; }
.mode-option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.mode-option input { flex: none; width: 1.25rem; height: 1.25rem; margin: 0.125rem 0 0; accent-color: var(--ink); }
.mode-text { display: grid; gap: 0.125rem; min-width: 0; }
.mode-label { font-weight: 600; }
.mode-desc { color: var(--muted); font-size: var(--text-sm); line-height: 1.45; }
.runs { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.run-row {
  display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 0 var(--space-3);
  padding: var(--space-3) 0; border-top: 1px solid var(--line);
}
.run-row:last-child { padding-bottom: 0; }
.run-row > .chip { justify-self: start; margin-top: 0.125rem; white-space: nowrap; }
.run-title { font-weight: 600; overflow-wrap: anywhere; }
.run-link-out { grid-column: 2; font-size: var(--text-sm); }
.run-link-out a { display: inline-flex; align-items: center; min-height: 2.25rem; font-weight: 500; }
.run-history .history { margin-top: var(--space-2); }
.history-line { overflow-wrap: anywhere; }
.history-line .chip { margin-right: var(--space-1); }
.run-form .actions { align-items: center; }

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
/* The phone bar's link to the reject card (a link: it moves down the page and decides nothing). */
.bar-reject { display: none; }

/* Footer: the keyboard hint, shown by the script when the shortcut sheet can open. */
.foot { padding-bottom: var(--space-5); }
.kbd-hint {
  min-height: 2rem; padding: 0 var(--space-3); font-size: var(--text-sm); font-weight: 500;
  color: var(--muted); background: transparent; border-color: var(--line);
}
.kbd-hint[hidden] { display: none; }
kbd {
  display: inline-block; min-width: 1.5em; padding: 0.0625rem 0.375rem; text-align: center;
  font: 600 0.8125rem / 1.4 var(--font); color: var(--ink); background: var(--surface);
  border: 1px solid var(--control-border); border-bottom-width: 2px; border-radius: 0.25rem;
}
.sheet {
  width: min(28rem, calc(100% - 2 * var(--space-4))); padding: var(--space-5);
  color: var(--ink); background: var(--surface); border: 1px solid var(--ink); border-radius: 0.75rem;
}
.sheet::backdrop { background: rgb(23 24 26 / 0.4); }
.sheet h2 { margin-bottom: var(--space-3); color: var(--ink); font-size: var(--text-lg); letter-spacing: 0; }
.keys { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0 0 var(--space-3); }
.keys dt { white-space: nowrap; }
.keys dd { margin: 0; }
.sheet .actions { margin-top: var(--space-4); justify-content: flex-end; }

/* Reject, take-down and restore */
.danger-card { padding: var(--space-4); background: var(--danger-soft); border-radius: 0.75rem; }
.danger-card h2 { color: var(--danger); }
.danger-card .danger { background: var(--surface); }
.danger:hover, .danger-card .danger:hover { background: var(--danger); color: var(--surface); }

/* Up to 40rem (640 px): the tabs scroll sideways; the decision bar is fixed to the bottom of the
   screen, with large targets and room kept under the page so it never covers the last field. */
@media (max-width: 40rem) {
  .tabs {
    flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
    margin-left: calc(-1 * var(--space-4)); margin-right: calc(-1 * var(--space-4)); padding: 0 var(--space-4);
  }
  .tabs::-webkit-scrollbar, .filter-chips::-webkit-scrollbar { display: none; }
  .tabs li, .filter-chips li { flex: none; }
  .filter-chips {
    flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
    margin-left: calc(-1 * var(--space-4)); margin-right: calc(-1 * var(--space-4)); padding: 0 var(--space-4);
  }
  .tabs { margin-bottom: var(--space-4); gap: 0; }
  .tabs a { padding: 0 var(--space-3); }
  .stat dd { font-size: var(--text-md); }
  .action-bar {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; margin: 0;
    padding: var(--space-2) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
  }
  .bar-buttons button { min-height: 3rem; }
  .bar-buttons.decide { grid-template-columns: auto auto minmax(0, 1fr); gap: var(--space-2); }
  .bar-reject {
    display: inline-flex; align-items: center; justify-content: center; min-height: 3rem; padding: 0 var(--space-3);
    font-weight: 600; color: var(--danger); text-decoration: none; white-space: nowrap;
    border: 1px solid var(--danger); border-radius: var(--radius); background: var(--surface);
  }
  body:has(.action-bar) { padding-bottom: 11rem; }
  html:has(.action-bar) { scroll-padding-bottom: 11.5rem; }
  .card { padding: var(--space-4) var(--space-4) var(--space-5); }
  .foot { display: none; }
}

@media (min-width: 40rem) {
  html { scroll-padding-top: 4.5rem; }
  html:has(.action-bar) { scroll-padding-bottom: 5.5rem; }
  .who { flex-basis: auto; order: 1; padding-bottom: 0; }
  .top-links { order: 2; }
  .tabs { flex-wrap: wrap; }
  .run-row { grid-template-columns: 6.5rem minmax(0, 1fr) auto; }
  .run-link-out { grid-column: auto; }
  .run-link-out a { min-height: 0; }
  .strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
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
    body:has(.run-grid) .wrap, body:has(.run-grid) .top-inner { max-width: 72rem; }
  }
  .run-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); column-gap: var(--space-5); align-items: start; }
  .run-grid.single { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

// Live counters, the keyboard shortcuts, the unsaved-changes notice, the live preview and the save
// key. The page works without it; the server enforces every limit.
export const JS = `"use strict";
document.addEventListener("DOMContentLoaded", function () {
  // A confirmation is shown once: the done hint leaves the address, so a refresh does not repeat it.
  if (typeof URLSearchParams === "function" && window.history && typeof window.history.replaceState === "function") {
    var params = new URLSearchParams(window.location.search);
    if (params.has("done")) {
      params.delete("done");
      var query = params.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    }
  }

  // Counted as the server counts (trimmed). Over the limit the counter turns red; no button is
  // switched off, since the server is the judge.
  var fields = document.querySelectorAll("[data-limit]");
  Array.prototype.forEach.call(fields, function (field) {
    var limit = Number(field.getAttribute("data-limit"));
    var counter = document.getElementById(field.id + "_count");
    if (!counter || !limit) return;
    var update = function () {
      var n = field.value.trim().length;
      counter.textContent = n + " / " + limit;
      counter.classList.toggle("over", n > limit);
    };
    field.addEventListener("input", update);
    update();
  });

  // Keyboard shortcuts. None of them sends a form: "a" and "r" only move the focus, so a decision
  // still needs its own Enter or click. Ignored while typing in a field and with Ctrl, Cmd or Alt
  // held; Shift only for "?", which most keyboards need it for.
  var sheet = document.getElementById("shortcuts");
  var canShow = !!sheet && typeof sheet.showModal === "function";
  var toggleSheet = function () {
    if (!canShow) return;
    if (sheet.open) sheet.close();
    else sheet.showModal();
  };
  var opener = document.getElementById("shortcuts-open");
  if (opener && canShow) {
    opener.hidden = false;
    opener.addEventListener("click", toggleSheet);
  }
  var closer = document.getElementById("shortcuts-close");
  if (closer && canShow) closer.addEventListener("click", function () { sheet.close(); });

  // On a phone the tabs and the category chips scroll sideways: bring the current one into view
  // (sideways only, so a restored page position is left alone).
  var marked = document.querySelectorAll('.tabs [aria-current="page"], .filter-chips [aria-current]');
  Array.prototype.forEach.call(marked, function (el) {
    var row = el.closest ? el.closest("ul") : null;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    var shift = el.getBoundingClientRect().right - row.getBoundingClientRect().right;
    if (shift > 0) row.scrollLeft += shift + 16;
  });

  // A row that scrolls sideways fades at the edge that has more to show (data-more).
  Array.prototype.forEach.call(document.querySelectorAll(".tabs, .filter-chips"), function (row) {
    var mark = function () {
      var more = [];
      if (row.scrollLeft > 2) more.push("left");
      if (row.scrollLeft + row.clientWidth < row.scrollWidth - 2) more.push("right");
      if (more.length) row.setAttribute("data-more", more.join(" "));
      else row.removeAttribute("data-more");
    };
    row.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    mark();
  });

  var rows = document.querySelectorAll(".cards > .card");
  var current = -1;
  var rowLink = function (row) { return row ? row.querySelector(".card-title a") : null; };
  var select = function (index) {
    if (rows.length === 0) return false;
    var next = Math.max(0, Math.min(rows.length - 1, index));
    if (current >= 0 && rows[current]) rows[current].classList.remove("is-selected");
    current = next;
    rows[current].classList.add("is-selected");
    var link = rowLink(rows[current]);
    if (link) link.focus();
    return true;
  };
  var typing = function (el) {
    if (!el || typeof el.tagName !== "string") return false;
    var tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
  };
  var go = function (link) {
    if (link) link.click();
    return !!link;
  };
  var focusOn = function (id) {
    var el = document.getElementById(id);
    if (el) el.focus();
    return !!el;
  };
  document.addEventListener("keydown", function (event) {
    // keyCode 229: a key that an input method is composing with (some browsers send it without isComposing).
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return;
    var target = event.target;
    if (typing(target)) return;
    var key = event.key;
    if (key === "?") {
      if (canShow) {
        event.preventDefault();
        toggleSheet();
      }
      return;
    }
    if (event.shiftKey || (canShow && sheet.open)) return;
    var handled = false;
    if (key === "j") handled = select(current + 1);
    else if (key === "k") handled = select(current < 0 ? 0 : current - 1);
    else if (key === "Enter") {
      // On the selected row's link the browser follows it itself; from nowhere in particular, here.
      var onPage = !target || target === document.body || target === document.documentElement;
      if (onPage && current >= 0) handled = go(rowLink(rows[current]));
    }
    else if ((key === "n" || key === "p") && !event.repeat) handled = go(document.getElementById(key === "n" ? "story-next" : "story-prev"));
    else if (key === "a") handled = focusOn("approve-button");
    else if (key === "r") handled = focusOn("reject_note");
    if (handled) event.preventDefault();
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
  // Set once the form is on its way, so the save key cannot send it a second time with the old
  // version; cleared when the page is shown again (also from the back/forward cache).
  var sent = false;
  form.addEventListener("submit", function () { sent = true; kept = false; setDirty(false); });
  window.addEventListener("pageshow", function () { sent = false; });

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

  // Plain Ctrl+S / Cmd+S saves through the Kaydet button, so its formaction applies.
  var save = document.getElementById("save-button");
  if (save) {
    document.addEventListener("keydown", function (event) {
      if (event.isComposing || event.keyCode === 229) return;
      var isSave = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
        typeof event.key === "string" && event.key.toLowerCase() === "s";
      if (!isSave) return;
      // In a field of another form (the reject or take-down note) the key is left to the browser.
      var target = event.target;
      if (target && target.form && target.form !== form) return;
      event.preventDefault();
      if (event.repeat || sent) return;
      if (typeof form.requestSubmit === "function") form.requestSubmit(save);
      else save.click();
    });
  }
});
`;
