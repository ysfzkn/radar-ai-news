import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { COPY } from "../src/lib/copy";

// These tests read the files of finished builds. beforeAll runs three builds one
// after another (never concurrently): the demo fixture, a hostile file, an empty file.
const root = resolve(import.meta.dirname, "..");
const astro = join(root, "node_modules", "astro", "bin", "astro.mjs");
const DEMO = join(root, "dist");
const HOSTILE = join(root, "dist-hostile");
const EMPTY = join(root, "dist-empty");
const DEMO_DATES = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];

function build(outDir: string, storiesFile?: string): void {
  const env = { ...process.env };
  delete env.RADAR_STORIES_FILE;
  if (storiesFile) env.RADAR_STORIES_FILE = storiesFile;
  execFileSync(process.execPath, [astro, "build", "--outDir", outDir], {
    cwd: root,
    env,
    stdio: "pipe",
  });
}

beforeAll(() => {
  if (existsSync(join(root, ".data", "stories.json"))) {
    throw new Error("site/.data/stories.json exists; the demo build needs it gone");
  }
  build(DEMO);
  build(HOSTILE, "test/fixtures/hostile.json");
  build(EMPTY, "test/fixtures/empty.json");
}, 300_000);

const page = (dir: string, path: string) => readFileSync(join(dir, path, "index.html"), "utf8");

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".html"))
    .map((name) => join(dir, name));
}

