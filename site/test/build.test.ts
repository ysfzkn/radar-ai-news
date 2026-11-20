import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { COPY } from "../src/lib/copy";
import { CATEGORIES } from "../src/lib/schema";

// These tests read the files of finished builds. beforeAll runs four builds one after
// another (never concurrently): the demo fixture, a hostile file, an empty file, and the
// demo fixture's stories read as real data (so feeds and pages are built without the demo marks).
const root = resolve(import.meta.dirname, "..");
const astro = join(root, "node_modules", "astro", "bin", "astro.mjs");
const DEMO = join(root, "dist");
const HOSTILE = join(root, "dist-hostile");
const EMPTY = join(root, "dist-empty");
const REAL = join(root, "dist-real");
// The configured site, as astro.config.mjs reads it; the builds inherit this environment.
const SITE = process.env.SITE_URL || "https://radar.ozkanyusuf.com";
const DEMO_DATES =["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];

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
  build(REAL, "fixtures/stories.json");
}, 400_000);

const page = (dir: string, path: string) => readFileSync(join(dir, path, "index.html"), "utf8");

function allFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function htmlFiles(dir: string): string[] {
  return allFiles(dir).filter((name) => name.endsWith(".html"));
}

/**
 * A small well-formedness check, enough for a generated feed: one XML declaration,
 * tags that nest and close, no stray `<` or `&` in text or attributes, and no
 * character that XML 1.0 forbids (C0 controls other than tab, LF, CR; U+FFFE, U+FFFF).
 */
function wellFormed(xml: string): boolean {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return false;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(xml)) return false;
  const body = xml.slice(xml.indexOf("?>") + 2);
  const stack: string[] = [];
  const token = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  for (const m of body.matchAll(token)) {
    const [, closing, name, attrs, selfClosing, chars, stray] = m;
    if (stray) return false;
    const textPart = chars ?? attrs ?? "";
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(textPart)) return false;
    if (chars !== undefined) {
      if (stack.length === 0 && chars.trim()) return false;
    } else if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

