import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStories, type PublicStory } from "./schema";

export interface SiteData {
  stories: PublicStory[];
  demo: boolean;
}

// Astro bundles pages into dist/, so import.meta.url cannot locate the project.
// Every npm script runs from site/, which makes the working directory the root.
const fetchedFile = resolve(process.cwd(), ".data/stories.json");
const fixtureFile = resolve(process.cwd(), "fixtures/stories.json");

function readStories(path: string): PublicStory[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const list =
    typeof parsed === "object" && parsed !== null && "stories" in parsed ? parsed.stories : null;
  return parseStories(list);
}

/**
 * Where the build gets its stories: RADAR_STORIES_FILE, then the file the fetch
 * script wrote, then the demo fixture. Whatever is read is always validated.
 */
export function loadData(): SiteData {
  const override = process.env.RADAR_STORIES_FILE;
  if (override) return { stories: readStories(override), demo: false };
  if (existsSync(fetchedFile)) return { stories: readStories(fetchedFile), demo: false };
  return { stories: readStories(fixtureFile), demo: true };
}
