// Starting the daily workflow from the admin screen (/admin/run). GitHub is never called for
// real: fetch is replaced by a fake that answers like the two endpoints used.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../src/copy";
import { githubConfig, listRuns } from "../src/github";
import { app } from "../src/index";
import { COOLDOWN_MS, cooldownLeft, recentDispatches, reserveDispatch } from "../src/runs";

type Json = Record<string, any>;

const ORIGIN = "http://localhost";
const REPO = "owner/radar-news";
// An invented value of the right shape; not a token anywhere.
const TOKEN = "github_pat_TESTONLY0000000000000000000000000000";
const configured = { ...env, DEV_NO_AUTH: "1", GITHUB_REPO: REPO, GITHUB_DISPATCH_TOKEN: TOKEN };
const unconfigured = { ...env, DEV_NO_AUTH: "1", GITHUB_REPO: undefined, GITHUB_DISPATCH_TOKEN: undefined };
const RUNS_URL = `https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/runs?per_page=8`;
const DISPATCH_URL = `https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/dispatches`;

const run = (over: Json = {}): Json => ({
  id: 101,
  name: "Daily",
  display_title: "Daily · normal",
  status: "completed",
  conclusion: "success",
  event: "schedule",
  created_at: "2026-11-20T04:16:02Z",
  run_started_at: "2026-11-20T04:16:10Z",
  updated_at: "2026-11-20T04:21:40Z",
  html_url: `https://github.com/${REPO}/actions/runs/101`,
  triggering_actor: { login: "ysfzkn" },
  ...over,
});
const runsResponse = (runs: unknown[]) =>
  new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