const items = (xml: string) => [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => m[0]);

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
    // A funding figure always goes to a person, so the demo funding story is human-approved.
    const funding = articles(page(DEMO, "2026-11-18")).filter((a) => a.includes('id="s-07c29d1e"'));
    expect(funding).toHaveLength(1);
    expect(text(funding[0])).toContain("AI yazdı · insan onayladı");
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
    for (const file of [HOSTILE, EMPTY, REAL].flatMap(htmlFiles)) {
      const html = text(readFileSync(file, "utf8"));
      expect(html, file).not.toContain(COPY.tr.demo);
      expect(html, file).not.toContain(COPY.en.demo);
    }
  });

  it("every demo page is marked noindex and no page built from a real file is", () => {
    const noindex = '<meta name="robots" content="noindex">';
    const demoPages = htmlFiles(DEMO);
    expect(demoPages.length).toBeGreaterThanOrEqual(10);
    for (const file of demoPages) expect(readFileSync(file, "utf8"), file).toContain(noindex);
    for (const file of [HOSTILE, EMPTY, REAL].flatMap(htmlFiles)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/<meta name="robots"/);
    }
  });

  it("the demo build's feeds have zero items and say they are demo data", () => {
    for (const [file, lang] of [["rss.xml", "tr"], ["en/rss.xml", "en"]] as const) {
      const xml = readFileSync(join(DEMO, file), "utf8");
      expect(wellFormed(xml), file).toBe(true);
      expect(items(xml), file).toHaveLength(0);
      const channelTitle = `${COPY[lang].demoShort} · ${COPY[lang].feedTitle}`.replace(/'/g, "&apos;");
      expect(xml, file).toContain(`<title>${channelTitle}</title>`);
      expect(xml, file).toContain(`<description>${COPY[lang].demo}</description>`);
    }
    for (const dir of [REAL, HOSTILE]) {
      for (const [file, lang] of [["rss.xml", "tr"], ["en/rss.xml", "en"]] as const) {
        const xml = readFileSync(join(dir, file), "utf8");
        expect(items(xml).length, `${dir} ${file}`).toBeGreaterThan(0);
        expect(xml, `${dir} ${file}`).not.toContain(COPY[lang].demoShort);
        expect(xml, `${dir} ${file}`).not.toContain(COPY[lang].demo);
      }
    }
  });

  it("hostile text is escaped and never appears raw", () => {
    // The hostile story has the same strings in Turkish and English, so both home pages carry it.
    for (const path of ["", "en"]) {
      const html = page(HOSTILE, path);
      expect(html, path).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html, path).toContain("&lt;/p&gt;&lt;img src=x onerror=alert(1)&gt;");
    }
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
    expect(page(HOSTILE, "en/2026-11-19")).not.toMatch(/<link rel="alternate" hreflang=/);
    expect(page(HOSTILE, "en/2026-11-20")).toMatch(/<link rel="alternate" hreflang="tr"/);
  });

  it("the archive lists 4 editions newest first, each linking to its page", () => {
    for (const [path, prefix, lang] of [["arsiv", "", "tr"], ["en/archive", "en/", "en"]] as const) {
      const html = page(DEMO, path);
      const rows = [...html.matchAll(/<a class="row" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      expect(rows.map((m) => m[1])).toEqual([...DEMO_DATES].reverse().map((d) => `/${prefix}${d}/`));
      expect(text(rows[0][2])).toBe(
        lang === "tr" ? "Sayı 4 20 Kasım 2026 Cuma 5 haber" : "Issue 4 Friday, 20 November 2026 5 stories",
      );
      expect(text(rows[3][2])).toContain(lang === "tr" ? "Sayı 1" : "Issue 1");
      expect(text(html)).toContain(lang === "tr" ? "Kasım 2026" : "November 2026");
    }
  });

  it("all eight topic pages exist in both languages; an empty one shows the empty state", () => {
    for (const category of CATEGORIES) {
      for (const [path, lang] of [[`konu/${category}`, "tr"], [`en/topic/${category}`, "en"]] as const) {
        const html = page(DEMO, path);
        expect(html).toMatch(new RegExp(`<html lang="${lang}"`));
        expect(h1(html).toLowerCase()).toContain(COPY[lang].categories[category].toLowerCase());
      }
    }
    // The hostile build has only security stories.
    expect(text(page(HOSTILE, "konu/model"))).toContain(COPY.tr.topicEmpty);
    expect(text(page(HOSTILE, "en/topic/model"))).toContain(COPY.en.topicEmpty);
    // A category label on an edition page links to its topic page.
    expect(page(DEMO, "")).toContain('href="/konu/security/"');
    expect(page(DEMO, "en")).toContain('href="/en/topic/security/"');
  });

  it("the security topic page lists only security stories", () => {
    for (const [path, prefix] of [["konu/security", ""], ["en/topic/security", "en/"]] as const) {
      const links = [...page(DEMO, path).matchAll(/<h2 class="list-title"><a href="([^"]+)"/g)].map((m) => m[1]);
      expect(links).toEqual([`/${prefix}2026-11-20/#s-4b06d152`, `/${prefix}2026-11-17/#s-c38e5f7a`]);
    }
  });

  it("the week page shows at most 10 stories, most sources first, and /hafta/ equals the newest week", () => {
    for (const [index, week, lang] of [["hafta", "hafta/2026-W47", "tr"], ["en/week", "en/week/2026-W47", "en"]] as const) {
      const html = page(DEMO, week);
      expect(h1(html)).toBe(lang === "tr" ? "47. hafta · 16–22 Kasım 2026" : "Week 47 · 16–22 November 2026");
      const list = articles(html);
      expect(list).toHaveLength(10);
      const counts = list.map((a) => Number(a.match(/aria-label="[^"]*: (\d+) /)![1]));
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      const numbers = list.map((a) => text(a.match(/<span class="story-no">(\d+)<\/span>/)![0]));
      expect(numbers).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
      expect(articles(page(DEMO, index))).toEqual(list);
    }
    expect(text(page(EMPTY, "hafta"))).toContain(COPY.tr.weekEmpty);
    expect(text(page(EMPTY, "en/week"))).toContain(COPY.en.weekEmpty);
  });

  it("both feeds are well-formed XML with one item per story and absolute links that match a real anchor", () => {
    for (const [file, lang] of [["rss.xml", "tr"], ["en/rss.xml", "en"]] as const) {
      const xml = readFileSync(join(REAL, file), "utf8");
      expect(wellFormed(xml), file).toBe(true);
      expect(xml).toContain(`<title>${COPY[lang].feedTitle.replace(/'/g, "&apos;")}</title>`);
      const list = items(xml);
      expect(list).toHaveLength(14);
      for (const item of list) {
        const link = item.match(/<link>([^<]+)<\/link>/)![1];
        expect(link.startsWith(`${SITE}/`), link).toBe(true);
        const { pathname, hash } = new URL(link);
        expect(pathname.startsWith(lang === "tr" ? "/2026-" : "/en/2026-"), link).toBe(true);
        const target = readFileSync(join(REAL, pathname, "index.html"), "utf8");
        expect(target, link).toContain(`id="${hash.slice(1)}"`);
        expect(item).toMatch(/<guid isPermaLink="false">[0-9a-f]{32}<\/guid>/);
        expect(item.match(/<guid/g)).toHaveLength(1);
        expect(item).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
        expect(item).toContain(`\n\n${COPY[lang].forDevelopers} `);
      }
      // Newest first: the first item is the last story of 20 November.
      expect(list[0]).toContain("7e39048a");
    }
  });

  it("the hostile build's feed has the title escaped and no raw <script>", () => {
    for (const file of ["rss.xml", "en/rss.xml"]) {
      const xml = readFileSync(join(HOSTILE, file), "utf8");
      expect(wellFormed(xml), file).toBe(true);
      expect(xml).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>");
      expect(xml).not.toMatch(/<script/i);
      expect(xml).not.toMatch(/<img/i);
    }
  });

  it("the empty build has both feeds with zero items and an archive with the empty state", () => {
    for (const file of ["rss.xml", "en/rss.xml"]) {
      const xml = readFileSync(join(EMPTY, file), "utf8");
      expect(wellFormed(xml), file).toBe(true);
      expect(items(xml)).toHaveLength(0);
    }
    expect(text(page(EMPTY, "arsiv"))).toContain(COPY.tr.noEdition);
    expect(text(page(EMPTY, "en/archive"))).toContain(COPY.en.noEdition);
  });

  it("a story absent from the data is on no page and in no feed", () => {
    const demo = JSON.parse(readFileSync(join(root, "fixtures", "stories.json"), "utf8"));
    const story = demo.stories.find((s: { uid: string }) => s.uid.startsWith("4b06d152"));
    const titles = [story.texts.tr.title, story.texts.en.title];
    const files = [EMPTY, HOSTILE].flatMap(allFiles).filter((f) => /\.(html|xml)$/.test(f));
    expect(files.some((f) => f.endsWith("rss.xml"))).toBe(true);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const title of titles) expect(content, file).not.toContain(title);
      expect(content, file).not.toContain("s-4b06d152");
    }
    // The same title is in the feed of a build that has the story, so the search would have found it.
    expect(readFileSync(join(REAL, "rss.xml"), "utf8")).toContain(titles[0]);
  });

  it("the method page exists in both languages and names the 72-hour rule", () => {
    const tr = page(DEMO, "yontem");
    const en = page(DEMO, "en/method");
    expect(tr).toMatch(/<html lang="tr"/);
    expect(en).toMatch(/<html lang="en"/);
    expect(text(tr)).toContain("72 saat");
    expect(text(en)).toContain("72 hours");
    // The site never caps an edition, so the page does not claim a maximum.
    expect(text(tr)).toContain("Bir baskıda genellikle beş ile sekiz haber olur");
    expect(text(en)).toContain("An edition usually has five to eight stories");
    expect(text(tr)).not.toContain("en fazla sekiz");
    expect(text(en)).not.toContain("at most eight");
    for (const html of [tr, en]) {
      expect(html).toContain('href="https://github.com/ysfzkn/radar-ai-news/issues"');
    }
  });

  it("the 404 page says so in both languages and links home", () => {
    const html = readFileSync(join(DEMO, "404.html"), "utf8");
    expect(text(html)).toContain("Sayfa bulunamadı.");
    expect(text(html)).toContain("Page not found.");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/en/"');
  });

  it("_headers carries the CSP and the sitemap lists the home page", () => {
    const headers = readFileSync(join(DEMO, "_headers"), "utf8");
    expect(headers).toMatch(/^\/\*$/m);
    expect(headers).toContain(
      "Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(readFileSync(join(DEMO, "sitemap-0.xml"), "utf8")).toContain(`<loc>${SITE}/</loc>`);
    const robots = readFileSync(join(DEMO, "robots.txt"), "utf8");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
    expect(existsSync(join(DEMO, "sitemap-index.xml"))).toBe(true);
  });

  it("every internal link in the built pages points at a file that exists", () => {
    let checked = 0;
    for (const dir of [DEMO, HOSTILE, EMPTY]) {
      for (const file of htmlFiles(dir)) {
        const html = readFileSync(file, "utf8");
        for (const [, raw] of html.matchAll(/\shref="([^"]*)"/g)) {
          const href = raw.replace(/&amp;/g, "&");
          let path: string;
          let hash: string;
          if (href.startsWith("#")) {
            path = "";
            hash = href;
          } else {
            const url = new URL(href, `${SITE}/`);
            if (url.origin !== SITE) continue;
            path = url.pathname;
            hash = url.hash;
          }
          const target = path === "" ? file : join(dir, path.endsWith("/") ? `${path}index.html` : path);
          expect(existsSync(target), `${file}: ${href}`).toBe(true);
          if (hash) {
            const content = readFileSync(target, "utf8");
            expect(content, `${file}: ${href}`).toContain(`id="${decodeURIComponent(hash.slice(1))}"`);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
