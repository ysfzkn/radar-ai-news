import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_PAGES = 200;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function apiOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("RADAR_API_URL must be set to the Worker origin, e.g. https://api.example.com");
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("RADAR_API_URL must be https:// (http:// is only allowed on localhost)");
  }
  return url.origin;
}

/**
 * Reads every page of published stories from the Worker, following `next`.
 * `fetchImpl` is injected so tests never touch the network.
 *
 * @param {string | undefined} apiUrl
 * @param {(url: string, init?: RequestInit) => Promise<Response>} [fetchImpl]
 * @returns {Promise<unknown[]>}
 */
export async function fetchAllStories(apiUrl, fetchImpl = fetch) {
  const origin = apiOrigin(apiUrl);
  const stories = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let url = `${origin}/api/stories?limit=200`;
    if (cursor !== null) url += `&cursor=${encodeURIComponent(cursor)}`;
    const response = await fetchImpl(url, { redirect: "error" });
    if (response.status !== 200) {
      throw new Error(`stories request answered ${response.status}`);
    }
    const body = await response.json();
    if (typeof body !== "object" || body === null || !Array.isArray(body.stories)) {
      throw new Error("stories response has no `stories` array");
    }
    if (body.next !== null && typeof body.next !== "string") {
      throw new Error("stories response has an invalid `next`");
    }
    stories.push(...body.stories);
    if (body.next === null) return stories;
    cursor = body.next;
  }
  throw new Error(`more than ${MAX_PAGES} pages of stories; refusing to continue`);
}

/**
 * Removes `file` first, then fetches every story and writes it back. After a failed
 * fetch no older file is left behind, so a later plain build falls back to the demo
 * data and its banner instead of quietly using stale stories.
 *
 * @param {string} file
 * @param {string | undefined} apiUrl
 * @param {(url: string, init?: RequestInit) => Promise<Response>} [fetchImpl]
 * @returns {Promise<number>} the number of stories written
 */
export async function refreshStoriesFile(file, apiUrl, fetchImpl = fetch) {
  rmSync(file, { force: true });
  const stories = await fetchAllStories(apiUrl, fetchImpl);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ stories }, null, 2) + "\n");
  return stories.length;
}

async function main() {
  const file = fileURLToPath(new URL("../.data/stories.json", import.meta.url));
  const count = await refreshStoriesFile(file, process.env.RADAR_API_URL);
  console.log(`Fetched ${count} stories.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
