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

/** A known category, or null for anything else (a value from JSON is checked before it names a class). */
export function categoryOf(value: unknown): Category | null {
  return CATEGORY_LIST.find((category) => category === value) ?? null;
}

/**
 * The address a result links to: only a plain same-site path. It starts with one "/" and holds
 * no backslash and no character below U+0021 anywhere: the URL parser drops tabs and newlines
 * and reads "\\" as "/", so either could turn "/…/host" into another site's address.
 */
export function safeHref(u: string): string | null {
  return /^\/(?!\/)[^\\\u0000- ]+$/.test(u) ? u : null;
}

/** A copy template with the number put where `{n}` stands. */
export function fill(template: string, n: number): string {
  return template.replace("{n}", String(n));
}

/** How far an arrow key moves the checked chip: 1, -1, or 0 for any other key or a press with Alt, Ctrl or Meta. */
export function arrowStep(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
  if (event.altKey || event.ctrlKey || event.metaKey) return 0;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") return 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") return -1;
  return 0;
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

/** Most terms a query counts: an address with a thousand terms costs no more than one with ten. */
export const MAX_TERMS = 10;

/** The whitespace-separated terms of a query, folded: the first MAX_TERMS of them. */
const termsOf = (q: string) => fold(q).split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);

/**
 * The text cut into plain and matched parts, joined they give the text back unchanged. Matching
 * is on the folded text, one character at a time, so every spelling a search finds is marked.
 */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  if (text === "") return [];
  const terms = termsOf(q);
  // Fold each character on its own and remember where its folded form starts.
  const chars = Array.from(text);
  let foldedText = "";
  const owner: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  chars.forEach((ch, i) => {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) owner.push(i);
    foldedText += f;
    offsets.push(offset);
    offset += ch.length;
  });
  offsets.push(offset);
  const hit = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    for (let at = foldedText.indexOf(term); at !== -1; at = foldedText.indexOf(term, at + 1)) {
      for (let k = at; k < at + term.length; k++) hit[owner[k]] = true;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  chars.forEach((ch, i) => {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += ch;
    else parts.push({ text: ch, hit: hit[i] });
  });
  return parts;
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return query.q.trim() === "" && query.category === null && query.month === null && query.minEcho === 0;
}

/**
 * Every whitespace-separated term must appear in the folded title, summary or category name (in
 * the page's language, from `names`); the filters are ANDed. Title hits (every term in the title)
 * come before the others, then newest first. An empty query with no filter finds nothing.
 */
export function search(
  docs: SearchDoc[],
  query: SearchQuery,
  names: Partial<Record<Category, string>> = {},
): SearchDoc[] {
  if (isEmptyQuery(query)) return [];
  const terms = termsOf(query.q);
  const foldedNames = new Map(Object.entries(names).map(([category, name]) => [category, fold(name ?? "")]));
  const hits: { doc: SearchDoc; rank: number; index: number }[] = [];
  docs.forEach((doc, index) => {
    if (query.category !== null && doc.c !== query.category) return;
    if (query.month !== null && !doc.d.startsWith(query.month)) return;
    if (doc.n < query.minEcho) return;
    const { t, s } = foldedDoc(doc);
    const c = foldedNames.get(doc.c) ?? "";
    if (!terms.every((term) => t.includes(term) || s.includes(term) || c.includes(term))) return;
    hits.push({ doc, rank: terms.every((term) => t.includes(term)) ? 0 : 1, index });
  });
  hits.sort((a, b) => a.rank - b.rank || (a.doc.d < b.doc.d ? 1 : a.doc.d > b.doc.d ? -1 : a.index - b.index));
  return hits.map((hit) => hit.doc);
}

const PARAMS = {
  tr: { topic: "konu", month: "ay", echo: "yanki" },
  en: { topic: "topic", month: "month", echo: "echo" },
} as const;

/** The one source filter the page offers: three or more. */
export const MIN_ECHO = 3;

/**
 * The query a page address carries. Unknown values are ignored, and so are values the page's
 * controls do not offer: a month not in `months` (when given) and any echo value but 3.
 */
export function readQuery(params: URLSearchParams, lang: Lang, months?: readonly string[]): SearchQuery {
  const names = PARAMS[lang];
  const topic = params.get(names.topic);
  const month = params.get(names.month);
  const echo = params.get(names.echo);
  return {
    q: (params.get("q") ?? "").trim(),
    category: categoryOf(topic),
    month:
      month !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (months === undefined || months.includes(month))
        ? month
        : null,
    minEcho: echo === String(MIN_ECHO) ? MIN_ECHO : 0,
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
