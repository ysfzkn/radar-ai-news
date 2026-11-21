import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  anchorId,
  buildEditions,
  buildWeeks,
  byCategory,
  echoLevel,
  forLang,
  istanbulDate,
  readingMinutes,
  topicGroups,
} from "../src/lib/editions";
import { parseStories, type PublicStory } from "../src/lib/schema";

const demo = () =>
  parseStories(
    JSON.parse(readFileSync(new URL("../fixtures/stories.json", import.meta.url), "utf8"))
      .stories,
  );

const uidOf = (n: number) => n.toString(16).padStart(32, "0");

function story(n: number, publishedAt: string, sourceCount = 1, words = 3): PublicStory {
  const text = { title: "w ".repeat(words).trim(), summary: "", dev_line: "" };
  return {
    uid: uidOf(n),
    category: "protocol",
    publish_mode: "auto",
    edited: false,
    source_count: sourceCount,
    source_url: "https://example.com/a",
    sources: [],
    try_url: null,
    created_at: publishedAt,
    published_at: publishedAt,
    texts: { tr: text, en: text },
  };
}

describe("istanbulDate", () => {
  it("puts a story published at 21:30 UTC in the next Istanbul day", () => {
    expect(istanbulDate("2026-11-19T21:30:00.000Z")).toBe("2026-11-20");
    expect(istanbulDate("2026-11-19T20:59:59.000Z")).toBe("2026-11-19");
    expect(istanbulDate("2026-12-31T21:00:00.000Z")).toBe("2027-01-01");
  });
});

describe("buildEditions", () => {
  it("builds 4 editions from the demo fixture, newest first, numbered 4, 3, 2, 1 with 5, 2, 4, 3 stories", () => {
    const editions = buildEditions(demo());
    expect(editions.map((e) => e.date)).toEqual([
      "2026-11-20",
      "2026-11-19",
      "2026-11-18",
      "2026-11-17",
    ]);
    expect(editions.map((e) => e.number)).toEqual([4, 3, 2, 1]);
    expect(editions.map((e) => e.stories.length)).toEqual([5, 2, 4, 3]);
  });

  it("orders an edition by source count, then publish time, then uid", () => {
    const list = [
      story(3, "2026-11-20T08:00:00.000Z", 2),
      story(2, "2026-11-20T07:00:00.000Z", 2),
      story(1, "2026-11-20T09:00:00.000Z", 5),
      story(4, "2026-11-20T07:00:00.000Z", 2),
    ];
    const [edition] = buildEditions(list);
    expect(edition.stories.map((s) => s.uid)).toEqual([uidOf(1), uidOf(2), uidOf(4), uidOf(3)]);
  });

  it("gives no edition and no week for an empty list", () => {
    expect(buildEditions([])).toEqual([]);
    expect(buildWeeks([])).toEqual([]);
  });

  it("renumbers when the only story of a day is removed", () => {
    const without = demo().filter((s) => istanbulDate(s.published_at) !== "2026-11-19");
    const editions = buildEditions(without);
    expect(editions.map((e) => e.date)).toEqual(["2026-11-20", "2026-11-18", "2026-11-17"]);
    expect(editions.map((e) => e.number)).toEqual([3, 2, 1]);
  });
});

describe("forLang", () => {
  it("drops a story with no English text from the English list only", () => {
    const list = [story(1, "2026-11-20T08:00:00.000Z"), story(2, "2026-11-20T09:00:00.000Z")];
    delete list[1].texts.en;
    expect(forLang(list, "en").map((s) => s.uid)).toEqual([uidOf(1)]);
    expect(forLang(list, "tr")).toHaveLength(2);
  });
});

