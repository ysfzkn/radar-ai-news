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

.muted, .meta, .hint, .counter, .status-line, .who { color: var(--muted); font-size: var(--text-sm); }
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
.brand::before { content: ""; flex: none; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--accent); }
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
.empty {
  padding: var(--space-6) var(--space-4); text-align: center; color: var(--muted);
  border: 1px dashed var(--control-border); border-radius: 0.75rem;
}

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
.reasons { margin: 0; padding-left: var(--space-5); overflow-wrap: anywhere; }
.reasons li + li { margin-top: var(--space-1); }
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

/* Story */
.back { margin-bottom: var(--space-4); }
.back a { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--muted); }
.story-title { font-size: var(--text-xl); font-weight: 700; overflow-wrap: anywhere; }
.status-line { margin: var(--space-2) 0 0; }
.status-line .status { color: var(--ink); font-weight: 600; }
article > section, main > section { margin-top: var(--space-6); }
.facts, .texts { margin: 0; }
.facts dt, .texts dt { font-size: var(--text-sm); color: var(--muted); }
.facts dd, .texts dd { margin: 0 0 var(--space-3); overflow-wrap: anywhere; }
.sources { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.sources li { padding: var(--space-2) 0; overflow-wrap: anywhere; }
.main-source { overflow-wrap: anywhere; }
.plain-url { overflow-wrap: anywhere; color: var(--muted); }
.history { list-style: none; margin: 0; padding: 0; }
.history li { padding: var(--space-2) 0; border-top: 1px solid var(--line); }
.history .note { margin-top: var(--space-1); padding-left: var(--space-3); border-left: 2px solid var(--line); overflow-wrap: anywhere; }

/* Forms */
.stack > * + * { margin-top: var(--space-4); }
.field label, .lang-group legend { display: block; font-weight: 600; margin-bottom: var(--space-1); }
.lang-group { border: 0; margin: var(--space-5) 0 0; padding: var(--space-4) 0 0; border-top: 1px solid var(--line); }
.lang-group legend { padding: 0; font-size: var(--text-lg); margin-bottom: var(--space-3); }
.lang-group .field + .field { margin-top: var(--space-4); }
div.lang-group { margin-top: var(--space-4); }
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
.danger { border-color: var(--danger); color: var(--danger); }
.danger:hover { border-color: var(--danger); background: var(--danger-soft); }
.decide .destructive { margin-top: var(--space-6); padding-top: var(--space-5); border-top: 1px solid var(--line); }

@media (min-width: 40rem) {
  .who { flex-basis: auto; padding-bottom: 0; }
  .tabs { display: flex; flex-wrap: wrap; }
  .primary { width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

// Live counters only. The page works without it; the server enforces every limit.
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
});
`;
