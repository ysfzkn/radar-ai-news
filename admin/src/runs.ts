// The record of workflow runs started from the admin screen (table run_dispatches, 0004).
import type { GithubFailure, RunInputs, RunMode } from "./github";

// After a start from here, the next one waits this long: GitHub can take a few seconds to list a
// new run as queued, and a double tap must not start two.
export const COOLDOWN_MS = 5 * 60 * 1000;
export const HISTORY_SHOWN = 10;

export type DispatchOutcome = "pending" | "dispatched" | "failed";

export interface Dispatch {
  id: number;
  actor: string;
  requested_at: string;
  mode: RunMode;
  max_stories: number | null;
  outcome: DispatchOutcome;
  failure: GithubFailure | null;
}

// Writes a 'pending' row unless a start that did not fail was asked for within COOLDOWN_MS; one
// statement, so two requests at once cannot both get through. Returns the row's id, or null when
// the cool-down refused it.
export async function reserveDispatch(db: D1Database, actor: string, inputs: RunInputs, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - COOLDOWN_MS).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO run_dispatches (actor, requested_at, mode, max_stories, outcome)
       SELECT ?, ?, ?, ?, 'pending'
       WHERE NOT EXISTS (SELECT 1 FROM run_dispatches WHERE outcome <> 'failed' AND requested_at > ?)`,
    )
    .bind(actor, now.toISOString(), inputs.mode, inputs.stories, since)
    .run();
  return result.meta.changes === 1 ? Number(result.meta.last_row_id) : null;
}

// GitHub's answer to a reserved start.
export async function finishDispatch(
  db: D1Database,
  id: number,
  result: { ok: true } | { ok: false; error: GithubFailure },
  now: Date,
): Promise<void> {
  await db
    .prepare("UPDATE run_dispatches SET outcome = ?, failure = ?, finished_at = ? WHERE id = ? AND outcome = 'pending'")
    .bind(result.ok ? "dispatched" : "failed", result.ok ? null : result.error, now.toISOString(), id)
    .run();
}

// How long until the cool-down of the last start that did not fail is over; 0 when it is.
export async function cooldownLeft(db: D1Database, now: Date): Promise<number> {
  const row = await db
    .prepare("SELECT requested_at FROM run_dispatches WHERE outcome <> 'failed' ORDER BY requested_at DESC, id DESC LIMIT 1")
    .first<{ requested_at: string }>();
  if (!row) return 0;
  const left = Date.parse(row.requested_at) + COOLDOWN_MS - now.getTime();
  return Number.isFinite(left) && left > 0 ? left : 0;
}

export async function recentDispatches(db: D1Database, limit: number = HISTORY_SHOWN): Promise<Dispatch[]> {
  const { results } = await db
    .prepare(
      "SELECT id, actor, requested_at, mode, max_stories, outcome, failure FROM run_dispatches ORDER BY requested_at DESC, id DESC LIMIT ?",
    )
    .bind(limit)
    .all<Dispatch>();
  return results;
}
