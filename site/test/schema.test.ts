import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStories } from "../src/lib/schema";

const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const fixture = () => read("../fixtures/stories.json");
const firstStory = () => fixture().stories[0];

describe("parseStories", () => {
  it("accepts the demo fixture and returns 14 stories", () => {
    expect(parseStories(fixture().stories)).toHaveLength(14);
  });

  it("accepts the hostile and empty fixtures", () => {
    expect(parseStories(read("./fixtures/hostile.json").stories)).toHaveLength(1);
    expect(parseStories(read("./fixtures/empty.json").stories)).toEqual([]);
  });

  it("rejects a javascript: try_url, a non-http source url, an unknown category, a bad uid, an empty title and a duplicate uid", () => {
    const bad: Record<string, (s: any) => unknown> = {
      "javascript try_url": (s) => [{ ...s, try_url: "javascript:alert(1)" }],
      "non-http source url": (s) => [
        { ...s, sources: [{ name: "x", url: "ftp://example.com/a" }] },
      ],
      "non-http source_url": (s) => [{ ...s, source_url: "data:text/html,x" }],
      "unknown category": (s) => [{ ...s, category: "gossip" }],
      "uppercase uid": (s) => [{ ...s, uid: s.uid.toUpperCase() }],
      "short uid": (s) => [{ ...s, uid: "abc123" }],
      "empty title": (s) => [
        { ...s, texts: { tr: { ...s.texts.tr, title: "" } } },
      ],
      "no language": (s) => [{ ...s, texts: {} }],
      "bad timestamp": (s) => [{ ...s, published_at: "yesterday" }],
      "unknown publish_mode": (s) => [{ ...s, publish_mode: "robot" }],
      "zero source_count": (s) => [{ ...s, source_count: 0 }],
      "duplicate uid": (s) => [s, { ...s }],
      "not an array": () => ({ stories: [] }),
    };
    for (const [name, make] of Object.entries(bad)) {
      expect(() => parseStories(make(firstStory())), name).toThrow();
    }
  });

  it("accepts a story with only Turkish texts", () => {
    const story = { ...firstStory() };
    story.texts = { tr: story.texts.tr };
    const [parsed] = parseStories([story]);
    expect(parsed.texts.en).toBeUndefined();
    expect(parsed.texts.tr?.title).toBe(story.texts.tr.title);
  });

  it("accepts empty sources and a null try_url", () => {
    const [parsed] = parseStories([{ ...firstStory(), sources: [], try_url: null }]);
    expect(parsed.sources).toEqual([]);
    expect(parsed.try_url).toBeNull();
  });
});
