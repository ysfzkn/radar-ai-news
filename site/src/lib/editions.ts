import type { Lang, PublicStory } from "./schema";

export interface Edition {
  /** "YYYY-MM-DD" in Istanbul. */
  date: string;
  number: number;
  stories: PublicStory[];
}

export interface Week {
  /** ISO week, for example "2026-W47". */
  id: string;
  /** Monday, "YYYY-MM-DD". */
  from: string;
  /** Sunday, "YYYY-MM-DD". */
  to: string;
  stories: PublicStory[];
}

const DAY = 86_400_000;
const ISTANBUL_OFFSET = 3 * 3_600_000;
const WEEK_LIMIT = 10;
const TOPIC_LIMIT = 30;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function dayString(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The Istanbul calendar day (UTC+3, no daylight saving) of a timestamp. */
export function istanbulDate(iso: string): string {
  return dayString(Date.parse(iso) + ISTANBUL_OFFSET);
}

export function forLang(stories: PublicStory[], lang: Lang): PublicStory[] {
  return stories.filter((story) => story.texts[lang] !== undefined);
}

function compareInEdition(a: PublicStory, b: PublicStory): number {
  if (a.source_count !== b.source_count) return b.source_count - a.source_count;
  if (a.published_at !== b.published_at) return a.published_at < b.published_at ? -1 : 1;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

function groupBy(stories: PublicStory[], key: (s: PublicStory) => string) {
  const groups = new Map<string, PublicStory[]>();
  for (const story of stories) {
    const k = key(story);
    const list = groups.get(k);
    if (list) list.push(story);
    else groups.set(k, [story]);
  }
  return groups;
}

export function buildEditions(stories: PublicStory[]): Edition[] {
  const groups = groupBy(stories, (s) => istanbulDate(s.published_at));
  const dates = [...groups.keys()].sort();
  return dates
    .map((date, index) => ({
      date,
      number: index + 1,
      stories: [...groups.get(date)!].sort(compareInEdition),
    }))
    .reverse();
}

/** ISO-8601 week of a "YYYY-MM-DD" date: its year, number and Monday. */
function isoWeek(date: string): { year: number; week: number; monday: number } {
  const ms = dayMs(date);
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const dayOfYear = Math.round((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY);
  return { year, week: Math.floor(dayOfYear / 7) + 1, monday };
}

export function buildWeeks(stories: PublicStory[]): Week[] {
  const groups = groupBy(stories, (s) => {
    const { year, week } = isoWeek(istanbulDate(s.published_at));
    return `${pad(year, 4)}-W${pad(week)}`;
  });
  return [...groups.keys()]
    .sort()
    .reverse()
    .map((id) => {
      const list = groups.get(id)!;
      const { monday } = isoWeek(istanbulDate(list[0].published_at));
      return {
        id,
        from: dayString(monday),
        to: dayString(monday + 6 * DAY),
        stories: [...list].sort(compareInEdition).slice(0, WEEK_LIMIT),
      };
    });
}

/** Stories per category, newest first, at most 30 each. */
export function byCategory(stories: PublicStory[]): Map<string, PublicStory[]> {
  const groups = groupBy(stories, (s) => s.category);
  for (const [category, list] of groups) {
    const newest = [...list].sort((a, b) =>
      a.published_at === b.published_at
        ? a.uid < b.uid
          ? -1
          : 1
        : a.published_at < b.published_at
          ? 1
          : -1,
    );
    groups.set(category, newest.slice(0, TOPIC_LIMIT));
  }
  return groups;
}

export function echoLevel(sourceCount: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.floor(sourceCount))) as 1 | 2 | 3 | 4 | 5;
}

export function readingMinutes(stories: PublicStory[], lang: Lang): number {
  let words = 0;
  for (const story of stories) {
    const text = story.texts[lang];
    if (!text) continue;
    const joined = `${text.title} ${text.summary} ${text.dev_line}`.trim();
    if (joined) words += joined.split(/\s+/).length;
  }
  return Math.max(1, Math.ceil(words / 200));
}

export function anchorId(uid: string): string {
  return `s-${uid.slice(0, 8)}`;
}
