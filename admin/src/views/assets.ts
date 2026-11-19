// The stylesheet and the script, served from /admin/app.css and /admin/app.js.

export const CSS = `:root {
  color-scheme: light dark;
  --bg: #fbfbf9;
  --fg: #1c1c1a;
  --muted: #5f5e59;
  --line: #e2e1dc;
  --field: #ffffff;
  --accent: #2c55c9;
  --accent-fg: #ffffff;
  --warn: #a2470c;
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
  --focus-ring: 0 0 0 3px var(--bg), 0 0 0 5px var(--accent);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514;
    --fg: #ecebe6;
    --muted: #a4a39c;
    --line: #2e2e2b;
    --field: #1d1d1b;
    --accent: #8eaeff;
    --accent-fg: #0b1430;
    --warn: #f2a462;
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: var(--text-md) / var(--leading) var(--font);
  -webkit-text-size-adjust: 100%;
}

.top, main {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 0 var(--space-4);
}

main { padding-bottom: var(--space-6); }

a { color: inherit; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }

:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius); }

h1, h2, h3 { line-height: 1.3; margin: 0; }
h2 { font-size: var(--text-sm); font-weight: 600; color: var(--muted); letter-spacing: 0.02em; margin-bottom: var(--space-2); }
h3 { font-size: var(--text-md); font-weight: 600; margin-bottom: var(--space-2); }
p { margin: 0; }

.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.muted, .meta, .time, .hint, .counter, .status-line, .who { color: var(--muted); font-size: var(--text-sm); }
.warn { color: var(--warn); font-weight: 600; }

/* Header and tabs */
.top { padding-top: var(--space-4); border-bottom: 1px solid var(--line); margin-bottom: var(--space-5); }
.brand-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.brand { font-weight: 700; text-decoration: none; }
.who { overflow-wrap: anywhere; }
.tabs { display: grid; grid-template-columns: repeat(2, 1fr); column-gap: var(--space-1); list-style: none; margin: var(--space-3) 0 0; padding: 0; }
.tabs a {
  display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap);
  padding: 0 var(--space-3); white-space: nowrap; text-decoration: none; color: var(--muted);
  border-bottom: 2px solid transparent;
}
.tabs a[aria-current="page"] { color: var(--fg); font-weight: 600; border-bottom-color: var(--fg); }
.tab-count { font-size: var(--text-sm); font-variant-numeric: tabular-nums; }

/* Messages */
.notice { padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-left: 3px solid var(--fg); border-radius: var(--radius); margin-bottom: var(--space-5); font-weight: 500; }
.empty { color: var(--muted); padding: var(--space-6) 0; text-align: center; }

/* Queue */
.cards { list-style: none; margin: 0; padding: 0; }
.card { position: relative; padding: var(--space-4) 0; border-bottom: 1px solid var(--line); }
.card:first-child { padding-top: 0; }
.card-title { font-size: var(--text-lg); font-weight: 600; margin: var(--space-1) 0 var(--space-2); overflow-wrap: anywhere; }
.card-title a { text-decoration: none; }
.card-title a::after { content: ""; position: absolute; inset: 0; }
.card-title a:focus-visible { box-shadow: none; }
.card:focus-within { box-shadow: var(--focus-ring); border-radius: var(--radius); }
.card:hover .card-title a { text-decoration: underline; }
.reasons { margin: 0 0 var(--space-2); padding-left: var(--space-5); overflow-wrap: anywhere; }
.reasons li + li { margin-top: var(--space-1); }

/* Story */
.back { margin-bottom: var(--space-4); }
.back a { display: inline-flex; align-items: center; min-height: var(--tap); color: var(--muted); }
.story-title { font-size: var(--text-xl); font-weight: 700; overflow-wrap: anywhere; }
.status-line { margin: var(--space-2) 0 0; }
.status-line .status { color: var(--fg); font-weight: 600; }
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
  font: inherit; color: var(--fg); background: var(--field);
  border: 1px solid var(--line); border-radius: var(--radius);
}
textarea { resize: vertical; line-height: 1.5; }
input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--accent); }
.counter { text-align: right; margin-top: var(--space-1); font-variant-numeric: tabular-nums; }
.counter.warn { color: var(--warn); }
.hint { margin-top: var(--space-1); }
.check { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap); }
.check input { width: 1.375rem; height: 1.375rem; margin: 0; accent-color: var(--accent); flex: none; }
.check label { font-weight: 500; }

/* Buttons */
.actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
button {
  min-height: var(--tap); padding: 0 var(--space-5); font: inherit; font-weight: 600;
  border-radius: var(--radius); cursor: pointer; border: 1px solid var(--fg);
  background: transparent; color: var(--fg); transition: opacity 120ms ease;
}
button:hover { opacity: 0.85; }
.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); width: 100%; }
.secondary { border-color: var(--line); }
.danger { border-color: var(--muted); color: var(--fg); }
.decide .destructive { margin-top: var(--space-6); padding-top: var(--space-5); border-top: 1px solid var(--line); }

@media (min-width: 40rem) {
  .tabs { grid-template-columns: repeat(4, auto); justify-content: start; }
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
