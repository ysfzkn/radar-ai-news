import type { Lang } from "./schema";

// The newsletter's readers: one row per address (see migrations/0005_subscribers.sql).

export const CONFIRM_GAP_MS = 10 * 60 * 1000; // between two confirmation mails to one address
export const CONFIRM_SENDS_MAX = 3; // confirmation mails one pending address ever gets
export const CONFIRM_PER_HOUR = 20; // confirmation mails to all addresses together
export const CONFIRM_PER_DAY = 60;
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const EMAIL_MAX = 254;
const LOCAL_MAX = 64;
// One "@", a local part without spaces, quotes, brackets or separators, and a dotted host of
// letters, digits and hyphens. Stricter than the standard on purpose: such an address also goes
// into a mail header.
const EMAIL = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

// The address trimmed and lower-cased, or null when it is not one.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL.test(email)) return null;
  if (email.indexOf("@") > LOCAL_MAX || email.includes("..")) return null;
  return email;
}

export const isToken = (raw: unknown): raw is string => typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw);

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Subscriber {
  id: number;
  email: string;
  lang: Lang;
  status: "pending" | "confirmed";
  token: string;
}

interface Row extends Subscriber {
  confirm_sent_at: string | null;
  confirm_sends: number;
}

// What a subscribe request leads to:
//   send  - a confirmation mail is due to this reader;
//   quiet - nothing is sent and the form answers as if one was (already on the list, or this
//           address has had its mails), so the answer never tells whether an address is known;
//   later - too many confirmation mails went out lately, to anyone; the form says to try later.
export type Request = { kind: "send"; subscriber: Subscriber } | { kind: "quiet" } | { kind: "later" };

async function confirmsSince(db: D1Database, since: Date): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM subscribers WHERE confirm_sent_at >= ?")
    .bind(since.toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Finds or writes the pending row for an address. Nothing is counted as sent here: the caller
// sends the mail and then calls markConfirmSent, so a failed send can be tried again.
export async function requestSubscription(db: D1Database, email: string, lang: Lang, now: Date): Promise<Request> {
  const existing = await db
    .prepare("SELECT id, email, lang, status, token, confirm_sent_at, confirm_sends FROM subscribers WHERE email = ?")
    .bind(email)
    .first<Row>();
  if (existing?.status === "confirmed") return { kind: "quiet" };
  if (existing) {
    if (existing.confirm_sends >= CONFIRM_SENDS_MAX) return { kind: "quiet" };
    if (existing.confirm_sent_at && now.getTime() - Date.parse(existing.confirm_sent_at) < CONFIRM_GAP_MS) {
      return { kind: "quiet" };
    }
  }
  if ((await confirmsSince(db, new Date(now.getTime() - HOUR_MS))) >= CONFIRM_PER_HOUR) return { kind: "later" };
  if ((await confirmsSince(db, new Date(now.getTime() - 24 * HOUR_MS))) >= CONFIRM_PER_DAY) return { kind: "later" };

  if (existing) {
    // The language of the latest request wins while the address is not confirmed.
    await db.prepare("UPDATE subscribers SET lang = ? WHERE id = ? AND status = 'pending'").bind(lang, existing.id).run();
    return { kind: "send", subscriber: { id: existing.id, email, lang, status: "pending", token: existing.token } };
  }
  const token = newToken();
  // Two requests for one new address at once: the second finds the row of the first.
  await db
    .prepare(
      "INSERT INTO subscribers (email, lang, status, token, created_at) VALUES (?, ?, 'pending', ?, ?) ON CONFLICT (email) DO NOTHING",
    )
    .bind(email, lang, token, now.toISOString())
    .run();
  const row = await db
    .prepare("SELECT id, email, lang, status, token FROM subscribers WHERE email = ?")
    .bind(email)
    .first<Subscriber>();
  if (!row || row.status !== "pending") return { kind: "quiet" };
  return { kind: "send", subscriber: row };
}

export async function markConfirmSent(db: D1Database, id: number, now: Date): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET confirm_sent_at = ?, confirm_sends = confirm_sends + 1 WHERE id = ?")
    .bind(now.toISOString(), id)
    .run();
}

export async function findByToken(db: D1Database, token: string): Promise<Subscriber | null> {
  if (!isToken(token)) return null;
  return db.prepare("SELECT id, email, lang, status, token FROM subscribers WHERE token = ?").bind(token).first<Subscriber>();
}

