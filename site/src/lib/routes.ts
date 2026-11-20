import type { Lang } from "./schema";
import { anchorId } from "./editions";

interface Routes {
  home: string;
  edition(date: string): string;
  archive: string;
  topic(category: string): string;
  weekIndex: string;
  week(id: string): string;
  method: string;
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
    method: "/yontem/",
    rss: "/rss.xml",
  },
  en: {
    home: "/en/",
    edition: (date) => `/en/${date}/`,
    archive: "/en/archive/",
    topic: (category) => `/en/topic/${category}/`,
    weekIndex: "/en/week/",
    week: (id) => `/en/week/${id}/`,
    method: "/en/method/",
    rss: "/en/rss.xml",
  },
};

export function storyLink(lang: Lang, date: string, uid: string): string {
  return `${routes[lang].edition(date)}#${anchorId(uid)}`;
}