interface Fake {
  list?: () => Response | Promise<Response>;
  dispatch?: () => Response | Promise<Response>;
}
let calls: { url: string; init: RequestInit }[];
let fake: Fake;
beforeEach(() => {
  calls = [];
  fake = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      if (url === RUNS_URL) return fake.list ? fake.list() : runsResponse([run()]);
      if (url === DISPATCH_URL) return fake.dispatch ? fake.dispatch() : new Response(null, { status: 204 });
      throw new Error(`unexpected request to ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const get = (path: string, e: Json = configured) => app.fetch(new Request(`${ORIGIN}${path}`), e);
const post = (fields: Record<string, string>, e: Json = configured, origin: string | null = ORIGIN) => {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return app.fetch(new Request(`${ORIGIN}/admin/run`, { method: "POST", headers, body: new URLSearchParams(fields) }), e);
};
const dispatches = () => calls.filter((c) => c.url === DISPATCH_URL);
const rows = () => recentDispatches(env.DB, 50);
const notice = (body: string): string => body.match(/<p class="notice[^"]*"[^>]*>[^<]*<\/p>/)?.[0] ?? "";
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("settings", () => {
  it.each([
    [{}, false],
    [{ GITHUB_REPO: REPO }, false],
    [{ GITHUB_DISPATCH_TOKEN: TOKEN }, false],
    [{ GITHUB_REPO: REPO, GITHUB_DISPATCH_TOKEN: TOKEN }, true],
    [{ GITHUB_REPO: ` ${REPO} `, GITHUB_DISPATCH_TOKEN: TOKEN }, true],
    [{ GITHUB_REPO: "owner/..", GITHUB_DISPATCH_TOKEN: TOKEN }, false],
    [{ GITHUB_REPO: "owner/x/y", GITHUB_DISPATCH_TOKEN: TOKEN }, false],
    [{ GITHUB_REPO: "https://evil.example/owner/x", GITHUB_DISPATCH_TOKEN: TOKEN }, false],
    [{ GITHUB_REPO: "owner", GITHUB_DISPATCH_TOKEN: TOKEN }, false],
    [{ GITHUB_REPO: REPO, GITHUB_DISPATCH_TOKEN: "short" }, false],
    [{ GITHUB_REPO: REPO, GITHUB_DISPATCH_TOKEN: `${TOKEN}\r\nX-Evil: 1` }, false],
  ])("%o is configured: %s", (vars, ok) => {
    expect(githubConfig({ ...env, ...vars } as never) !== null).toBe(ok);
  });
});

describe("GET /admin/run", () => {
  it("without the settings says running from here is not set up, offers no form and calls nobody", async () => {
    for (const e of [unconfigured, { ...unconfigured, GITHUB_REPO: REPO }, { ...unconfigured, GITHUB_DISPATCH_TOKEN: TOKEN }]) {
      const res = await get("/admin/run", e);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(decode(body)).toContain(COPY.run.notSetUpTitle);
      expect(body).not.toContain('action="/admin/run"');
      expect(body).not.toContain(TOKEN);
    }
    expect(calls).toEqual([]);
  });

  it("reads the recent runs with the token in the header only, a timeout and no redirect", async () => {
    const res = await get("/admin/run");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(RUNS_URL);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(headers.get("user-agent")).toBe("radar-admin");
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("shows each run's state, time, trigger and a link built from the repository and the run id", async () => {
    fake.list = () =>
      runsResponse([
        run({ id: 303, status: "completed", conclusion: "failure", event: "workflow_dispatch", display_title: "Daily · review_all · 3" }),
        run({ id: 202, conclusion: "skipped", display_title: "Daily · collect_only" }),
        run({ id: 101 }),
      ]);
    const body = decode(await (await get("/admin/run")).text());
    const list = body.slice(body.indexOf('<ol class="runs">'), body.indexOf("</ol>"));
    expect(list).toContain(COPY.run.states.failure);
    expect(list).toContain(COPY.run.states.skipped);
    expect(list).toContain(COPY.run.states.success);
    expect(list).toContain(COPY.run.modes.review_all.label);
    expect(list).toContain(COPY.run.stories(3));
    expect(list).toContain(COPY.run.modes.collect_only.label);
    expect(list).toContain(COPY.run.events.workflow_dispatch);
    expect(list).toContain(COPY.run.events.schedule);
    expect(list).toContain("20 Kas 07:16");
    expect(list).toContain("ysfzkn");
    expect(list).toContain(COPY.run.took("5 dk"));
    for (const id of [101, 202, 303])
      expect(list).toContain(`href="https://github.com/${REPO}/actions/runs/${id}" target="_blank" rel="noopener noreferrer"`);
    expect(body).toContain(COPY.run.skippedHint);
    expect(list.indexOf("/runs/303")).toBeLessThan(list.indexOf("/runs/101"));
  });

  it("never trusts GitHub's own fields: links, titles and names are rebuilt or dropped", async () => {
    fake.list = () =>
      runsResponse([
        run({
          id: 7,
          html_url: "javascript:alert(1)",
          display_title: "<img src=x onerror=alert(1)>",
          triggering_actor: { login: "<script>" },
          event: "<b>push</b>",
        }),
        run({ id: "8" }), // not a number: left out
        run({ id: 9, created_at: "yesterday" }), // not a time: left out
        "not a run",
      ]);
    const body = await (await get("/admin/run")).text();
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<b>push");
    expect(body).not.toContain("onerror");
    expect(body).toContain(`/actions/runs/7"`);
    expect(body).not.toContain("/actions/runs/8");
    expect(body).not.toContain("/actions/runs/9");
    expect(decode(body)).toContain(COPY.run.events.other);
  });

  it("says when a run is queued or in progress and offers no start button that works", async () => {
    for (const status of ["queued", "in_progress", "waiting"]) {
      fake.list = () => runsResponse([run({ status, conclusion: null, run_started_at: "2026-11-21T08:00:00Z" })]);
      const body = decode(await (await get("/admin/run")).text());
      const state = status === "in_progress" ? COPY.run.states.in_progress : COPY.run.states.queued;
      expect(notice(body)).toContain(COPY.run.busy(state, "21 Kas 11:00").split("(")[0]!);
      expect(body).toMatch(/<button type="submit" class="primary" id="run-button" disabled/);
    }
  });

  it("an idle repository offers the form with the three modes and the story counts", async () => {
    const body = decode(await (await get("/admin/run")).text());
    expect(body).toContain('<form method="post" action="/admin/run"');
    for (const mode of ["normal", "review_all", "collect_only"]) {
      expect(body).toContain(`name="mode" value="${mode}"`);
      expect(body).toContain(COPY.run.modes[mode as "normal"].label);
    }
    expect(body).toMatch(/name="mode" value="normal"[^>]* checked/);
    expect(body).toContain('<option value="" selected>Varsayılan (8)</option>');
    for (let n = 1; n <= 8; n++) expect(body).toContain(`<option value="${n}">${n}</option>`);
    expect(body).not.toContain('<option value="9"');
    expect(body).toMatch(/<button type="submit" class="primary" id="run-button">/);
    expect(body).toContain(COPY.run.ready);
  });

  it("when GitHub cannot be read says so, keeps the history and offers no working button", async () => {
    await reserveDispatch(env.DB, "dev@localhost", { mode: "normal", stories: null }, new Date(Date.now() - 3600_000));
    fake.list = () => new Response("{}", { status: 500 });
    const body = decode(await (await get("/admin/run")).text());
    expect(body).toContain(COPY.run.runsUnavailable(COPY.run.failures.unavailable));
    expect(body).toContain(COPY.run.unknownState);
    expect(body).toMatch(/id="run-button" disabled/);
    expect(body).toContain('<ol class="history">');
  });

  it("changes nothing in the database", async () => {
    await get("/admin/run");
    await get("/admin/run?done=dispatched");
    expect(await rows()).toEqual([]);
  });

  it("is the Çalıştır page of the header, marked as the current page", async () => {
    const body = await (await get("/admin/run")).text();
    expect(body).toMatch(/<a class="top-link run-link" href="\/admin\/run" aria-current="page">/);
    const queue = await (await get("/admin")).text();
    expect(queue).toMatch(/<a class="top-link run-link" href="\/admin\/run">/);
  });

  it("confirms a start once, from the done hint", async () => {
    const body = decode(await (await get("/admin/run?done=dispatched")).text());
    expect(notice(body)).toContain(COPY.done.dispatched);
  });
});

