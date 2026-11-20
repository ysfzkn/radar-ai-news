import { afterEach, describe, expect, it } from "vitest";
import { loadData } from "../src/lib/data";

const saved = { demo: process.env.RADAR_DEMO, file: process.env.RADAR_STORIES_FILE };

afterEach(() => {
  for (const [key, value] of [["RADAR_DEMO", saved.demo], ["RADAR_STORIES_FILE", saved.file]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("loadData", () => {
  it("RADAR_DEMO=1 wins over a present RADAR_STORIES_FILE and gives the demo fixture", () => {
    process.env.RADAR_STORIES_FILE = "test/fixtures/hostile.json";
    delete process.env.RADAR_DEMO;
    const named = loadData();
    expect(named.demo).toBe(false);

    process.env.RADAR_DEMO = "1";
    const demo = loadData();
    expect(demo.demo).toBe(true);
    expect(demo.stories.length).toBeGreaterThan(named.stories.length);
    expect(demo.stories.map((s) => s.uid)).not.toEqual(named.stories.map((s) => s.uid));
  });
});
