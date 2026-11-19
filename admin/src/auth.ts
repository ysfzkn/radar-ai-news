import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

export type KeyResolver = Parameters<typeof jwtVerify>[1];
export interface Identity {
  email: string;
}

export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

const DEV_IDENTITY: Identity = { email: "dev@localhost" };

function deny(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// One remote key set per team domain; jose caches and refreshes the keys inside it.
const remoteKeySets = new Map<string, KeyResolver>();

function remoteKeys(teamDomain: string): KeyResolver {
  let set = remoteKeySets.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, set);
  }
  return set;
}

function allowedEmails(raw: string | undefined): Set<string> | null {
  const entries = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "");
  return entries.length > 0 ? new Set(entries) : null;
}

export async function authenticate(
  request: Request,
  env: Env,
  keys?: KeyResolver,
): Promise<Identity | Response> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN || undefined;
  const audience = env.ACCESS_AUD || undefined;

  if (teamDomain && audience) {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) return deny(401, "Unauthorized");

    let email: unknown;
    try {
      const { payload } = await jwtVerify(jwt, keys ?? remoteKeys(teamDomain), {
        algorithms: ["RS256"],
        issuer: `https://${teamDomain}`,
        audience,
      });
      email = payload.email;
    } catch {
      return deny(401, "Unauthorized");
    }
    if (typeof email !== "string" || email.trim() === "") return deny(401, "Unauthorized");

    const identity: Identity = { email: email.trim().toLowerCase() };
    const allowed = allowedEmails(env.ADMIN_EMAILS);
    if (allowed && !allowed.has(identity.email)) return deny(403, "Forbidden");
    return identity;
  }

  // Exactly one Access setting is a misconfiguration: never fall through to the bypass.
  if (!teamDomain && !audience) {
    if (env.DEV_NO_AUTH === "1" && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
      return DEV_IDENTITY;
    }
  }
  return deny(503, "Admin sign-in is not configured.");
}

export function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}
