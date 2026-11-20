import type { Context } from "hono";
import type { Env } from "./env";

function hookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

// Asks the host to rebuild the static site. Silent by design: the hook URL is a secret, so it is
// never logged or returned, and a failing call is swallowed.
export function notifySite(env: Env, wait: (p: Promise<unknown>) => void): void {
  const url = hookUrl(env.SITE_DEPLOY_HOOK);
  if (!url) return;
  wait(fetch(url, { method: "POST" }).then(() => undefined, () => undefined));
}

// A waiter for notifySite: hands the promise to the execution context so it outlives the response.
// Without a context (tests call app.fetch directly) the promise just runs; it never rejects.
export function waiter(c: Context): (p: Promise<unknown>) => void {
  return (p) => {
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      void p;
    }
  };
}