/** Visible text of an HTML fragment: tags dropped, entities for &, <, >, quotes decoded. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function h1(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return match ? text(match[1]) : "";
}

function articles(html: string): string[] {
  return [...html.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0]);
}

describe("built site", () => {
  it("the Turkish home page is edition 4 with five articles and the künye `Sayı 4 · 20 Kasım 2026 Cuma · 5 haber`", () => {
    const home = page(DEMO, "");
    expect(home).toMatch(/<html lang="tr"/);
    expect(h1(home)).toContain("Sayı 4 · 20 Kasım 2026 Cuma · 5 haber");
    expect(articles(home)).toHaveLength(5);
    expect(home).toMatch(/<title>Sayı 4 · 20 Kasım 2026 · Radar<\/title>/);
    expect(home).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/">/);
  });

  it("the English home page has `Issue 4 · Friday, 20 November 2026 · 5 stories` and lang=en", () => {
    const home = page(DEMO, "en");
    expect(home).toMatch(/<html lang="en"/);
    expect(h1(home)).toContain("Issue 4 · Friday, 20 November 2026 · 5 stories");
    expect(articles(home)).toHaveLength(5);
    expect(home).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/en\/">/);
  });

  it("every edition has a page in both languages and links to the previous one", () => {
    DEMO_DATES.forEach((date, i) => {
      for (const prefix of ["", "en/"] as const) {
        const html = page(DEMO, prefix + date);
        expect(h1(html)).toContain(prefix ? `Issue ${i + 1}` : `Sayı ${i + 1}`);
        expect(html).toContain(`<link rel="canonical" href="https://`);
        expect(html).toMatch(new RegExp(`rel="canonical" href="https://[^"]+/${prefix}${date}/"`));
        if (i > 0) expect(html).toContain(`href="/${prefix}${DEMO_DATES[i - 1]}/"`);
        else expect(text(html)).not.toContain(prefix ? "Previous issue" : "Önceki sayı");
        if (i < DEMO_DATES.length - 1) expect(html).toContain(`href="/${prefix}${DEMO_DATES[i + 1]}/"`);
        else expect(text(html)).not.toContain(prefix ? "Next issue" : "Sonraki sayı");
      }
    });
    expect(page(DEMO, "")).toContain(`href="/2026-11-19/"`);
    expect(text(page(DEMO, ""))).not.toContain("Sonraki sayı");
  });

  it("each article has the label, the developer line, a source link with rel noopener and the echo meter's aria-label", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"]] as const) {
      for (const article of articles(page(DEMO, path))) {
        expect(article).toMatch(/<article id="s-[0-9a-f]{8}"/);
        expect(article).toMatch(/<h2[^>]*>/);
        expect(text(article)).toContain(COPY[lang].forDevelopers);
        expect(article).toMatch(/<a [^>]*href="https:\/\/[^"]+"[^>]*rel="noopener"/);
        expect(article).toMatch(/role="img" aria-label="[^"]*"/);
        const label = article.match(/aria-label="([^"]*)"/)![1];
        expect(label).toMatch(lang === "tr" ? /^5 üzerinden [1-5]: \d+ bağımsız kaynak$/ : /^[1-5] of 5: /);
        expect(text(article)).toMatch(lang === "tr" ? /\d+ kaynak/ : /\d+ sources?/);
        expect(text(article)).toMatch(new RegExp(Object.values(COPY[lang].label).join("|")));
      }
    }
  });

  it("an auto-published story says `otomatik yayımlandı` and a human-approved one `insan onayladı`", () => {
    const home = articles(page(DEMO, ""));
    const human = home.filter((a) => a.includes('id="s-4b06d152"'));
    expect(human).toHaveLength(1);
    expect(text(human[0])).toContain("AI yazdı · insan onayladı");
    const auto = home.filter((a) => a.includes('id="s-5c17e263"'));
    expect(text(auto[0])).toContain("AI yazdı · otomatik yayımlandı");
  });

  it("no page contains <script, <style or a style attribute", () => {
    const files = [DEMO, HOSTILE, EMPTY].flatMap(htmlFiles);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const html = readFileSync(file, "utf8");
      expect(html, file).not.toMatch(/<script/i);
      expect(html, file).not.toMatch(/<style/i);
      expect(html, file).not.toMatch(/<[^>]*\sstyle\s*=/i);
    }
  });

  it("the demo banner is on every demo page and on no page built from a real file", () => {
    const demoPages = htmlFiles(DEMO);
    expect(demoPages.length).toBeGreaterThanOrEqual(10);
    for (const file of demoPages) {
      const html = text(readFileSync(file, "utf8"));
      expect(html, file).toMatch(new RegExp(`${COPY.tr.demo}|${COPY.en.demo}`));
    }
    for (const file of [...htmlFiles(HOSTILE), ...htmlFiles(EMPTY)]) {
      const html = text(readFileSync(file, "utf8"));
      expect(html, file).not.toContain(COPY.tr.demo);
      expect(html, file).not.toContain(COPY.en.demo);
    }
  });

  it("hostile text is escaped and never appears raw", () => {
    // The hostile story only has English text, so it lives on the English pages.
    const en = page(HOSTILE, "en");
    expect(en).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    for (const file of htmlFiles(HOSTILE)) {
      const html = readFileSync(file, "utf8");
      expect(html, file).not.toContain("<script>alert(1)");
      expect(html, file).not.toMatch(/<img[^>]*onerror/i);
      expect(html, file).not.toMatch(/<[^>]*\sonerror\s*=/i);
      expect(html, file).not.toMatch(/<[^>]*\sonmouseover\s*=/i);
    }
  });

  it("with no stories the home page shows `Henüz baskı yok.` and the build succeeds", () => {
    expect(text(page(EMPTY, ""))).toContain("Henüz baskı yok.");
    expect(text(page(EMPTY, "en"))).toContain("No edition yet.");
    expect(articles(page(EMPTY, ""))).toHaveLength(0);
  });

  it("Turkish and English pages point at each other with hreflang", () => {
    const tr = page(DEMO, "");
    const en = page(DEMO, "en");
    for (const html of [tr, en]) {
      expect(html).toMatch(/<link rel="alternate" hreflang="tr" href="https:\/\/[^"]+\/">/);
      expect(html).toMatch(/<link rel="alternate" hreflang="en" href="https:\/\/[^"]+\/en\/">/);
    }
    const trEdition = page(DEMO, "2026-11-18");
    expect(trEdition).toMatch(/hreflang="en" href="https:\/\/[^"]+\/en\/2026-11-18\/"/);
    // An edition that exists in one language only has no hreflang pair.
    expect(page(HOSTILE, "en/2026-11-20")).not.toMatch(/<link rel="alternate" hreflang=/);
  });
});
