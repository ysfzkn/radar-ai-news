import type { IngestStory } from "./schema";

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
