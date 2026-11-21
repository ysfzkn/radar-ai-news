import { html } from "hono/html";
import { COPY } from "../copy";
import { MAX_STORIES, RUN_MODES, isActive, type RunInputs, type RunsResult, type WorkflowRun } from "../github";
import type { Dispatch } from "../runs";
import { RADAR_MARK, duration, externalLink, formatDate, type View } from "./layout";

export interface RunPage {
  configured: boolean;
  // GitHub's recent runs; null when running from here is not set up.
  runs: RunsResult | null;
  cooldownMs: number;
  history: Dispatch[];
  // The options to show selected (what was sent, when the page is shown again after a refusal).
  form?: RunInputs | undefined;
  // A page-level message is already shown, so the state line is left out.
  hasMessage: boolean;
}

// Whole minutes, rounded up: a cool-down never reads "0 dk".
export const minutesLeft = (ms: number): string => COPY.minutes(Math.max(1, Math.ceil(ms / 60_000)));

export const busyMessage = (run: WorkflowRun): string => COPY.run.busy(COPY.run.states[run.state], formatDate(run.createdAt));

type Blocked = { reason: string; tone: "warn" | "calm" } | null;

// Why a new run cannot start now, or null when it can.
function blockedBy(p: RunPage): Blocked {
  if (!p.runs || !p.runs.ok) return { reason: COPY.run.unknownState, tone: "warn" };
  const active = p.runs.runs.find(isActive);
  if (active) return { reason: busyMessage(active), tone: "warn" };
  if (p.cooldownMs > 0) return { reason: COPY.run.cooldown(minutesLeft(p.cooldownMs)), tone: "warn" };
  return null;
}

const STATE_TONE: Record<WorkflowRun["state"], string> = {
  queued: "chip warn",
  in_progress: "chip warn",
  success: "chip ok",
  failure: "chip risk",
  timed_out: "chip risk",
  cancelled: "chip",
  skipped: "chip",
  other: "chip",
};

function modeLine(mode: RunInputs["mode"] | null, stories: number | null): string {
  const label = mode ? COPY.run.modes[mode].label : COPY.run.modes.normal.label;
  return stories === null ? label : `${label} · ${COPY.run.stories(stories)}`;
}

function runRow(r: WorkflowRun): View {
  const meta = [formatDate(r.createdAt), COPY.run.events[r.event]];
  if (r.actor) meta.push(r.actor);
  if (r.tookMs !== null) meta.push(r.tookMs < 60_000 ? COPY.run.tookUnderMinute : COPY.run.took(duration(r.tookMs)));
  return html`<li class="run-row">
<span class="${STATE_TONE[r.state]}">${COPY.run.states[r.state]}</span>
<div class="run-main"><p class="run-title">${r.mode ? modeLine(r.mode, r.stories) : COPY.run.modes.normal.label}</p><p class="meta">${meta.join(" · ")}</p></div>
<p class="run-link-out">${externalLink(r.url, COPY.run.openRun)}</p>
</li>`;
}

function runsPanel(runs: RunsResult): View {
  if (!runs.ok) {
    return html`<section class="panel run-list" aria-labelledby="runs-h"><div class="panel-head"><h2 id="runs-h">${COPY.run.runsHeading}</h2></div>
<p class="empty-line">${COPY.run.runsUnavailable(COPY.run.failures[runs.error])}</p></section>`;
  }
  const skipped = runs.runs.some((r) => r.state === "skipped");
  return html`<section class="panel run-list" aria-labelledby="runs-h">
<div class="panel-head"><h2 id="runs-h">${COPY.run.runsHeading}</h2><a class="panel-link" href="/admin/run">${COPY.run.refresh}</a></div>
${runs.runs.length === 0 ? html`<p class="empty-line">${COPY.run.runsEmpty}</p>` : html`<ol class="runs">${runs.runs.map(runRow)}</ol>`}
${skipped ? html`<p class="hint">${COPY.run.skippedHint}</p>` : ""}
</section>`;
}