describe("POST /admin/run", () => {
  it("starts the workflow on main with the chosen inputs, records it and redirects", async () => {
    const res = await post({ mode: "review_all", stories: "3" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/run?done=dispatched");
    const [call] = dispatches();
    expect(call).toBeDefined();
    expect(call!.init.method).toBe("POST");
    expect(call!.init.redirect).toBe("manual");
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(call!.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(call!.init.body))).toEqual({ ref: "main", inputs: { mode: "review_all", max_stories: "3" } });
    const [row] = await rows();
    expect(row).toMatchObject({ actor: "dev@localhost", mode: "review_all", max_stories: 3, outcome: "dispatched", failure: null });
    // Busy check first, then the start: nothing else is called.
    expect(calls.map((c) => c.url)).toEqual([RUNS_URL, DISPATCH_URL]);
  });

  it("sends an empty story count for the default, and none for collect only", async () => {
    await post({ mode: "normal", stories: "" });
    await env.DB.prepare("DELETE FROM run_dispatches").run();
    await post({ mode: "collect_only", stories: "5" });
    const bodies = dispatches().map((c) => JSON.parse(String(c.init.body)).inputs);
    expect(bodies).toEqual([
      { mode: "normal", max_stories: "" },
      { mode: "collect_only", max_stories: "" },
    ]);
    const [row] = await rows();
    expect(row).toMatchObject({ mode: "collect_only", max_stories: null });
  });

  it.each([
    [{ mode: "everything", stories: "" }],
    [{ mode: "normal", stories: "9" }],
    [{ mode: "normal", stories: "0" }],
    [{ mode: "normal", stories: "3; rm -rf /" }],
    [{ mode: "normal", stories: "03" }],
    [{ stories: "2" }],
    [{ mode: "Normal", stories: "" }],
  ])("refuses %o without starting anything or writing a row", async (fields) => {
    const res = await post(fields as Record<string, string>);
    expect(res.status).toBe(400);
    expect(notice(decode(await res.text()))).toContain(COPY.run.invalid);
    expect(dispatches()).toEqual([]); // the page shown again may read the run list, nothing more
    expect(await rows()).toEqual([]);
  });

  it("without the settings refuses with 503, calls nobody and writes nothing", async () => {
    const res = await post({ mode: "normal", stories: "" }, unconfigured);
    expect(res.status).toBe(503);
    expect(decode(await res.text())).toContain(COPY.run.notSetUpTitle);
    expect(calls).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses a request from another origin before anything happens", async () => {
    for (const origin of [null, "https://evil.example", "null"]) {
      const res = await post({ mode: "normal", stories: "" }, configured, origin);
      expect(res.status).toBe(403);
    }
    expect(calls).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses while a run is queued or in progress, and says why", async () => {
    fake.list = () => runsResponse([run({ status: "in_progress", conclusion: null })]);
    const res = await post({ mode: "normal", stories: "" });
    expect(res.status).toBe(409);
    expect(notice(decode(await res.text()))).toContain(COPY.run.busy(COPY.run.states.in_progress, "").split("(")[0]!);
    expect(dispatches()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses when GitHub's run list cannot be read, since a running job cannot be ruled out", async () => {
    fake.list = () => {
      throw new TypeError("network down");
    };
    const res = await post({ mode: "normal", stories: "" });
    expect(res.status).toBe(502);
    expect(notice(decode(await res.text()))).toContain(COPY.run.unknownState);
    expect(dispatches()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses within the cool-down after a start from here, and allows one after it", async () => {
    expect((await post({ mode: "normal", stories: "" })).status).toBe(303);
    const again = await post({ mode: "normal", stories: "" });
    expect(again.status).toBe(409);
    expect(notice(decode(await again.text()))).toContain(COPY.run.cooldown("5 dk").split("5 dk")[0]!);
    expect(dispatches()).toHaveLength(1);
    expect(await rows()).toHaveLength(1);

    // Move the first start back past the cool-down.
    const past = new Date(Date.now() - COOLDOWN_MS - 1000).toISOString();
    await env.DB.prepare("UPDATE run_dispatches SET requested_at = ?").bind(past).run();
    expect((await post({ mode: "normal", stories: "" })).status).toBe(303);
    expect(dispatches()).toHaveLength(2);
  });

  it("a failed start does not hold the next one back", async () => {
    fake.dispatch = () => new Response(null, { status: 500 });
    expect((await post({ mode: "normal", stories: "" })).status).toBe(502);
    fake.dispatch = undefined;
    expect((await post({ mode: "normal", stories: "" })).status).toBe(303);
    expect((await rows()).map((r) => r.outcome)).toEqual(["dispatched", "failed"]);
  });

  it.each([
    [() => new Response('{"message":"Bad credentials SENTINEL"}', { status: 401 }), "unauthorized"],
    [() => new Response('{"message":"Resource not accessible SENTINEL"}', { status: 403 }), "unauthorized"],
    [() => new Response("SENTINEL", { status: 403, headers: { "x-ratelimit-remaining": "0" } }), "rate_limited"],
    [() => new Response("SENTINEL", { status: 429 }), "rate_limited"],
    [() => new Response('{"message":"Not Found SENTINEL"}', { status: 404 }), "not_found"],
    [() => new Response('{"message":"Unexpected inputs provided: SENTINEL"}', { status: 422 }), "invalid"],
    [() => new Response("SENTINEL", { status: 503 }), "unavailable"],
    [() => new Response(null, { status: 302, headers: { location: "https://evil.example/SENTINEL" } }), "unavailable"],
    [
      () => {
        throw new DOMException("The operation timed out SENTINEL", "TimeoutError");
      },
      "unavailable",
    ],
  ] as const)("a failed start (%#) is a clear notice and a row marked failed: %s", async (answer, failure) => {
    fake.dispatch = answer;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ mode: "normal", stories: "2" });
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.text();
    expect(notice(decode(body))).toContain(COPY.run.dispatchFailed(COPY.run.failures[failure]));
    expect(body).not.toContain("SENTINEL");
    expect(body).not.toContain(TOKEN);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "failed", failure, mode: "normal", max_stories: 2 });
    for (const args of errors.mock.calls) expect(JSON.stringify(args)).not.toMatch(/SENTINEL|github_pat/);
    errors.mockRestore();
  });

  it("calls api.github.com only", async () => {
    await get("/admin/run");
    await post({ mode: "normal", stories: "" });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.url.startsWith("https://api.github.com/")).toBe(true);
  });
});

