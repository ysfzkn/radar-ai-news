import { env } from "cloudflare:workers";
import { SignJWT, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticate, sameOrigin, type Identity } from "../src/auth";
import type { Env } from "../src/env";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "test-aud";
const URL_ = "https://radar-admin.example.workers.dev/";

let good: CryptoKeyPair;
let other: CryptoKeyPair;

beforeAll(async () => {
  good = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
});

const accessEnv = (extra: Partial<Env> = {}): Env => ({
  ...env,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ...extra,
});

interface TokenOptions {
  key?: CryptoKey;
  alg?: string;
  aud?: string;
  iss?: string;
  exp?: string | number;
  claims?: Record<string, unknown>;
}

async function token(o: TokenOptions = {}): Promise<string> {
  const claims = "claims" in o ? o.claims! : { email: "Owner@Example.com" };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: o.alg ?? "RS256" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(o.key ?? good.privateKey);
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function algNone(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    email: "owner@example.com",
    iss: `https://${TEAM}`,
    aud: AUD,
    exp: now + 300,
  })}.`;
}

async function hs256(): Promise<string> {
  // Sign with the public key's SPKI bytes as an HMAC secret: the classic confusion attack.
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", good.publicKey)) as ArrayBuffer);
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime("5m")
    .sign(spki);
}

const req = (jwt?: string, url = URL_) =>
  new Request(url, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });

const keys = () => good.publicKey;

describe("authenticate: Cloudflare Access token", () => {
  it("accepts a valid token and returns the lower-cased email", async () => {
    const res = await authenticate(req(await token()), accessEnv(), keys());
    expect(res).toEqual({ email: "owner@example.com" });
  });

  it.each([
    "missing header",
    "expired",
    "wrong audience",
    "wrong issuer",
    "signed by another key",
    "alg none",
    "HS256",
    "no email claim",
  ])("answers 401 for %s", async (name) => {
    let request: Request;
    switch (name) {
      case "missing header":
        request = req();
        break;
      case "expired":
        request = req(await token({ exp: Math.floor(Date.now() / 1000) - 600 }));
        break;
      case "wrong audience":
        request = req(await token({ aud: "someone-else" }));
        break;
      case "wrong issuer":
        request = req(await token({ iss: "https://evil.cloudflareaccess.com" }));
        break;
      case "signed by another key":
        request = req(await token({ key: other.privateKey }));
        break;
      case "alg none":
        request = req(algNone());
        break;
      case "HS256":
        request = req(await hs256());
        break;
      default:
        request = req(await token({ claims: {} }));
    }
    const res = await authenticate(request, accessEnv(), keys());
    expect(res).toBeInstanceOf(Response);
    const r = res as Response;
    expect(r.status).toBe(401);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.text()).toBe("Unauthorized");
  });

  it("answers 401 for a garbage token", async () => {
    const res = (await authenticate(req("not-a-jwt"), accessEnv(), keys())) as Response;
    expect(res.status).toBe(401);
  });

  it("answers 403 when ADMIN_EMAILS is set and the email is not listed", async () => {
    const res = (await authenticate(
      req(await token()),
      accessEnv({ ADMIN_EMAILS: "someone@example.com, other@example.com" }),
      keys(),
    )) as Response;
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("Forbidden");
  });

  it("accepts a listed email regardless of case, spaces and empty entries", async () => {
    const res = await authenticate(
      req(await token()),
      accessEnv({ ADMIN_EMAILS: " , OWNER@example.COM ,," }),
      keys(),
    );
    expect(res).toEqual({ email: "owner@example.com" } satisfies Identity);
  });

  it("treats an ADMIN_EMAILS with no entries as not set", async () => {
    const res = await authenticate(req(await token()), accessEnv({ ADMIN_EMAILS: " , " }), keys());
    expect(res).toEqual({ email: "owner@example.com" });
  });
});

describe("authenticate: configuration", () => {
  it("answers 503 when nothing is configured", async () => {
    const res = (await authenticate(req(), { ...env }, keys())) as Response;
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("Admin sign-in is not configured.");
  });

  it("answers 503 for empty Access settings", async () => {
    const res = (await authenticate(
      req(),
      { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
      keys(),
    )) as Response;
    expect(res.status).toBe(503);
  });

  it.each([
    { ACCESS_TEAM_DOMAIN: TEAM },
    { ACCESS_AUD: AUD },
  ])("answers 503 when only one Access setting is set, even with the dev bypass: %o", async (half) => {
    const res = (await authenticate(
      req(undefined, "http://localhost:8787/"),
      { ...env, ...half, DEV_NO_AUTH: "1" },
      keys(),
    )) as Response;
    expect(res.status).toBe(503);
  });

  it.each(["http://localhost:8787/", "http://127.0.0.1:8787/", "http://[::1]:8787/"])(
    "dev bypass works on %s with DEV_NO_AUTH=1",
    async (url) => {
      const res = await authenticate(req(undefined, url), { ...env, DEV_NO_AUTH: "1" });
      expect(res).toEqual({ email: "dev@localhost" });
    },
  );

  it("dev bypass is refused on https://radar-admin.example.workers.dev even with DEV_NO_AUTH=1", async () => {
    const res = (await authenticate(req(), { ...env, DEV_NO_AUTH: "1" })) as Response;
    expect(res.status).toBe(503);
  });

  it("dev bypass needs DEV_NO_AUTH to be exactly 1", async () => {
    const res = (await authenticate(req(undefined, "http://localhost:8787/"), {
      ...env,
      DEV_NO_AUTH: "true",
    })) as Response;
    expect(res.status).toBe(503);
  });

  it("ignores DEV_NO_AUTH when the Access settings are present", async () => {
    const res = (await authenticate(
      req(undefined, "http://localhost:8787/"),
      accessEnv({ DEV_NO_AUTH: "1" }),
      keys(),
    )) as Response;
    expect(res.status).toBe(401);
  });
});

describe("sameOrigin", () => {
  const post = (origin?: string) =>
    new Request("https://radar-admin.example.workers.dev/x", {
      method: "POST",
      headers: origin === undefined ? {} : { Origin: origin },
    });

  it("lets GET and HEAD pass", () => {
    expect(sameOrigin(new Request("https://a.example/"))).toBe(true);
    expect(sameOrigin(new Request("https://a.example/", { method: "HEAD" }))).toBe(true);
  });

  it("lets POST pass only with an Origin equal to the request origin", () => {
    expect(sameOrigin(post("https://radar-admin.example.workers.dev"))).toBe(true);
    expect(sameOrigin(post())).toBe(false);
    expect(sameOrigin(post("https://evil.example"))).toBe(false);
    expect(sameOrigin(post("null"))).toBe(false);
    expect(sameOrigin(post("http://radar-admin.example.workers.dev"))).toBe(false);
  });
});
