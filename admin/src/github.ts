// Starting the daily workflow on GitHub Actions, and reading its recent runs.
//
// Only https://api.github.com is ever called, with a timeout and without following redirects.
// The token goes into the Authorization header and nowhere else: it is never logged, returned or
// put into a message. GitHub's answers are never shown as they came: a failure is one of a few
// known outcomes, and a run is rebuilt from validated fields (its link from the repository name
// and the run's numeric id, not from the address GitHub sent).
import { z } from "zod";
import type { Env } from "./env";

export const GITHUB_API = "https://api.github.com";
export const WORKFLOW_FILE = "daily.yml";
export const WORKFLOW_REF = "main";
export const TIMEOUT_MS = 8000;
export const RUNS_SHOWN = 8;
export const RUN_MODES = ["normal", "review_all", "collect_only"] as const;
export type RunMode = (typeof RUN_MODES)[number];
// The stories a run may be asked for: 1 to MAX_STORIES; none means the agent's default (8).
export const MAX_STORIES = 8;

export const isRunMode = (value: string): value is RunMode => (RUN_MODES as readonly string[]).includes(value);

export interface GithubConfig {
  repo: string; // "owner/name"
  token: string;
}

// owner: GitHub's user and organisation names; name: letters, digits, ".", "-", "_", never "." or "..".
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
// The token's shape only (fine-grained tokens are "github_pat_" and these characters); a value
// with anything else (a space, a line break) is treated as not set.
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

// Both settings, checked; null when either is missing or malformed.
export function githubConfig(env: Env): GithubConfig | null {
  const repo = (env.GITHUB_REPO ?? "").trim();
  const token = env.GITHUB_DISPATCH_TOKEN ?? "";
  if (!REPO.test(repo) || !TOKEN.test(token)) return null;
  return { repo, token };
}

export type GithubFailure = "unauthorized" | "not_found" | "invalid" | "rate_limited" | "unavailable";
export const GITHUB_FAILURES: readonly GithubFailure[] = ["unauthorized", "not_found", "invalid", "rate_limited", "unavailable"];

export type RunState = "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "other";
export type RunEvent = "schedule" | "workflow_dispatch" | "other";

export interface WorkflowRun {
  id: number;
  state: RunState;
  createdAt: string;
  // Set once the run has finished: how long it took, in ms.
  tookMs: number | null;
  event: RunEvent;
  actor: string | null;
  // From the run's title ("Daily · review_all · 3"), when it has that shape.
  mode: RunMode | null;
  stories: number | null;
  url: string;
}

export const isActive = (run: WorkflowRun): boolean => run.state === "queued" || run.state === "in_progress";

const QUEUED = new Set(["queued", "requested", "waiting", "pending"]);
const CONCLUSIONS = new Set(["success", "failure", "cancelled", "skipped", "timed_out"]);

function stateOf(status: string, conclusion: string | null): RunState {
  if (status === "in_progress") return "in_progress";
  if (QUEUED.has(status)) return "queued";
  if (status !== "completed") return "in_progress"; // an unknown live state still counts as running
  return conclusion && CONCLUSIONS.has(conclusion) ? (conclusion as RunState) : "other";
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const TITLE = /^Daily · (normal|review_all|collect_only)(?: · ([1-8]))?$/;
const isTime = (value: string): boolean => !Number.isNaN(Date.parse(value));

const runSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.string().max(40),
  conclusion: z.string().max(40).nullable().optional(),
  event: z.string().max(60),
  created_at: z.string().max(40).refine(isTime),
  run_started_at: z.string().max(40).nullable().optional(),
  updated_at: z.string().max(40).nullable().optional(),
  display_title: z.string().max(400).nullable().optional(),
  triggering_actor: z.object({ login: z.string().max(60) }).nullable().optional(),
  actor: z.object({ login: z.string().max(60) }).nullable().optional(),
});
const runsSchema = z.object({ workflow_runs: z.array(z.unknown()).max(100) });

function runOf(raw: unknown, repo: string): WorkflowRun | null {
  const parsed = runSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const state = stateOf(r.status, r.conclusion ?? null);
  const login = r.triggering_actor?.login ?? r.actor?.login ?? null;
  const title = TITLE.exec(r.display_title ?? "");
  let tookMs: number | null = null;
  const started = r.run_started_at ?? r.created_at;
  if (r.status === "completed" && r.updated_at && isTime(r.updated_at) && isTime(started)) {
    tookMs = Math.max(0, Date.parse(r.updated_at) - Date.parse(started));
  }
  return {
    id: r.id,
    state,
    createdAt: new Date(Date.parse(r.created_at)).toISOString(),
    tookMs,
    event: r.event === "schedule" || r.event === "workflow_dispatch" ? r.event : "other",
    actor: login && LOGIN.test(login) ? login : null,
    mode: title ? (title[1] as RunMode) : null,
    stories: title?.[2] ? Number(title[2]) : null,
    url: `https://github.com/${repo}/actions/runs/${r.id}`,
  };
}

function failureOf(res: Response): GithubFailure {
  if (res.status === 429) return "rate_limited";
  if (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))
    return "rate_limited";
  if (res.status === 401 || res.status === 403) return "unauthorized";
  if (res.status === 404) return "not_found";
  if (res.status === 422) return "invalid";
  return "unavailable";
}

function headers(cfg: GithubConfig): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${cfg.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "radar-admin",
  };
}

const workflowPath = (cfg: GithubConfig): string =>
  `${GITHUB_API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}`;

// One call to GitHub; a thrown error (network, timeout) is "unavailable". Only the error's name is
// logged, never the request or the token.
async function call(url: string, init: RequestInit): Promise<Response | GithubFailure> {
  if (!url.startsWith(`${GITHUB_API}/`)) return "unavailable";
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    console.error("github: request failed", e instanceof Error ? e.name : "error");
    return "unavailable";
  }
}

export type RunsResult = { ok: true; runs: WorkflowRun[] } | { ok: false; error: GithubFailure };

// The workflow's most recent runs, newest first. A run whose fields do not check out is left out.
export async function listRuns(cfg: GithubConfig, limit: number = RUNS_SHOWN): Promise<RunsResult> {
  const res = await call(`${workflowPath(cfg)}/runs?per_page=${limit}`, { method: "GET", headers: headers(cfg) });
  if (typeof res === "string") return { ok: false, error: res };
  if (res.status !== 200) {
    await res.body?.cancel();
    return { ok: false, error: failureOf(res) };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "unavailable" };
  }
  const parsed = runsSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "unavailable" };
  const runs = parsed.data.workflow_runs
    .map((r) => runOf(r, cfg.repo))
    .filter((r): r is WorkflowRun => r !== null)
    .slice(0, limit);
  return { ok: true, runs };
}

export interface RunInputs {
  mode: RunMode;
  stories: number | null; // 1..MAX_STORIES, or null for the default
}

export type DispatchResult = { ok: true } | { ok: false; error: GithubFailure };

// Starts the workflow on WORKFLOW_REF with the two inputs it declares, as strings.
export async function dispatchRun(cfg: GithubConfig, inputs: RunInputs): Promise<DispatchResult> {
  const body = JSON.stringify({
    ref: WORKFLOW_REF,
    inputs: { mode: inputs.mode, max_stories: inputs.stories === null ? "" : String(inputs.stories) },
  });
  const res = await call(`${workflowPath(cfg)}/dispatches`, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body,
  });
  if (typeof res === "string") return { ok: false, error: res };
  await res.body?.cancel();
  return res.status === 204 || res.status === 200 ? { ok: true } : { ok: false, error: failureOf(res) };
}
