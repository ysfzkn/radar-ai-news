import { describe, expect, it } from "vitest";
import { routes, storyLink } from "../src/lib/routes";

const addresses = (r: (typeof routes)["tr"]) => [
  r.home,
  r.edition("2026-11-20"),
  r.archive,
  r.topic("protocol"),
  r.weekIndex,
  r.week("2026-W47"),
  r.method,
  r.rss,
];

describe("routes", () => {
  it("returns the documented addresses for both languages", () => {
    expect(addresses(routes.tr)).toEqual([
      "/",
      "/2026-11-20/",
      "/arsiv/",
      "/konu/protocol/",
      "/hafta/",
      "/hafta/2026-W47/",
      "/yontem/",
      "/rss.xml",
    ]);
    expect(addresses(routes.en)).toEqual([
      "/en/",
      "/en/2026-11-20/",
      "/en/archive/",
      "/en/topic/protocol/",
      "/en/week/",
      "/en/week/2026-W47/",
      "/en/method/",
      "/en/rss.xml",
    ]);
  });

  it("links a story to its edition and anchor", () => {
    const uid = "0123456789abcdef0123456789abcdef";
    expect(storyLink("tr", "2026-11-20", uid)).toBe("/2026-11-20/#s-01234567");
    expect(storyLink("en", "2026-11-20", uid)).toBe("/en/2026-11-20/#s-01234567");
  });
});
