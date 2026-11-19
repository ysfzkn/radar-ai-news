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
          published ? s.created_at : null,
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
const NOTE_MAX = 500;
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
  created_at: string;
  expires_at: string;
  edited: boolean;
}

export interface StoryFull extends Omit<StorySummary, "title_tr"> {
  version: number;
  score: IngestStory["score"];
  fact_card: IngestStory["fact_card"];
  source_url: string;
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

export async function listStories(db: D1Database, status: Status, limit = 50): Promise<StorySummary[]> {
  const order =
    status === "review"
      ? "s.created_at ASC, s.uid ASC"
      : "COALESCE(s.decided_at, s.published_at, s.created_at) DESC, s.uid ASC";
  const { results } = await db
    .prepare(
      `SELECT s.uid, s.category, s.status, s.publish_mode, s.reasons, s.source_count, s.edited,
              s.created_at, t.title AS title_tr
         FROM stories s
         LEFT JOIN story_texts t ON t.story_uid = s.uid AND t.lang = 'tr'
        WHERE s.status = ?
        ORDER BY ${order}
        LIMIT ?`,
    )
    .bind(status, limit)
    .all<Row & { title_tr: string }>();
  return results.map((r) => ({
    uid: r.uid,
    category: r.category,
    status: r.status,
    publish_mode: r.publish_mode,
    title_tr: r.title_tr ?? "",
    reasons: JSON.parse(r.reasons) as string[],
    source_count: r.source_count,
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

// The UPDATE is guarded by uid + version + status; the event is read back from the row at
// the new version and ignored if that (uid, version) already has one, so a refused update
// writes nothing. Success is the UPDATE's change count. Statements that must only apply when
// the update will succeed (text rows) come first and check the same guard on the story row.
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
      `INSERT OR IGNORE INTO story_events (story_uid, version, action, actor, note, at)
       SELECT uid, version, ?, ?, ?, ? FROM stories WHERE uid = ? AND version = ?`,
    )
    .bind(t.action, t.actor, t.note, t.at, t.uid, t.version + 1);
  return [...(t.before ?? []), update, event];
}

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

// Runs a transition; the UPDATE's change count says whether it landed.
async function runTransition(db: D1Database, t: Transition): Promise<Result> {
  const results = await db.batch(transitionStatements(db, t));
  if ((results[t.before?.length ?? 0]?.meta.changes ?? 0) > 0) return { ok: true };
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

// Expires every review story aged 72 h or more. Idempotent: a second run finds nothing.
export async function expireStale(db: D1Database, now: Date): Promise<number> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - TTL_MS).toISOString();
  const { results } = await db
    .prepare("SELECT uid, version FROM stories WHERE status = 'review' AND created_at <= ?")
    .bind(cutoff)
    .all<{ uid: string; version: number }>();
  if (results.length === 0) return 0;
  const statements = results.flatMap((r) => transitionStatements(db, expireTransition(r.uid, r.version, at)));
  const out = await db.batch(statements);
  return results.filter((_, i) => (out[i * 2]?.meta.changes ?? 0) > 0).length;
}