describe("buildWeeks", () => {
  it("puts 2027-01-01 in week 2026-W53 and 2026-12-28 in 2026-W53", () => {
    const weeks = buildWeeks([
      story(1, "2027-01-01T09:00:00.000Z"),
      story(2, "2026-12-28T09:00:00.000Z"),
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ id: "2026-W53", from: "2026-12-28", to: "2027-01-03" });
    expect(weeks[0].stories).toHaveLength(2);
  });

  it("puts the demo fixture in week 2026-W47, Monday to Sunday", () => {
    const weeks = buildWeeks(demo());
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ id: "2026-W47", from: "2026-11-16", to: "2026-11-22" });
  });

  it("lists weeks newest first", () => {
    const weeks = buildWeeks([
      story(1, "2026-11-10T09:00:00.000Z"),
      story(2, "2026-11-20T09:00:00.000Z"),
    ]);
    expect(weeks.map((w) => w.id)).toEqual(["2026-W47", "2026-W46"]);
  });

  it("a week keeps at most 10 stories, most sources first", () => {
    const list = Array.from({ length: 12 }, (_, i) =>
      story(i + 1, "2026-11-18T09:00:00.000Z", i + 1),
    );
    const [week] = buildWeeks(list);
    expect(week.stories).toHaveLength(10);
    expect(week.stories.map((s) => s.source_count)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });
});

describe("byCategory", () => {
  it("groups newest first and keeps at most 30 per category", () => {
    const day = (i: number) => `2026-10-${String((i % 28) + 1).padStart(2, "0")}T09:00:00.000Z`;
    const list = Array.from({ length: 35 }, (_, i) => story(i + 1, day(i)));
    list.push({ ...story(99, "2026-11-25T09:00:00.000Z"), category: "model" });
    const groups = byCategory(list);
    const protocol = groups.get("protocol")!;
    expect(protocol).toHaveLength(30);
    expect(groups.get("model")).toHaveLength(1);
    const times = protocol.map((s) => s.published_at);
    expect([...times].sort().reverse()).toEqual(times);
    // the five oldest of the 35 are the ones cut
    expect(times).not.toContain("2026-10-01T09:00:00.000Z");
  });
});

describe("echoLevel", () => {
  it("clamps 0, 1, 5 and 12 to 1, 1, 5 and 5", () => {
    expect([0, 1, 5, 12].map(echoLevel)).toEqual([1, 1, 5, 5]);
  });
});

describe("readingMinutes", () => {
  it("is 1 for one short story and 3 for 401 to 600 words", () => {
    const at = "2026-11-20T09:00:00.000Z";
    expect(readingMinutes([story(1, at)], "en")).toBe(1);
    expect(readingMinutes([], "en")).toBe(1);
    expect(readingMinutes([story(1, at, 1, 401)], "tr")).toBe(3);
    expect(readingMinutes([story(1, at, 1, 600)], "tr")).toBe(3);
    expect(readingMinutes([story(1, at, 1, 601)], "tr")).toBe(4);
  });

  it("counts only the requested language", () => {
    const s = story(1, "2026-11-20T09:00:00.000Z", 1, 401);
    delete s.texts.en;
    expect(readingMinutes([s], "en")).toBe(1);
  });
});

describe("anchorId", () => {
  it("is s- plus the first 8 characters", () => {
    expect(anchorId("0123456789abcdef0123456789abcdef")).toBe("s-01234567");
  });
});

describe("topicGroups", () => {
  it("groups an edition by topic in the order the topics first come, each story keeping its number", () => {
    const at = "2026-11-20T06:00:00Z";
    const of = (n: number, category: PublicStory["category"]) => ({ ...story(n, at), category });
    const groups = topicGroups([of(1, "model"), of(2, "security"), of(3, "model"), of(4, "policy"), of(5, "security")]);
    expect(groups.map((g) => g.category)).toEqual(["model", "security", "policy"]);
    expect(groups.map((g) => g.items.map((item) => item.n))).toEqual([[1, 3], [2, 5], [4]]);
    expect(groups[0].items[1].story.uid).toBe(uidOf(3));
    expect(topicGroups([])).toEqual([]);
  });
});
