import type { Lang } from "./schema";
import { anchorId } from "./editions";

interface Routes {
  home: string;
  edition(date: string): string;
  archive: string;
  topic(category: string): string;
  weekIndex: string;
  week(id: string): string;
  /** Künye / About: who makes Radar and how a story is made. */
  about: string;
  /** How to follow Radar: the RSS feed. */
  subscribe: string;
  rss: string;
}

/** Every address on the site; all end with "/" except the feeds. */
export const routes: Record<Lang, Routes> = {
  tr: {
    home: "/",
    edition: (date) => `/${date}/`,
    archive: "/arsiv/",
    topic: (category) => `/konu/${category}/`,
    weekIndex: "/hafta/",
    week: (id) => `/hafta/${id}/`,
    about: "/kunye/",
    subscribe: "/abone/",
    rss: "/rss.xml",
  },
  en: {
    home: "/en/",
    edition: (date) => `/en/${date}/`,
    archive: "/en/archive/",
    topic: (category) => `/en/topic/${category}/`,
    weekIndex: "/en/week/",
    week: (id) => `/en/week/${id}/`,
    about: "/en/about/",
    subscribe: "/en/subscribe/",
    rss: "/en/rss.xml",
  },
};

export function storyLink(lang: Lang, date: string, uid: string): string {
  return `${routes[lang].edition(date)}#${anchorId(uid)}`;
}

/** The attributes of every link that leaves the site: a new tab, no opener, no referrer. */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The owner's addresses, linked from the top strip, the footer and the Künye page. */
export const OWNER = {
  site: "https://ozkanyusuf.com",
  github: "https://github.com/ysfzkn",
  repository: "https://github.com/ysfzkn/radar-ai-news",
  issues: "https://github.com/ysfzkn/radar-ai-news/issues",
} as const;
