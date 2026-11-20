import { describe, expect, it } from "vitest";
import { routes, storyLink } from "../src/lib/routes";

const addresses = (r: (typeof routes)["tr"]) => [
  r.home,
  r.edition("2026-11-20"),
  r.archive,
  r.topic("protocol"),
  r.weekIndex,
  r.week("2026-W47"),
  r.about,
  r.subscribe,
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
      "/kunye/",
      "/abone/",
      "/rss.xml",
    ]);
    expect(addresses(routes.en)).toEqual([
      "/en/",
      "/en/2026-11-20/",
      "/en/archive/",
      "/en/topic/protocol/",
      "/en/week/",
      "/en/week/2026-W47/",
      "/en/about/",
      "/en/subscribe/",
      "/en/rss.xml",
    ]);
  });

  it("routes: about and subscribe exist in both languages and method is gone", () => {
    expect(routes.tr.about).toBe("/kunye/");
    expect(routes.en.about).toBe("/en/about/");
    expect(routes.tr.subscribe).toBe("/abone/");
    expect(routes.en.subscribe).toBe("/en/subscribe/");
    for (const lang of ["tr", "en"] as const) expect(Object.keys(routes[lang])).not.toContain("method");
  });

  it("links a story to its edition and anchor", () => {
    const uid = "0123456789abcdef0123456789abcdef";
    expect(storyLink("tr", "2026-11-20", uid)).toBe("/2026-11-20/#s-01234567");
    expect(storyLink("en", "2026-11-20", uid)).toBe("/en/2026-11-20/#s-01234567");
  });
});
