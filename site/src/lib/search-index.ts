import { anchorId, istanbulDate } from "./editions";
import { routes } from "./routes";
import type { SearchDoc } from "./search";
import type { Lang, PublicStory } from "./schema";

/** `search-<lang>.json`: one doc per story that has that language, newest first. */
export function searchIndex(stories: PublicStory[], lang: Lang): { version: 1; docs: SearchDoc[] } {
  const docs: SearchDoc[] = [];
  for (const story of stories) {
    const text = story.texts[lang];
    if (!text) continue;
    const d = istanbulDate(story.published_at);
    docs.push({
      u: `${routes[lang].edition(d)}#${anchorId(story.uid)}`,
      d,
      c: story.category,
      n: story.source_count,
      t: text.title,
      s: text.summary,
    });
  }
  docs.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  return { version: 1, docs };
}
