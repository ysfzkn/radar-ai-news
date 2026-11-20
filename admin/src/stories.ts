import { CATEGORIES, INGEST_LIMITS, PUBLISH_LIMITS, isHttpUrl } from "./schema";
import type { IngestStory, Lang, Status } from "./schema";

const STATEMENTS_PER_STORY = 4;

// Inserts each story with its two texts and an 'ingested' event. A uid that already
// exists is left untouched: the story insert is the arbiter (its change count), and
// the texts and event rows are written with DO NOTHING so a duplicate adds nothing.
// One batch is one transaction, so the request lands whole or not at all.
export async function insertStories(
  db: D1Database,
  stories: IngestStory[],
  now: Date,
): Promise<{ accepted: string[]; duplicates: string[] }> {
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const s of stories) {
    const published = s.status === "published";
    statements.push(
      db
        .prepare(
          `INSERT INTO stories (uid, category, status, publish_mode, reasons, score, fact_card, source_url,
             source_count, sources, version, created_at, received_at, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(uid) DO NOTHING`,
        )
        .bind(
          s.uid,
          s.category,
          s.status,
          published ? "auto" : null,
          JSON.stringify(s.reasons),
          JSON.stringify(s.score),
          JSON.stringify(s.fact_card),
          s.source_url,
          s.source_count,
          JSON.stringify(s.sources),
          s.created_at,
          at,
          published ? at : null, // an auto-published story goes live when it arrives
        ),
    );
    for (const lang of ["tr", "en"] as const) {
      const t = s.texts[lang];
      statements.push(
        db
          .prepare(
            `INSERT INTO story_texts (story_uid, lang, title, summary, dev_line)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(story_uid, lang) DO NOTHING`,
          )
          .bind(s.uid, lang, t.title, t.summary, t.dev_line),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO story_events (story_uid, version, action, actor, at)
           VALUES (?, 1, 'ingested', 'agent', ?) ON CONFLICT(story_uid, version) DO NOTHING`,
        )
        .bind(s.uid, at),
    );
  }
  const results = await db.batch(statements);
  const accepted: string[] = [];
  const duplicates: string[] = [];
  stories.forEach((s, i) => {
    ((results[i * STATEMENTS_PER_STORY]?.meta.changes ?? 0) > 0 ? accepted : duplicates).push(s.uid);
  });
  return { accepted, duplicates };
}

// ---------------------------------------------------------------------------
// Queue queries, decisions and expiry
// ---------------------------------------------------------------------------

export const REVIEW_TTL_HOURS = 72;
const TTL_MS = REVIEW_TTL_HOURS * 60 * 60 * 1000;
export const NOTE_MAX = 500;
const TEXT_FIELDS = ["title", "summary", "dev_line"] as const;
const LANGS = ["tr", "en"] as const;
const STATUSES: Status[] = ["review", "published", "rejected", "expired"];

type TextSet = { title: string; summary: string; dev_line: string };

export interface StorySummary {
  uid: string;
  category: string;
  status: Status;
  publish_mode: "auto" | "human" | null;
  title_tr: string;
  reasons: string[];
  source_count: number;
  source_url: string;
  created_at: string;
  expires_at: string;
  edited: boolean;
}

export interface StoryFull extends Omit<StorySummary, "title_tr"> {
  version: number;
  score: IngestStory["score"];
  fact_card: IngestStory["fact_card"];
  sources: { name: string; url: string; tier: number }[];
  texts: Record<Lang, TextSet>;
  published_at: string | null;
  decided_at: string | null;
  events: { action: string; actor: string; note: string | null; at: string }[];
}

export interface EditPatch {
  category: string;
  try_url: string | null;
  texts: Record<Lang, TextSet>;
}

export type Failure = "not_found" | "conflict" | "wrong_status" | "expired" | "too_long" | "invalid";
export type Result = { ok: true } | { ok: false; error: Failure; detail?: string };

const fail = (error: Failure, detail?: string): Result =>
  detail === undefined ? { ok: false, error } : { ok: false, error, detail };

const expiresAt = (createdAt: string): string => new Date(Date.parse(createdAt) + TTL_MS).toISOString();

interface Row {
  uid: string;
  category: string;
  status: Status;
  publish_mode: "auto" | "human" | null;
  reasons: string;
  score: string;
  fact_card: string;
  source_url: string;
  source_count: number;
  sources: string;
  edited: number;
  version: number;
  created_at: string;
  published_at: string | null;
  decided_at: string | null;
}

export async function counts(db: D1Database): Promise<Record<Status, number>> {
  const { results } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM stories GROUP BY status")
    .all<{ status: Status; n: number }>();
  const out = { review: 0, published: 0, rejected: 0, expired: 0 } as Record<Status, number>;
  for (const r of results) if (STATUSES.includes(r.status)) out[r.status] = r.n;
  return out;
}

// Rows per queue page.
export const PAGE_SIZE = 50;

// The queue's search: `q` over the Turkish and English titles, `cat` one known category.
export interface QueueFilter {
  q: string;
  cat: string | null;
}

export const NO_FILTER: QueueFilter = { q: "", cat: null };
export const QUERY_MAX = 100;

// Trimmed and cut to QUERY_MAX UTF-16 units, as an input's maxlength counts them, never inside a
// surrogate pair; an unknown category is no category.
export function queueFilter(rawQ: string | undefined, rawCat: string | undefined): QueueFilter {
  const chars = Array.from((rawQ ?? "").trim());
  let q = "";
  for (const ch of chars) {
    if (q.length + ch.length > QUERY_MAX) break;
    q += ch;
  }
  const cat = (CATEGORIES as readonly string[]).find((c) => c === rawCat) ?? null;
  return { q: q.trim(), cat };
}

// A LIKE pattern that matches `q` anywhere, with the escape character, % and _ taken literally.
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

// D1 refuses a LIKE pattern over 50 bytes; a longer word is matched with instr() instead (also
// literal, and case-sensitive within each case form). At most MAX_TERMS words, each with up to
// four case forms, keep a statement under D1's 100 bound parameters.
const LIKE_MAX_BYTES = 50;
const MAX_TERMS = 10;
const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

// The words of `q` the search uses (the first MAX_TERMS) and how many it leaves out.
export function searchTerms(q: string): { used: string[]; ignored: number } {
  const all = q.split(/\s+/).filter((t) => t !== "");
  return { used: all.slice(0, MAX_TERMS), ignored: Math.max(0, all.length - MAX_TERMS) };
}

// SQLite's LIKE folds ASCII letters only, so "şifre" would miss "Şifre" and "istanbul" would miss
// "İstanbul". A word is matched in its own spelling and in its Turkish-locale lower, upper and
// capitalised forms (ş/Ş, i/İ, ı/I); LIKE still folds the ASCII letters of each.
export function caseVariants(term: string): string[] {
  const lower = term.toLocaleLowerCase("tr");
  const first = Array.from(lower)[0] ?? "";
  const capital = first.toLocaleUpperCase("tr") + lower.slice(first.length);
  return [...new Set([term, lower, term.toLocaleUpperCase("tr"), capital])];
}

// The WHERE clauses and binds a filter adds to a query over `stories s`. Every word of `q` (in one
// of its case forms) must appear in the same title, Turkish or English. All values are bound.
function filterSql(f: QueueFilter): { sql: string; binds: unknown[] } {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (f.cat) {
    parts.push("AND s.category = ?");
    binds.push(f.cat);
  }
  const terms = searchTerms(f.q).used;
  if (terms.length > 0) {
    const tests = terms.map((term) => {
      const forms = caseVariants(term).map((form) => {
        const like = likePattern(form);
        if (utf8Length(like) <= LIKE_MAX_BYTES) {
          binds.push(like);
          return "f.title LIKE ? ESCAPE '\\'";
        }
        binds.push(form);
        return "instr(f.title, ?) > 0";
      });
      return `(${forms.join(" OR ")})`;
    });
    parts.push(`AND EXISTS (SELECT 1 FROM story_texts f WHERE f.story_uid = s.uid AND ${tests.join(" AND ")})`);
  }
  return { sql: parts.join(" "), binds };
}

export async function countStories(db: D1Database, status: Status, filter: QueueFilter): Promise<number> {
  const f = filterSql(filter);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM stories s WHERE s.status = ? ${f.sql}`)
    .bind(status, ...f.binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listStories(
  db: D1Database,
  status: Status,
  limit = PAGE_SIZE,
  offset = 0,
  filter: QueueFilter = NO_FILTER,
): Promise<StorySummary[]> {
  const order =
    status === "review"
      ? "s.created_at ASC, s.uid ASC"
      : "COALESCE(s.decided_at, s.published_at, s.created_at) DESC, s.uid ASC";
  const f = filterSql(filter);
  const { results } = await db
    .prepare(
      `SELECT s.uid, s.category, s.status, s.publish_mode, s.reasons, s.source_url, s.source_count, s.edited,
              s.created_at, t.title AS title_tr
         FROM stories s
         LEFT JOIN story_texts t ON t.story_uid = s.uid AND t.lang = 'tr'
        WHERE s.status = ? ${f.sql}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
    )
    .bind(status, ...f.binds, limit, offset)
    .all<Row & { title_tr: string }>();
  return results.map((r) => ({
    uid: r.uid,
    category: r.category,
    status: r.status,
    publish_mode: r.publish_mode,
    title_tr: r.title_tr ?? "",
    reasons: JSON.parse(r.reasons) as string[],
    source_count: r.source_count,
    source_url: r.source_url,
    created_at: r.created_at,
    expires_at: expiresAt(r.created_at),
    edited: r.edited === 1,
  }));
}

async function loadTexts(db: D1Database, uid: string): Promise<Record<Lang, TextSet>> {
  const { results } = await db
    .prepare("SELECT lang, title, summary, dev_line FROM story_texts WHERE story_uid = ?")
    .bind(uid)
    .all<{ lang: Lang } & TextSet>();
  const texts = {} as Record<Lang, TextSet>;
  for (const r of results) texts[r.lang] = { title: r.title, summary: r.summary, dev_line: r.dev_line };
  return texts;
}

export async function getStory(db: D1Database, uid: string): Promise<StoryFull | null> {
  const row = await db.prepare("SELECT * FROM stories WHERE uid = ?").bind(uid).first<Row>();
  if (!row) return null;
  const texts = await loadTexts(db, uid);
  const { results: events } = await db
    .prepare("SELECT action, actor, note, at FROM story_events WHERE story_uid = ? ORDER BY id ASC")
    .bind(uid)
    .all<{ action: string; actor: string; note: string | null; at: string }>();
  return {
    uid: row.uid,
    category: row.category,
    status: row.status,
    publish_mode: row.publish_mode,
    reasons: JSON.parse(row.reasons) as string[],
    source_count: row.source_count,
    created_at: row.created_at,
    expires_at: expiresAt(row.created_at),
    edited: row.edited === 1,
    version: row.version,
    score: JSON.parse(row.score),
    fact_card: JSON.parse(row.fact_card),
    source_url: row.source_url,
    sources: JSON.parse(row.sources),
    texts,
    published_at: row.published_at,
    decided_at: row.decided_at,
    events,
  };
}

interface Transition {
  uid: string;
  version: number;
  from: Status[];
  to?: Status; // omitted: the status stays (edit)
  decided: boolean; // set decided_at
  set?: { sql: string; binds: unknown[] }; // extra SET clauses
  before?: D1PreparedStatement[]; // run first, guarded by the same version check (edit's text rows)
  action: string;
  actor: string;
  note: string | null;
  at: string;
}

// The history row and the UPDATE are guarded by the same uid + version + status, read before
// the UPDATE, so both apply or neither does: a refused transition (a stale version, a lost race)
// matches no row and writes nothing. The event is a plain INSERT: if it cannot be written (a
// CHECK the database does not know yet, such as 'restored' before migration 0002, or a taken
// (uid, version) slot) the statement fails, the batch is one transaction and is rolled back, and
// the error reaches the caller. Earlier the event was read back after the UPDATE at the new
// version with INSERT OR IGNORE: after a lost race that read found the winner's row and would
// have collided with the winner's event, and OR IGNORE kept that a clean conflict. It also hid
// CHECK failures, so a story could change with no history row; guarding on the old state keeps
// the race safe without it. Success is the UPDATE's change count. Statements that must only
// apply when the update will succeed (text rows) come first and check the same guard.
function transitionStatements(db: D1Database, t: Transition): D1PreparedStatement[] {
  const marks = t.from.map(() => "?").join(", ");
  const sets = ["version = version + 1"];
  const binds: unknown[] = [];
  if (t.to) {
    sets.push("status = ?");
    binds.push(t.to);
  }
  if (t.decided) {
    sets.push("decided_at = ?");
    binds.push(t.at);
  }
  if (t.set) {
    sets.push(t.set.sql);
    binds.push(...t.set.binds);
  }
  const update = db
    .prepare(`UPDATE stories SET ${sets.join(", ")} WHERE uid = ? AND version = ? AND status IN (${marks})`)
    .bind(...binds, t.uid, t.version, ...t.from);
  const event = db
    .prepare(
      `INSERT INTO story_events (story_uid, version, action, actor, note, at)
       SELECT uid, version + 1, ?, ?, ?, ? FROM stories WHERE uid = ? AND version = ? AND status IN (${marks})`,
    )
    .bind(t.action, t.actor, t.note, t.at, t.uid, t.version, ...t.from);
  return [...(t.before ?? []), event, update];
}

// Where the UPDATE sits in transitionStatements' list.
const updateIndex = (t: Transition): number => (t.before?.length ?? 0) + 1;

// not_found, then conflict, then wrong_status.
async function precheck(
  db: D1Database,
  uid: string,
  version: number,
  from: Status[],
): Promise<{ result?: Result; row?: Row }> {
  const row = await db.prepare("SELECT * FROM stories WHERE uid = ?").bind(uid).first<Row>();
  if (!row) return { result: fail("not_found") };
  if (row.version !== version) return { result: fail("conflict") };
  if (!from.includes(row.status)) return { result: fail("wrong_status") };
  return { row };
}

// Runs a transition; the UPDATE's change count says whether it landed. A history row that cannot
// be written throws (see transitionStatements) and nothing is changed.
async function runTransition(db: D1Database, t: Transition): Promise<Result> {
  const results = await db.batch(transitionStatements(db, t));
  if ((results[updateIndex(t)]?.meta.changes ?? 0) > 0) return { ok: true };
  // Lost a race after our pre-check: classify against the current row.
  return (await precheck(db, t.uid, t.version, t.from)).result ?? fail("conflict");
}

function checkLengths(texts: Record<Lang, TextSet>, limits: Record<keyof TextSet, number>): Result {
  for (const lang of LANGS)
    for (const f of TEXT_FIELDS) if (texts[lang][f].trim().length > limits[f]) return fail("too_long", `${lang}.${f}`);
  return { ok: true };
}

export async function editStory(
  db: D1Database,
  uid: string,
  version: number,
  patch: EditPatch,
  actor: string,
  now: Date,
): Promise<Result> {
  const from: Status[] = ["review", "published"];
  const pre = await precheck(db, uid, version, from);
  if (!pre.row) return pre.result!;
  const row = pre.row;

  if (!(CATEGORIES as readonly string[]).includes(patch.category)) return fail("invalid", "category");
  const tryUrl = patch.try_url === null ? null : patch.try_url.trim();
  if (tryUrl !== null && (tryUrl.length === 0 || tryUrl.length > 2000 || !isHttpUrl(tryUrl)))
    return fail("invalid", "try_url");
  const texts = {} as Record<Lang, TextSet>;
  for (const lang of LANGS) {
    const t = patch.texts[lang];
    texts[lang] = { title: t.title.trim(), summary: t.summary.trim(), dev_line: t.dev_line.trim() };
    for (const f of TEXT_FIELDS) if (texts[lang][f].length === 0) return fail("invalid", `${lang}.${f}`);
  }
  const tooLong = checkLengths(texts, row.status === "published" ? PUBLISH_LIMITS : INGEST_LIMITS);
  if (!tooLong.ok) return tooLong;

  const factCard = { ...JSON.parse(row.fact_card), try_url: tryUrl };
  const marks = from.map(() => "?").join(", ");
  const before = LANGS.map((lang) =>
    db
      .prepare(
        `UPDATE story_texts SET title = ?, summary = ?, dev_line = ?
          WHERE story_uid = ? AND lang = ?
            AND EXISTS (SELECT 1 FROM stories WHERE uid = ? AND version = ? AND status IN (${marks}))`,
      )
      .bind(texts[lang].title, texts[lang].summary, texts[lang].dev_line, uid, lang, uid, version, ...from),
  );
  return runTransition(db, {
    uid,
    version,
    from,
    decided: false,
    set: { sql: "category = ?, fact_card = ?, edited = 1", binds: [patch.category, JSON.stringify(factCard)] },
    before,
    action: "edited",
    actor,
    note: null,
    at: now.toISOString(),
  });
}

function expireTransition(uid: string, version: number, at: string): Transition {
  return {
    uid,
    version,
    from: ["review"],
    to: "expired",
    decided: true,
    action: "expired",
    actor: "system",
    note: null,
    at,
  };
}

export async function approveStory(
  db: D1Database,
  uid: string,
  version: number,
  actor: string,
  now: Date,
): Promise<Result> {
  const pre = await precheck(db, uid, version, ["review"]);
  if (!pre.row) return pre.result!;
  const at = now.toISOString();
  if (now.getTime() - Date.parse(pre.row.created_at) >= TTL_MS) {
    const expired = await runTransition(db, expireTransition(uid, version, at));
    return expired.ok ? fail("expired") : expired;
  }
  const tooLong = checkLengths(await loadTexts(db, uid), PUBLISH_LIMITS);
  if (!tooLong.ok) return tooLong;
  return runTransition(db, {
    uid,
    version,
    from: ["review"],
    to: "published",
    decided: true,
    set: { sql: "publish_mode = 'human', published_at = ?", binds: [at] },
    action: "approved",
    actor,
    note: null,
    at,
  });
}

export async function rejectStory(
  db: D1Database,
  uid: string,
  version: number,
  note: string | null,
  actor: string,
  now: Date,
): Promise<Result> {
  const pre = await precheck(db, uid, version, ["review"]);
  if (!pre.row) return pre.result!;
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > NOTE_MAX) return fail("invalid", "note");
  return runTransition(db, {
    uid,
    version,
    from: ["review"],
    to: "rejected",
    decided: true,
    action: "rejected",
    actor,
    note: trimmed === "" ? null : trimmed,
    at: now.toISOString(),
  });
}

export async function unpublishStory(
  db: D1Database,
  uid: string,
  version: number,
  note: string,
  actor: string,
  now: Date,
): Promise<Result> {
  const pre = await precheck(db, uid, version, ["published"]);
  if (!pre.row) return pre.result!;
  const trimmed = (note ?? "").trim();
  if (trimmed.length === 0 || trimmed.length > NOTE_MAX) return fail("invalid", "note");
  return runTransition(db, {
    uid,
    version,
    from: ["published"],
    to: "rejected",
    decided: true,
    set: { sql: "published_at = NULL", binds: [] },
    action: "unpublished",
    actor,
    note: trimmed,
    at: now.toISOString(),
  });
}

// Undoes a rejection (a take-down included): the story goes back to the review queue with the
// expiry it always had, so a story whose 72 hours have passed is refused and stays rejected.
export async function restoreStory(
  db: D1Database,
  uid: string,
  version: number,
  actor: string,
  now: Date,
): Promise<Result> {
  const pre = await precheck(db, uid, version, ["rejected"]);
  if (!pre.row) return pre.result!;
  if (now.getTime() - Date.parse(pre.row.created_at) >= TTL_MS) return fail("expired");
  return runTransition(db, {
    uid,
    version,
    from: ["rejected"],
    to: "review",
    decided: false,
    set: { sql: "decided_at = NULL", binds: [] },
    action: "restored",
    actor,
    note: null,
    at: now.toISOString(),
  });
}

// Whether a rejected story can still go back to the queue at `now`.
export const restorable = (s: { status: Status; created_at: string }, now: Date): boolean =>
  s.status === "rejected" && now.getTime() - Date.parse(s.created_at) < TTL_MS;

// The review story to show after a decision on the story that stood at `after`: the next one in
// queue order, or else the first of the queue (stories skipped earlier); null when none waits.
// Stories past their window are expired first, as opening the queue does.
export async function nextInQueue(
  db: D1Database,
  after: { created_at: string; uid: string },
  now: Date,
): Promise<string | null> {
  await expireStale(db, now);
  const next = await db
    .prepare(
      `SELECT uid FROM stories WHERE status = 'review' AND (created_at > ? OR (created_at = ? AND uid > ?))
        ORDER BY created_at ASC, uid ASC LIMIT 1`,
    )
    .bind(after.created_at, after.created_at, after.uid)
    .first<{ uid: string }>();
  if (next) return next.uid;
  const first = await db
    .prepare("SELECT uid FROM stories WHERE status = 'review' ORDER BY created_at ASC, uid ASC LIMIT 1")
    .first<{ uid: string }>();
  return first?.uid ?? null;
}

// ---------------------------------------------------------------------------
// Today's edition, the queue's numbers, a story's place in its list
// ---------------------------------------------------------------------------

export type Tab = Status | "edition";

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year
const DAY_MS = 24 * 60 * 60 * 1000;

// Today in Istanbul as a half-open UTC range of ISO strings.
export function istanbulDay(now: Date): { start: string; end: string } {
  const start = Math.floor((now.getTime() + ISTANBUL_OFFSET_MS) / DAY_MS) * DAY_MS - ISTANBUL_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

export interface EditionRow {
  uid: string;
  category: string;
  title_tr: string;
  published_at: string;
  version: number;
  publish_mode: "auto" | "human" | null;
}

// The stories published today, in the public endpoint's order (published_at newest first, then uid).
export async function listEdition(db: D1Database, now: Date): Promise<EditionRow[]> {
  const day = istanbulDay(now);
  const { results } = await db
    .prepare(
      `SELECT s.uid, s.category, s.published_at, s.version, s.publish_mode, t.title AS title_tr
         FROM stories s
         LEFT JOIN story_texts t ON t.story_uid = s.uid AND t.lang = 'tr'
        WHERE s.status = 'published' AND s.published_at >= ? AND s.published_at < ?
        ORDER BY s.published_at DESC, s.uid ASC`,
    )
    .bind(day.start, day.end)
    .all<EditionRow>();
  return results.map((r) => ({ ...r, title_tr: r.title_tr ?? "" }));
}

export async function publishedToday(db: D1Database, now: Date): Promise<number> {
  const day = istanbulDay(now);
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM stories WHERE status = 'published' AND published_at >= ? AND published_at < ?")
    .bind(day.start, day.end)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// A tab's rows and their order, as the queue and the edition list them. Only constants go into SQL.
function tabScope(tab: Tab, now: Date): { where: string; binds: unknown[]; key: string; desc: boolean } {
  if (tab === "review") return { where: "s.status = 'review'", binds: [], key: "s.created_at", desc: false };
  if (tab === "edition") {
    const day = istanbulDay(now);
    return {
      where: "s.status = 'published' AND s.published_at >= ? AND s.published_at < ?",
      binds: [day.start, day.end],
      key: "s.published_at",
      desc: true,
    };
  }
  return { where: "s.status = ?", binds: [tab], key: "COALESCE(s.decided_at, s.published_at, s.created_at)", desc: true };
}

export interface Position {
  index: number; // 1-based
  total: number;
  prev: string | null;
  next: string | null;
}

// Where a story stands in a tab's order; null when it is not in that tab.
export async function storyPosition(db: D1Database, uid: string, tab: Tab, now: Date): Promise<Position | null> {
  const t = tabScope(tab, now);
  const own = await db
    .prepare(`SELECT ${t.key} AS k FROM stories s WHERE s.uid = ? AND ${t.where}`)
    .bind(uid, ...t.binds)
    .first<{ k: string }>();
  if (!own) return null;
  const k = t.key;
  const before = t.desc ? `(${k} > ? OR (${k} = ? AND s.uid < ?))` : `(${k} < ? OR (${k} = ? AND s.uid < ?))`;
  const after = t.desc ? `(${k} < ? OR (${k} = ? AND s.uid > ?))` : `(${k} > ? OR (${k} = ? AND s.uid > ?))`;
  const forward = t.desc ? `${k} DESC, s.uid ASC` : `${k} ASC, s.uid ASC`;
  const backward = t.desc ? `${k} ASC, s.uid DESC` : `${k} DESC, s.uid DESC`;
  const at = [own.k, own.k, uid];
  const [total, ahead, prev, next] = await db.batch<{ n?: number; uid?: string }>([
    db.prepare(`SELECT COUNT(*) AS n FROM stories s WHERE ${t.where}`).bind(...t.binds),
    db.prepare(`SELECT COUNT(*) AS n FROM stories s WHERE ${t.where} AND ${before}`).bind(...t.binds, ...at),
    db
      .prepare(`SELECT s.uid FROM stories s WHERE ${t.where} AND ${before} ORDER BY ${backward} LIMIT 1`)
      .bind(...t.binds, ...at),
    db
      .prepare(`SELECT s.uid FROM stories s WHERE ${t.where} AND ${after} ORDER BY ${forward} LIMIT 1`)
      .bind(...t.binds, ...at),
  ]);
  return {
    index: (ahead?.results[0]?.n ?? 0) + 1,
    total: total?.results[0]?.n ?? 0,
    prev: prev?.results[0]?.uid ?? null,
    next: next?.results[0]?.uid ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public read model
// ---------------------------------------------------------------------------

export interface PublicStory {
  uid: string;
  category: string;
  publish_mode: "auto" | "human";
  edited: boolean;
  source_count: number;
  source_url: string;
  sources: { name: string; url: string }[];
  try_url: string | null;
  created_at: string;
  published_at: string;
  texts: Partial<Record<Lang, TextSet>>;
}

export interface PublicCursor {
  published_at: string;
  uid: string;
}

// D1 allows 100 bound parameters per statement; texts are fetched in chunks well below that.
const TEXT_CHUNK = 90;

interface PublicRow {
  uid: string;
  category: string;
  publish_mode: "auto" | "human" | null;
  edited: number;
  source_count: number;
  source_url: string;
  sources: string;
  fact_card: string;
  created_at: string;
  published_at: string;
}

// A stored value that is not valid JSON, or has an unexpected shape, yields the fallback: one bad
// row must not break the whole feed.
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function publicSources(raw: string): { name: string; url: string }[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  const out: { name: string; url: string }[] = [];
  for (const s of parsed) {
    if (!isRecord(s) || typeof s.name !== "string" || typeof s.url !== "string" || !isHttpUrl(s.url)) continue;
    const name = s.name.trim();
    if (name !== "") out.push({ name, url: s.url });
  }
  return out;
}

function publicTryUrl(raw: string): string | null {
  const card = parseJson(raw);
  const url = isRecord(card) ? card.try_url : null;
  return typeof url === "string" && isHttpUrl(url) ? url : null;
}

// Published stories, newest published_at first and uid ascending within a tie. Two queries: one
// SELECT for the page (one row more than `limit`, to know whether another page exists), then one
// db.batch carrying the texts in chunks of TEXT_CHUNK uids. `next` is the position of the last of
// the first `limit` rows, which the following page starts after. A language with a blank text is
// left out, and a story left with no language is not returned; `next` still comes from the rows
// read, so such a story is stepped over, never repeated, and a page may hold fewer than `limit`.
// The page query: binds are the cursor's published_at three times and uid (with a cursor), then the
// limit. Migration 0003's index (status, published_at DESC, uid) matches its WHERE and its ORDER BY.
// The keyset's OR cannot be one range on the index by itself, so the cursor's published_at is also
// given as the plain bound `published_at <= ?`: the planner seeks to it and reads from there, in
// order, with no sort, so a page reads about its own rows even when the cursor is deep.
export const publishedPageSql = (withCursor: boolean): string =>
  `SELECT uid, category, publish_mode, edited, source_count, source_url, sources, fact_card,
              created_at, published_at
         FROM stories
        WHERE status = 'published' AND published_at IS NOT NULL
              ${withCursor ? "AND published_at <= ? AND (published_at < ? OR (published_at = ? AND uid > ?))" : ""}
        ORDER BY published_at DESC, uid ASC
        LIMIT ?`;

export async function listPublished(
  db: D1Database,
  limit: number,
  cursor: PublicCursor | null,
): Promise<{ stories: PublicStory[]; next: PublicCursor | null }> {
  const binds = cursor ? [cursor.published_at, cursor.published_at, cursor.published_at, cursor.uid] : [];
  const { results } = await db
    .prepare(publishedPageSql(cursor !== null))
    .bind(...binds, limit + 1)
    .all<PublicRow>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  const next = results.length > limit && last ? { published_at: last.published_at, uid: last.uid } : null;
  if (rows.length === 0) return { stories: [], next };

  const chunks: string[][] = [];
  for (let i = 0; i < rows.length; i += TEXT_CHUNK) chunks.push(rows.slice(i, i + TEXT_CHUNK).map((r) => r.uid));
  const batches = await db.batch<{ story_uid: string; lang: Lang } & TextSet>(
    chunks.map((uids) =>
      db
        .prepare(
          `SELECT story_uid, lang, title, summary, dev_line FROM story_texts
            WHERE story_uid IN (${uids.map(() => "?").join(", ")})`,
        )
        .bind(...uids),
    ),
  );
  const texts = new Map<string, Partial<Record<Lang, TextSet>>>();
  for (const batch of batches) {
    for (const r of batch.results) {
      const text = { title: r.title.trim(), summary: r.summary.trim(), dev_line: r.dev_line.trim() };
      if (text.title === "" || text.summary === "" || text.dev_line === "") continue;
      const set = texts.get(r.story_uid) ?? {};
      set[r.lang] = text;
      texts.set(r.story_uid, set);
    }
  }
  const stories: PublicStory[] = [];
  for (const r of rows) {
    const set = texts.get(r.uid);
    if (!set) continue;
    stories.push({
      uid: r.uid,
      category: r.category,
      publish_mode: r.publish_mode === "human" ? "human" : "auto",
      edited: r.edited === 1,
      source_count: r.source_count,
      source_url: r.source_url,
      sources: publicSources(r.sources),
      try_url: publicTryUrl(r.fact_card),
      created_at: r.created_at,
      published_at: r.published_at,
      texts: set,
    });
  }
  return { stories, next };
}

// Expires review stories aged 72 h or more, oldest first, at most 25 a call (one batch each, kept
// under D1's per-invocation query limit); the next call takes the rest. Idempotent.
export async function expireStale(db: D1Database, now: Date): Promise<number> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - TTL_MS).toISOString();
  const { results } = await db
    .prepare("SELECT uid, version FROM stories WHERE status = 'review' AND created_at <= ? ORDER BY created_at LIMIT 25")
    .bind(cutoff)
    .all<{ uid: string; version: number }>();
  if (results.length === 0) return 0;
  // One batch per story: a story whose history row cannot be written fails alone (logged without
  // any story text) and the others still expire. Each batch keeps the event and the update atomic.
  let expired = 0;
  for (const r of results) {
    const t = expireTransition(r.uid, r.version, at);
    try {
      const out = await db.batch(transitionStatements(db, t));
      if ((out[updateIndex(t)]?.meta.changes ?? 0) > 0) expired += 1;
    } catch (e) {
      console.error("expiry skipped one story", e instanceof Error ? e.name : "error");
    }
  }
  return expired;
}
