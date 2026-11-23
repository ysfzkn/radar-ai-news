import { UNSUBSCRIBE_SLOT, dailyMail, type Mail, type MailStory } from "./email";
import type { Env } from "./env";
import { leaveLink, mailConfig, sendBatch, type MailConfig, type Outgoing } from "./mail";
import type { Lang } from "./schema";
import { istanbulDay, listPublished, type PublicStory } from "./stories";
import { dueSubscribers, markMailed } from "./subscribers";

// The daily mail: today's edition, once, to every confirmed reader. Called by the hourly job, so
// it is written to be run again and again: a reader is marked with the day once their mail was
// accepted, and only readers not yet marked are mailed.

// Istanbul hours between which the mail goes out. The agent's daily run starts after midnight and
// may be hours late; whichever hourly job first finds stories within these hours sends them.
export const SEND_FROM_HOUR = 7;
export const SEND_UNTIL_HOUR = 22;
// Mails per call to Resend, and calls per hourly job: a ceiling on one job's work.
export const BATCH_SIZE = 50;
export const BATCHES_PER_RUN = 4;

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const EDITION_READ = 60; // an edition is at most a handful of stories; this is far above one day

/** The Istanbul calendar day of a moment, "YYYY-MM-DD", and its hour there. */
export function istanbulClock(now: Date): { day: string; hour: number } {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

// The edition's order on the site: more sources first, then earlier published, then uid.
function inEditionOrder(a: PublicStory, b: PublicStory): number {
  if (a.source_count !== b.source_count) return b.source_count - a.source_count;
  if (a.published_at !== b.published_at) return a.published_at < b.published_at ? -1 : 1;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

export async function todaysEdition(db: D1Database, now: Date): Promise<PublicStory[]> {
  const { start, end } = istanbulDay(now);
  const { stories } = await listPublished(db, EDITION_READ, null);
  return stories.filter((s) => s.published_at >= start && s.published_at < end).sort(inEditionOrder);
}

// The edition's number as the site counts it: the days, up to and including today, that have a
// published story.
export async function editionNumber(db: D1Database, now: Date): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT date(published_at, '+3 hours')) AS n FROM stories
        WHERE status = 'published' AND published_at IS NOT NULL AND published_at < ?`,
    )
    .bind(istanbulDay(now).end)
    .first<{ n: number }>();
  return Math.max(1, row?.n ?? 1);
}

export function mailStories(stories: readonly PublicStory[], lang: Lang): MailStory[] {
  const out: MailStory[] = [];
  for (const s of stories) {
    const text = s.texts[lang];
    if (!text) continue;
    out.push({
      uid: s.uid,
      category: s.category,
      source_count: s.source_count,
      source_url: s.source_url,
      sources: s.sources,
      try_url: s.try_url,
      title: text.title,
      summary: text.summary,
      dev_line: text.dev_line,
    });
  }
  return out;
}

const personal = (mail: Mail, leaveUrl: string): Mail => ({
  subject: mail.subject,
  html: mail.html.replaceAll(UNSUBSCRIBE_SLOT, leaveUrl),
  text: mail.text.replaceAll(UNSUBSCRIBE_SLOT, leaveUrl),
});

export interface DailyOutcome {
  day: string;
  sent: number;
  /** Readers marked without a mail: the edition has no story in their language. */
  skipped: number;
  failed: boolean;
}

// null when nothing was due: sending is not set up, it is outside the sending hours, or today has
// no published story yet.
export async function sendDaily(env: Env, now: Date, cfg: MailConfig | null = mailConfig(env)): Promise<DailyOutcome | null> {
  if (!cfg) return null;
  const { day, hour } = istanbulClock(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return null;
  const edition = await todaysEdition(env.DB, now);
  if (edition.length === 0) return null;

  const outcome: DailyOutcome = { day, sent: 0, skipped: 0, failed: false };
  // Which stories the edition holds, short enough for an idempotency key.
  const stamp = edition.map((s) => s.uid.slice(0, 3)).join("").slice(0, 90);
  let number: number | null = null;
  const rendered = new Map<Lang, Mail | null>();
  const mailFor = (lang: Lang, n: number): Mail | null => {
    if (!rendered.has(lang)) {
      const stories = mailStories(edition, lang);
      rendered.set(
        lang,
        stories.length === 0
          ? null
          : dailyMail(lang, { day, number: n, stories, siteUrl: cfg.siteUrl, unsubscribeUrl: UNSUBSCRIBE_SLOT }),
      );
    }
    return rendered.get(lang) ?? null;
  };

  for (let batch = 0; batch < BATCHES_PER_RUN; batch++) {
    const due = await dueSubscribers(env.DB, day, BATCH_SIZE);
    if (due.length === 0) break;
    number ??= await editionNumber(env.DB, now);
    const outs: Outgoing[] = [];
    const mailed: number[] = [];
    const without: number[] = [];
    for (const reader of due) {
      const mail = mailFor(reader.lang, number);
      if (!mail) {
        without.push(reader.id);
        continue;
      }
      const leaveUrl = leaveLink(cfg, reader.token);
      outs.push({ to: reader.email, mail: personal(mail, leaveUrl), leaveUrl });
      mailed.push(reader.id);
    }
    if (outs.length > 0) {
      // The same readers and the same stories on the same day make the same key, so a job that
      // sent but could not mark its readers does not send twice when the next job tries again
      // within Resend's 24 hours.
      const key = `radar-daily-${day}-${stamp}-${mailed[0]}-${mailed.at(-1)}-${mailed.length}`;
      const result = await sendBatch(cfg, outs, key);
      if (!result.ok) {
        // Only the outcome's name: never an address, never Resend's answer.
        console.error("daily mail: a batch was not accepted", result.error);
        outcome.failed = true;
        break;
      }
      await markMailed(env.DB, mailed, day);
      outcome.sent += mailed.length;
    }
    if (without.length > 0) {
      await markMailed(env.DB, without, day);
      outcome.skipped += without.length;
    }
    if (due.length < BATCH_SIZE) break;
  }
  if (outcome.sent > 0) console.log(`daily mail: ${day}, ${outcome.sent} sent`);
  return outcome;
}