const OUTCOME_TONE: Record<Dispatch["outcome"], string> = { dispatched: "chip ok", failed: "chip risk", pending: "chip" };

function historyPanel(rows: Dispatch[]): View {
  const items = rows.map(
    (d) => html`<li>
<p class="history-line"><span class="${OUTCOME_TONE[d.outcome]}">${COPY.run.outcomes[d.outcome]}</span> <strong>${modeLine(d.mode, d.max_stories)}</strong></p>
<p class="meta">${formatDate(d.requested_at)} · ${d.actor}</p>
${d.outcome === "failed" && d.failure ? html`<p class="note">${COPY.run.failures[d.failure]}</p>` : ""}
</li>`,
  );
  return html`<section class="panel run-history" aria-labelledby="history-h"><h2 id="history-h">${COPY.run.historyHeading}</h2>
${rows.length === 0 ? html`<p class="empty-line">${COPY.run.historyEmpty}</p>` : html`<ol class="history">${items}</ol>`}
</section>`;
}

function form(p: RunPage, blocked: Blocked): View {
  const chosen = p.form?.mode ?? "normal";
  const stories = p.form?.stories ?? null;
  const modes = RUN_MODES.map(
    (m) => html`<label class="mode-option"><input type="radio" name="mode" value="${m}"${m === chosen ? html` checked` : ""}><span class="mode-text"><span class="mode-label">${COPY.run.modes[m].label}</span><span class="mode-desc">${COPY.run.modes[m].desc}</span></span></label>`,
  );
  const counts = Array.from({ length: MAX_STORIES }, (_, i) => i + 1).map(
    (n) => html`<option value="${n}"${stories === n ? html` selected` : ""}>${n}</option>`,
  );
  return html`<section class="panel run-form-panel" aria-labelledby="run-form-h">
<h2 id="run-form-h">${COPY.run.formHeading}</h2>
<form method="post" action="/admin/run" class="stack run-form" id="run-form">
<fieldset class="modes"><legend>${COPY.run.modeLegend}</legend>
${modes}
</fieldset>
<div class="field">
<label for="stories">${COPY.run.storiesLabel}</label>
<select id="stories" name="stories" aria-describedby="stories-hint">
<option value=""${stories === null ? html` selected` : ""}>${COPY.run.storiesDefault}</option>
${counts}
</select>
<p class="hint" id="stories-hint">${COPY.run.storiesHint}</p>
</div>
<p class="hint">${COPY.run.costHint}</p>
<div class="actions"><button type="submit" class="primary" id="run-button"${blocked ? (p.hasMessage ? html` disabled` : html` disabled aria-describedby="run-state"`) : ""}>${COPY.run.submit}</button></div>
</form>
</section>`;
}

export function runView(p: RunPage): View {
  const head = html`<h1 class="page-title">${COPY.run.title}</h1>
<p class="hint page-intro">${COPY.run.intro}</p>`;
  if (!p.configured || !p.runs) {
    return html`${head}
<div class="empty not-set-up">${RADAR_MARK}<p class="empty-title">${COPY.run.notSetUpTitle}</p><p>${COPY.run.notSetUp}</p></div>
<div class="run-grid single">${historyPanel(p.history)}</div>`;
  }
  const blocked = blockedBy(p);
  const state = p.hasMessage
    ? ""
    : blocked
      ? html`<p class="notice ${blocked.tone}" id="run-state" role="status">${blocked.reason}</p>`
      : html`<p class="notice calm" id="run-state" role="status">${COPY.run.ready}</p>`;
  return html`${head}
${state}
<div class="run-grid">
<div class="run-col">${form(p, blocked)}</div>
<div class="run-col">${runsPanel(p.runs)}${historyPanel(p.history)}</div>
</div>`;
}
