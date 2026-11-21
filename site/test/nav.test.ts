import { describe, expect, it } from "vitest";
import { earlierStories, type Edition } from "../src/lib/editions";
import { GHOST_LIMIT, GHOST_FEW, navSection, signalLevel } from "../src/lib/nav";
import type { PublicStory } from "../src/lib/schema";

describe("navSection", () => {
  const latest = "2026-11-20";
  it("marks the page itself on the four stations", () => {
    expect(navSection("tr", "/", latest)).toEqual({ section: "today", exact: true });
    expect(navSection("tr", "/arsiv/", latest)).toEqual({ section: "archive", exact: true });
    expect(navSection("en", "/en/week/", latest)).toEqual({ section: "week", exact: true });
    expect(navSection("en", "/en/about/", latest)).toEqual({ section: "about", exact: true });
  });

  it("puts the newest edition under today, older ones and topics under the archive, a week under the weeks", () => {
    expect(navSection("tr", "/2026-11-20/", latest)).toEqual({ section: "today", exact: false });
    expect(navSection("en", "/en/2026-11-18/", latest)).toEqual({ section: "archive", exact: false });
    expect(navSection("tr", "/konu/model/", latest)).toEqual({ section: "archive", exact: false });
    expect(navSection("en", "/en/topic/security/", latest)).toEqual({ section: "archive", exact: false });
    expect(navSection("tr", "/hafta/2026-W47/", latest)).toEqual({ section: "week", exact: false });
  });

  it("leaves the subscribe page and the 404 page off the dial", () => {
    expect(navSection("tr", "/abone/", latest)).toBeNull();
    expect(navSection("en", "/en/subscribe/", latest)).toBeNull();
    expect(navSection("tr", "/404.html", latest)).toBeNull();
    expect(navSection("tr", "/2026-11-20/", null)).toEqual({ section: "archive", exact: false });
  });
});

describe("signalLevel", () => {
  it("is one bar for one source (or none), two for 2–3, three for 4 and more", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(signalLevel)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });
});

const uidOf = (n: number) => n.toString(16).padStart(32, "0");
const story = (n: number): PublicStory => ({
  uid: uidOf(n),
  category: "model",
  publish_mode: "auto",
  edited: false,
  source_count: 1,
  source_url: "https://example.com/a",
  sources: [],
  try_url: null,
  created_at: "2026-11-01T00:00:00Z",
  published_at: "2026-11-01T00:00:00Z",
  texts: { tr: { title: `t${n}`, summary: "s", dev_line: "d" } },
});
const edition = (date: string, ...ns: number[]): Edition => ({ date, number: 0, stories: ns.map(story) });

describe("earlierStories", () => {
  // Newest first, as buildEditions returns them.
  const editions = [
    edition("2026-11-20", 1, 2),
    edition("2026-11-19", 3, 4, 5),
    edition("2026-11-15", 6, 7, 8, 9, 10),
    edition("2026-11-13", 11, 12),
    edition("2026-11-12", 13),
  ];

  it("takes the previous editions of the last seven days, newest first, with their dates", () => {
    const ghosts = earlierStories(editions, editions[0], GHOST_FEW, GHOST_LIMIT);
    expect(ghosts.map((g) => g.story.uid)).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map(uidOf));
    expect(ghosts[0].date).toBe("2026-11-19");
    expect(ghosts[3].date).toBe("2026-11-15");
  });

  it("never takes more than eight, nor anything older than seven days or from a later day", () => {
    const ghosts = earlierStories(editions, editions[2], GHOST_FEW, GHOST_LIMIT);
    expect(ghosts).toHaveLength(0);
    const fromThirteenth = earlierStories(editions, editions[3], GHOST_FEW, GHOST_LIMIT);
    expect(fromThirteenth.map((g) => g.date)).toEqual(["2026-11-12"]);
    expect(GHOST_LIMIT).toBe(8);
  });

  it("adds nothing to an edition of five or more stories", () => {
    expect(GHOST_FEW).toBe(5);
    expect(earlierStories(editions, editions[1], 3, GHOST_LIMIT)).toHaveLength(0);
    // editions[2] has five stories.
    expect(earlierStories([edition("2026-11-16", 20, 21, 22, 23, 24), ...editions.slice(2)], edition("2026-11-16", 20, 21, 22, 23, 24), GHOST_FEW, GHOST_LIMIT)).toHaveLength(0);
  });
});
