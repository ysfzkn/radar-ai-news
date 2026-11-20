// Pure search functions for the archive: no DOM, no imports of values, so the browser bundle stays small.
import type { Category, Lang } from "./schema";

/** One story in `search-<lang>.json`. */
export interface SearchDoc {
  /** The story's address: the edition page and its anchor, with the language prefix. */
  u: string;
  /** The edition's "YYYY-MM-DD". */
  d: string;
  c: Category;
  /** `source_count`. */
  n: number;
  /** Title. */
  t: string;
  /** Summary. */
  s: string;
}

export interface SearchQuery {
  q: string;
  category: Category | null;
  /** "YYYY-MM". */
  month: string | null;
  /** Fewest sources a story may have; 0 means no filter. */
  minEcho: number;
}

/** The same list as `CATEGORIES` in schema.ts (a test keeps them equal); that file is not imported here because it pulls in zod. */
const CATEGORY_LIST: readonly Category[] = [
  "protocol",
  "model",
  "framework",
  "tooling",
  "research",
  "security",
  "industry",
  "policy",
];

const FOLD: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  ğ: "g",
  ü: "u",
  ö: "o",
  ç: "c",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Lower-cases with Turkish rules (I → ı, İ → i), then maps the Turkish letters and the
 * circumflexed vowels to plain ones and strips every other combining mark, so `ISTANBUL`,
 * `İstanbul` and `ıstanbul` fold to `istanbul` and `şifre` to `sifre`.
 */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[ıİşğüöçâîû]/g, (ch) => FOLD[ch])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const folded = new WeakMap<SearchDoc, { t: string; s: string }>();

function foldedDoc(doc: SearchDoc): { t: string; s: string } {
  let entry = folded.get(doc);
  if (!entry) {
    entry = { t: fold(doc.t), s: fold(doc.s) };
    folded.set(doc, entry);
  }
  return entry;
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return query.q.trim() === "" && query.category === null && query.month === null && query.minEcho === 0;
}

/**
 * Every whitespace-separated term must appear in the folded title or summary; the filters are
 * ANDed. Title hits (every term in the title) come before summary-only hits, then newest first.
 * An empty query with no filter finds nothing.
 */
export function search(docs: SearchDoc[], query: SearchQuery): SearchDoc[] {
  if (isEmptyQuery(query)) return [];
  const terms = fold(query.q).split(/\s+/).filter(Boolean);
  const hits: { doc: SearchDoc; rank: number; index: number }[] = [];
  docs.forEach((doc, index) => {
    if (query.category !== null && doc.c !== query.category) return;
    if (query.month !== null && !doc.d.startsWith(query.month)) return;
    if (doc.n < query.minEcho) return;
    const { t, s } = foldedDoc(doc);
    if (!terms.every((term) => t.includes(term) || s.includes(term))) return;
    hits.push({ doc, rank: terms.every((term) => t.includes(term)) ? 0 : 1, index });
  });
  hits.sort((a, b) => a.rank - b.rank || (a.doc.d < b.doc.d ? 1 : a.doc.d > b.doc.d ? -1 : a.index - b.index));
  return hits.map((hit) => hit.doc);
}

const PARAMS = {
  tr: { topic: "konu", month: "ay", echo: "yanki" },
  en: { topic: "topic", month: "month", echo: "echo" },
} as const;

/** The query a page address carries; unknown values are ignored. */
export function readQuery(params: URLSearchParams, lang: Lang): SearchQuery {
  const names = PARAMS[lang];
  const topic = params.get(names.topic);
  const month = params.get(names.month);
  const echo = params.get(names.echo);
  return {
    q: (params.get("q") ?? "").trim(),
    category: CATEGORY_LIST.find((category) => category === topic) ?? null,
    month: month !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    minEcho: echo !== null && /^[1-5]$/.test(echo) ? Number(echo) : 0,
  };
}

/** The address query for a state: "?q=…&konu=…" with only what is set, or "" when nothing is. */
export function writeQuery(query: SearchQuery, lang: Lang): string {
  const names = PARAMS[lang];
  const params = new URLSearchParams();
  if (query.q.trim() !== "") params.set("q", query.q.trim());
  if (query.category !== null) params.set(names.topic, query.category);
  if (query.month !== null) params.set(names.month, query.month);
  if (query.minEcho > 0) params.set(names.echo, String(query.minEcho));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
