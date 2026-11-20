import rss from "@astrojs/rss";
import { COPY } from "./copy";
import { loadData } from "./data";
import { forLang, istanbulDate } from "./editions";
import { routes, storyLink } from "./routes";
import type { Lang } from "./schema";

const FEED_LIMIT = 50;

/** The RSS response for one language: its newest 50 stories, links absolute on `site`. */
export function feed(lang: Lang, site: URL | undefined): Promise<Response> {
  if (!site) throw new Error("the feed needs `site` in astro.config.mjs");
  const copy = COPY[lang];
  const newest = forLang(loadData().stories, lang)
    .sort((a, b) =>
      a.published_at === b.published_at ? (a.uid < b.uid ? -1 : 1) : a.published_at < b.published_at ? 1 : -1,
    )
    .slice(0, FEED_LIMIT);
  return rss({
    title: copy.feedTitle,
    description: copy.feedDescription,
    site: new URL(routes[lang].home, site).href,
    items: newest.map((story) => {
      const text = story.texts[lang]!;
      return {
        title: text.title,
        link: new URL(storyLink(lang, istanbulDate(story.published_at), story.uid), site).href,
        pubDate: new Date(story.published_at),
        description: `${text.summary}\n\n${copy.forDevelopers} ${text.dev_line}`,
        // @astrojs/rss makes the guid from the link; the uid is the stable identity.
        // A uid is 32 hex characters (the schema checks it), so it is safe inside XML.
        customData: `<guid isPermaLink="false">${story.uid}</guid>`,
      };
    }),
  });
}
