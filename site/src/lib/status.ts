import { buildEditions, forLang } from "./editions";
import { hostLabel, httpUrl } from "./format";
import type { Lang, PublicStory } from "./schema";

export interface SiteStatus {
  /** The newest edition's number and date. */
  issue: number;
  date: string;
  /** Every published story in this language. */
  stories: number;
  /** Distinct source hosts ("www." dropped) over those stories, main sources included. */
  sources: number;
}

/** What the footer's status line reports, counted at build; null when the language has no story. */
export function siteStatus(all: PublicStory[], lang: Lang): SiteStatus | null {
  const stories = forLang(all, lang);
  const latest = buildEditions(stories)[0];
  if (!latest) return null;
  const hosts = new Set<string>();
  for (const story of stories) {
    for (const url of [story.source_url, ...story.sources.map((s) => s.url)]) {
      const href = httpUrl(url);
      const host = href ? hostLabel(href) : "";
      if (host) hosts.add(host);
    }
  }
  return { issue: latest.number, date: latest.date, stories: stories.length, sources: hosts.size };
}