describe("the history of starts from here", () => {
  it("lists who started what and how it went, newest first, escaped", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO run_dispatches (actor, requested_at, mode, max_stories, outcome, failure) VALUES (?, ?, 'review_all', 3, 'dispatched', NULL)",
      ).bind("<script>x</script>@example.com", new Date(now - 7200_000).toISOString()),
      env.DB.prepare(
        "INSERT INTO run_dispatches (actor, requested_at, mode, max_stories, outcome, failure) VALUES (?, ?, 'collect_only', NULL, 'failed', 'rate_limited')",
      ).bind("owner@example.com", new Date(now - 3600_000).toISOString()),
      env.DB.prepare(
        "INSERT INTO run_dispatches (actor, requested_at, mode, max_stories, outcome, failure) VALUES (?, ?, 'normal', NULL, 'pending', NULL)",
      ).bind("owner@example.com", new Date(now - 1800_000).toISOString()),
    ]);
    const body = await (await get("/admin/run", unconfigured)).text();
    const history = decode(body.slice(body.indexOf('<ol class="history">'), body.indexOf("</ol>", body.indexOf('<ol class="history">'))));
    expect(body).not.toContain("<script>x</script>");
    expect(body).toContain("&lt;script&gt;x&lt;/script&gt;@example.com");
    expect(history).toContain(COPY.run.outcomes.dispatched);
    expect(history).toContain(COPY.run.outcomes.failed);
    expect(history).toContain(COPY.run.failures.rate_limited);
    expect(history).toContain(COPY.run.outcomes.pending);
    expect(history).toContain(COPY.run.stories(3));
    expect(history.indexOf(COPY.run.modes.normal.label)).toBeLessThan(history.indexOf(COPY.run.modes.review_all.label));
  });

  it("says when there is none", async () => {
    const body = decode(await (await get("/admin/run", unconfigured)).text());
    expect(body).toContain(COPY.run.historyEmpty);
  });
});