// Confirms the reader behind a token; null when no reader has it. Confirming twice changes nothing.
export async function confirmSubscriber(db: D1Database, token: string, now: Date): Promise<Subscriber | null> {
  const found = await findByToken(db, token);
  if (!found) return null;
  await db
    .prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'pending'")
    .bind(now.toISOString(), found.id)
    .run();
  return { ...found, status: "confirmed" };
}

// Leaving deletes the row: the address is gone, and the same link then finds nothing.
export async function removeSubscriber(db: D1Database, token: string): Promise<Subscriber | null> {
  const found = await findByToken(db, token);
  if (!found) return null;
  await db.prepare("DELETE FROM subscribers WHERE id = ?").bind(found.id).run();
  return found;
}

// Deletes addresses that were never confirmed within 7 days.
export async function purgePending(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS).toISOString();
  await db.prepare("DELETE FROM subscribers WHERE status = 'pending' AND created_at <= ?").bind(cutoff).run();
}

// Confirmed readers who have not been mailed the edition of `day` yet, oldest first.
export async function dueSubscribers(db: D1Database, day: string, limit: number): Promise<Subscriber[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, lang, status, token FROM subscribers
        WHERE status = 'confirmed' AND (mailed_day IS NULL OR mailed_day < ?)
        ORDER BY id LIMIT ?`,
    )
    .bind(day, limit)
    .all<Subscriber>();
  return results;
}

// D1 allows 100 bound parameters per statement.
const ID_CHUNK = 90;

export async function markMailed(db: D1Database, ids: readonly number[], day: string): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    statements.push(
      db.prepare(`UPDATE subscribers SET mailed_day = ? WHERE id IN (${chunk.map(() => "?").join(", ")})`).bind(day, ...chunk),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

// ---------------------------------------------------------------------------
// The admin's readers page
// ---------------------------------------------------------------------------

export const SUBSCRIBERS_PAGE = 100;

export interface SubscriberRow {
  id: number;
  email: string;
  lang: Lang;
  status: "pending" | "confirmed";
  created_at: string;
  confirmed_at: string | null;
  mailed_day: string | null;
}

// Newest first. The token is never read here: the page has no use for it.
export async function listSubscribers(db: D1Database, limit: number, offset: number): Promise<SubscriberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, lang, status, created_at, confirmed_at, mailed_day FROM subscribers
        ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<SubscriberRow>();
  return results;
}

export interface SubscriberTotals {
  confirmed: number;
  pending: number;
  /** Confirmed readers by language. */
  tr: number;
  en: number;
}

export async function subscriberTotals(db: D1Database): Promise<SubscriberTotals> {
  const { results } = await db
    .prepare("SELECT status, lang, COUNT(*) AS n FROM subscribers GROUP BY status, lang")
    .all<{ status: string; lang: string; n: number }>();
  const totals: SubscriberTotals = { confirmed: 0, pending: 0, tr: 0, en: 0 };
  for (const r of results) {
    if (r.status === "pending") totals.pending += r.n;
    if (r.status !== "confirmed") continue;
    totals.confirmed += r.n;
    if (r.lang === "tr") totals.tr += r.n;
    if (r.lang === "en") totals.en += r.n;
  }
  return totals;
}

export interface LastMailing {
  /** The Istanbul day of the latest edition mailed to anyone. */
  day: string;
  /** How many readers still on the list were mailed it. */
  readers: number;
}

// Read from the readers' own marks, so a reader who left since is no longer counted.
export async function lastMailing(db: D1Database): Promise<LastMailing | null> {
  const row = await db
    .prepare(
      `SELECT mailed_day AS day, COUNT(*) AS readers FROM subscribers
        WHERE mailed_day = (SELECT MAX(mailed_day) FROM subscribers)`,
    )
    .first<{ day: string | null; readers: number }>();
  return row?.day ? { day: row.day, readers: row.readers } : null;
}

// Deletes one reader by id; false when there is no such row.
export async function removeById(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM subscribers WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function subscriberCounts(db: D1Database): Promise<{ confirmed: number; pending: number }> {
  const { results } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status")
    .all<{ status: string; n: number }>();
  const of = (status: string) => results.find((r) => r.status === status)?.n ?? 0;
  return { confirmed: of("confirmed"), pending: of("pending") };
}
