import type { Mail } from "./email";
import type { Env } from "./env";

// Sending mail through Resend's HTTP API (https://resend.com/docs/api-reference). The key is sent
// in the Authorization header only: it is never logged, returned or put in a message. An answer
// from Resend is never shown or logged as it came (it can quote an address): a failure becomes one
// of four known outcomes.

export const DEFAULT_SITE_URL = "https://radar.ozkanyusuf.com";
const API = "https://api.resend.com";
const TIMEOUT_MS = 8000;
export const BATCH_MAX = 100; // Resend's limit for one batch call

export interface MailConfig {
  key: string;
  /** "Radar <address>". */
  from: string;
  replyTo: string | null;
  /** This Worker's own origin, for the confirm and leave links. */
  publicUrl: string;
  /** The static site's origin. */
  siteUrl: string;
}

export type MailFailure = "unauthorized" | "invalid" | "rate_limited" | "unavailable";
export type MailResult = { ok: true } | { ok: false; error: MailFailure };

const ADDRESS = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// An https origin without path, query or fragment, or null.
function origin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.origin === raw.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}

/** The site's origin: SITE_URL when it is a plain https origin, else the default. */
export const siteUrl = (env: Env): string => origin(env.SITE_URL) ?? DEFAULT_SITE_URL;

// null unless the key, a sender address and this Worker's public origin are all set: then nothing
// is sent, the subscribe form answers "not open yet" and the daily job does nothing.
export function mailConfig(env: Env): MailConfig | null {
  const key = env.RESEND_API_KEY?.trim();
  const address = env.MAIL_FROM?.trim().toLowerCase();
  const publicUrl = origin(env.PUBLIC_URL);
  if (!key || !address || !ADDRESS.test(address) || !publicUrl) return null;
  const reply = env.MAIL_REPLY_TO?.trim().toLowerCase();
  return {
    key,
    from: `Radar <${address}>`,
    replyTo: reply && ADDRESS.test(reply) ? reply : null,
    publicUrl,
    siteUrl: siteUrl(env),
  };
}

export const confirmLink = (cfg: MailConfig, token: string): string => `${cfg.publicUrl}/api/subscribe/confirm?token=${token}`;
export const leaveLink = (cfg: MailConfig, token: string): string => `${cfg.publicUrl}/api/unsubscribe?token=${token}`;

export interface Outgoing {
  to: string;
  mail: Mail;
  /** The reader's leave link: sent as List-Unsubscribe, so the mail client shows its own button. */
  leaveUrl?: string;
}

function payload(cfg: MailConfig, out: Outgoing): Record<string, unknown> {
  return {
    from: cfg.from,
    to: [out.to],
    subject: out.mail.subject,
    html: out.mail.html,
    text: out.mail.text,
    ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
    ...(out.leaveUrl
      ? { headers: { "List-Unsubscribe": `<${out.leaveUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
      : {}),
  };
}

function failureOf(status: number): MailFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}

async function post(cfg: MailConfig, path: string, body: unknown, idempotencyKey: string): Promise<MailResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    // The body is not needed and must not stay open.
    await res.body?.cancel();
    return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, error: failureOf(res.status) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** One mail. The idempotency key lets a repeated call within a day send nothing twice. */
export function sendOne(cfg: MailConfig, out: Outgoing, idempotencyKey: string): Promise<MailResult> {
  return post(cfg, "/emails", payload(cfg, out), idempotencyKey);
}

/** Up to BATCH_MAX mails in one call; Resend accepts or refuses them together. */
export function sendBatch(cfg: MailConfig, outs: readonly Outgoing[], idempotencyKey: string): Promise<MailResult> {
  return post(
    cfg,
    "/emails/batch",
    outs.map((o) => payload(cfg, o)),
    idempotencyKey,
  );
}