describe("the cool-down record", () => {
  it("two reservations at once: only one gets through", async () => {
    const now = new Date();
    const inputs = { mode: "normal" as const, stories: null };
    const [a, b] = await Promise.all([
      reserveDispatch(env.DB, "a@example.com", inputs, now),
      reserveDispatch(env.DB, "b@example.com", inputs, now),
    ]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    expect(await cooldownLeft(env.DB, now)).toBe(COOLDOWN_MS);
    expect(await cooldownLeft(env.DB, new Date(now.getTime() + COOLDOWN_MS))).toBe(0);
  });

  it("the database refuses an unknown mode or count", async () => {
    await expect(
      env.DB.prepare("INSERT INTO run_dispatches (actor, requested_at, mode, outcome) VALUES ('a', 'b', 'all', 'pending')").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO run_dispatches (actor, requested_at, mode, max_stories, outcome) VALUES ('a', 'b', 'normal', 9, 'pending')",
      ).run(),
    ).rejects.toThrow();
  });
});

describe("listRuns", () => {
  it("maps GitHub's states to a few known ones", async () => {
    const states: [Json, string][] = [
      [{ status: "queued", conclusion: null }, "queued"],
      [{ status: "requested", conclusion: null }, "queued"],
      [{ status: "in_progress", conclusion: null }, "in_progress"],
      [{ status: "something_new", conclusion: null }, "in_progress"],
      [{ status: "completed", conclusion: "timed_out" }, "timed_out"],
      [{ status: "completed", conclusion: "cancelled" }, "cancelled"],
      [{ status: "completed", conclusion: "neutral" }, "other"],
    ];
    fake.list = () => runsResponse(states.map(([s], i) => run({ id: i + 1, ...s })));
    const result = await listRuns(githubConfig(configured as never)!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.runs.map((r) => r.state)).toEqual(states.map(([, s]) => s));
  });

  it("a body that is not GitHub's shape is unavailable", async () => {
    fake.list = () => new Response("not json", { status: 200 });
    expect(await listRuns(githubConfig(configured as never)!)).toEqual({ ok: false, error: "unavailable" });
    fake.list = () => new Response('{"workflow_runs": "x"}', { status: 200 });
    expect(await listRuns(githubConfig(configured as never)!)).toEqual({ ok: false, error: "unavailable" });
  });
});
