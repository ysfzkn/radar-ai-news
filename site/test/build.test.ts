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

  it("each article has the developer panel, a source link with rel noopener and the echo meter's aria-label", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"]] as const) {
      for (const article of articles(page(DEMO, path))) {
        expect(article).toMatch(/<article id="s-[0-9a-f]{8}"/);
        expect(article).toMatch(/<h2[^>]*>/);
        const panel = article.match(/<div class="story-dev">([\s\S]*?)<\/div>/);
        expect(panel).not.toBeNull();
        expect(panel![1]).toMatch(new RegExp(`<p class="story-dev-label label caps">${COPY[lang].forDevelopers}</p>`));
        expect(article).toMatch(/<a [^>]*href="https:\/\/[^"]+"[^>]*rel="noopener"/);
        expect(article).toMatch(/role="img" aria-label="[^"]*"/);
        const label = article.match(/aria-label="([^"]*)"/)![1];
        expect(label).toMatch(lang === "tr" ? /^5 üzerinden [1-5]: \d+ bağımsız kaynak$/ : /^[1-5] of 5: /);
        expect(text(article)).toMatch(lang === "tr" ? /\d+ kaynak/ : /\d+ sources?/);
      }
    }
  });

  it("no page and no feed carries a per-story AI or approval label", () => {
    const labels = ["AI yazdı", "otomatik yayımlandı", "insan onayladı", "Written by AI", "auto-published", "human-approved"];
    const files = [REAL, DEMO].flatMap(allFiles).filter((f) => /\.(html|xml)$/.test(f));
    expect(files.some((f) => f.endsWith("rss.xml"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const label of labels) expect(content, `${file}: ${label}`).not.toContain(label);
    }
    expect(Object.keys(COPY.tr)).not.toContain("label");
    expect(Object.keys(COPY.en)).not.toContain("label");
  });

  it("the method page explains that every story is written by a model and which ones a person reads first", () => {
    const tr = text(page(DEMO, "yontem"));
    const en = text(page(DEMO, "en/method"));
    expect(tr).toContain("Her haberi bir dil modeli, haberin altında bağlantıları verilen kaynaklardan yazar.");
    expect(tr).toContain("Riskli konulardaki haberler ancak bir insan okuduktan sonra yayımlanır.");
    expect(tr).toContain("Geri kalanlar otomatik denetimden geçtikten sonra kendiliğinden yayımlanır.");
    expect(tr).toContain("Yanlış bir haber düzeltilir ya da yayından kaldırılır.");
    expect(en).toContain("Every story is written by a language model from the sources linked under it.");
    expect(en).toContain("Stories on risky subjects are published only after a person has read them.");
    expect(en).toContain("The rest are published automatically once they pass the automatic check.");
    expect(en).toContain("A story that is wrong is corrected or taken down.");
    expect(tr).not.toContain("İki etiket");
    expect(en).not.toContain("The two labels");
    expect(en).toContain("Who writes the stories?");
    expect(tr).toContain("Haberleri kim yazar?");
    // The call to report a wrong story stays in its own section further down, not repeated here.
    for (const html of [page(DEMO, "yontem"), page(DEMO, "en/method")]) {
      const sections = [...html.matchAll(/<section>[\s\S]*?<\/section>/g)].map((m) => m[0]);
      const section = sections.find((x) => /dil modeli,|written by a language model/.test(x));
      expect(section).toBeDefined();
      expect(section).not.toContain("<a ");
      expect(html.match(/href="https:\/\/github.com\/ysfzkn\/radar-ai-news\/issues"/g)).toHaveLength(1);
    }
  });

  it("the edition masthead is one h1 reading issue, date, count and minutes, with the date in the big line", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"]] as const) {
      const html = page(DEMO, path);
      expect(html.match(/<h1[\s>]/g), path).toHaveLength(1);
      expect(html).toMatch(/<h1 class="masthead">/);
      expect(h1(html)).toMatch(
        lang === "tr"
          ? /^Sayı 4 · 20 Kasım 2026 Cuma · 5 haber · ~\d+ dk$/
          : /^Issue 4 · Friday, 20 November 2026 · 5 stories · ~\d+ min$/,
      );
      const head = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1];
      const big = [...head.matchAll(/<span class="mh-big">([^<]*)<\/span>/g)].map((m) => text(m[1]));
      expect(big).toEqual(lang === "tr" ? ["20 Kasım", "Cuma"] : ["Friday, 20 November"]);
      expect(head).toMatch(/<span class="mh-no label caps">(Sayı|Issue) 4<\/span>/);
      expect(head).toMatch(/<span class="mh-year label">\s*2026<\/span>/);
      expect(head).toMatch(/<time datetime="2026-11-20">/);
    }
  });

  it("an edition with several stories has an index whose links match the story anchors, in order", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"], ["2026-11-18", "tr"], ["en/2026-11-17", "en"]] as const) {
      const html = page(DEMO, path);
      const index = html.match(/<nav class="index"[^>]*>([\s\S]*?)<\/nav>/);
      expect(index, path).not.toBeNull();
      expect(text(index![1])).toMatch(new RegExp(`^${COPY[lang].inThisIssue} ?01 `));
      const links = [...index![1].matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
      const ids = articles(html).map((a) => a.match(/<article id="([^"]+)"/)![1]);
      expect(links.length).toBeGreaterThan(1);
      expect(links).toEqual(ids);
      const titles = [...index![1].matchAll(/<a href="#[^"]+"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));
      const headings = articles(html).map((a) => text(a.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)![1]));
      expect(titles).toEqual(headings);
    }
  });

  it("an index title with a long unbroken token stays inside its column", () => {
    // A build test cannot measure layout, so the rules that keep a long token from widening
    // the index track are checked in the stylesheet itself.
    const css = readFileSync(join(root, "src", "styles", "base.css"), "utf8");
    const rule = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".index-list li")).toContain("grid-template-columns: 2.25rem minmax(0, 1fr);");
    expect(rule(".index-list a")).toContain("overflow-wrap: anywhere;");
    // The hostile fixture carries a 60-character token in a title, and the page still builds.
    expect(page(HOSTILE, "en/2026-11-19")).toContain("x".repeat(60));
  });

  it("an edition with one story has no index", () => {
    const html = page(HOSTILE, "en/2026-11-19");
    expect(articles(html)).toHaveLength(1);
    expect(html).not.toContain('class="index"');
    expect(text(html)).not.toContain(COPY.en.inThisIssue);
  });

  it("the first story of an edition is marked as the lead and no story on a week page is", () => {
    for (const path of ["", "en", "2026-11-17", "en/2026-11-18"]) {
      const list = articles(page(DEMO, path));
      expect(list[0], path).toMatch(/^<article id="s-[0-9a-f]{8}" class="story story-lead"/);
      for (const article of list.slice(1)) expect(article, path).not.toContain("story-lead");
    }
    for (const path of ["hafta/2026-W47", "en/week/2026-W47"]) {
      for (const article of articles(page(DEMO, path))) expect(article, path).not.toContain("story-lead");
    }
  });

  it("edition pages show no per-story date; week pages do", () => {
    for (const path of ["", "en", "2026-11-18"]) {
      for (const article of articles(page(DEMO, path))) expect(article, path).not.toContain("<time");
    }
    for (const path of ["hafta/2026-W47", "en/week/2026-W47"]) {
      for (const article of articles(page(DEMO, path))) {
        expect(article, path).toMatch(/<time datetime="2026-11-(1[6-9]|2[0-2])">/);
      }
    }
  });

  it("the echo meter is five arcs with as many lit as the level, and keeps its aria-label", () => {
    const echo = (article: string) => article.match(/<span class="echo">([\s\S]*?)<\/svg>/)![1];
    const two = articles(page(DEMO, "")).find((a) => a.includes('id="s-5c17e263"'))!;
    const seven = articles(page(DEMO, "2026-11-18")).find((a) => a.includes('id="s-07c29d1e"'))!;
    for (const [article, on, label] of [
      [two, 2, "5 üzerinden 2: 2 bağımsız kaynak"],
      [seven, 5, "5 üzerinden 5: 7 bağımsız kaynak"],
    ] as const) {
      const svg = echo(article);
      expect(svg).toMatch(/<svg class="echo-arcs" viewBox="0 0 44 14" width="44" height="14" role="img" aria-label="([^"]*)"/);
      expect(svg).toContain(`aria-label="${label}"`);
      expect(svg.match(/class="echo-on"/g) ?? []).toHaveLength(on);
      expect(svg.match(/class="echo-off"/g) ?? []).toHaveLength(5 - on);
      for (const x of [2, 10.5, 19, 27.5, 36]) expect(svg).toContain(`d="M${x} 1.5A8.5 8.5 0 0 1 ${x} 12.5"`);
      expect(svg).not.toContain("mark");
    }
    expect(text(two)).toContain("2 kaynak");
    expect(text(seven)).toContain("7 kaynak");
  });

  it("the mark, the echo meter and the favicon carry no colour in attributes except the favicon", () => {
    // The mark is three equal arcs side by side, all accent, and nothing else.
    const markArcs = [5, 11, 17].map((x) => `<path class="mark-arc" d="M${x} 4A13 13 0 0 1 ${x} 20"></path>`).join("");
    const meterArcs = [2, 10.5, 19, 27.5, 36].map((x) => `d="M${x} 1.5A8.5 8.5 0 0 1 ${x} 12.5"`);
    let marks = 0;
    let meters = 0;
    for (const file of [DEMO, REAL].flatMap(htmlFiles)) {
      const html = readFileSync(file, "utf8");
      for (const [svg] of html.matchAll(/<svg[\s\S]*?<\/svg>/g)) {
        expect(svg, file).not.toMatch(/\s(fill|stroke|color|stop-color)="/);
        expect(svg, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
        if (svg.startsWith('<svg class="mark" viewBox="0 0 24 24"')) {
          const inner = svg.slice(svg.indexOf(">") + 1, -"</svg>".length);
          expect(inner, file).toBe(markArcs);
          marks++;
        } else {
          expect(svg, file).toMatch(/^<svg class="echo-arcs" viewBox="0 0 44 14"/);
          for (const arc of meterArcs) expect(svg, file).toContain(arc);
          meters++;
        }
      }
    }
    expect(marks).toBeGreaterThan(20);
    expect(meters).toBeGreaterThan(50);
    // Before the wordmark: 20 px, hidden from screen readers.
    const strip = page(DEMO, "").match(/<a class="wordmark"[\s\S]*?<\/svg>/)![0];
    expect(strip).toMatch(/<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">/);
    // The end of an edition: the echo arcs, all five lit, at twice the meter's size, above the closing line.
    const end = page(DEMO, "").match(/<div class="closed">([\s\S]*?<\/svg>)\s*<p class="closed-text">/)![1];
    expect(end).toMatch(/^<svg class="echo-arcs" viewBox="0 0 44 14" width="88" height="28" aria-hidden="true">/);
    expect(end.match(/class="echo-on"/g)).toHaveLength(5);
    expect(end).not.toContain("echo-off");
    expect(end).not.toContain("aria-label");
    // The favicon is a standalone file with no stylesheet, so its colours are the table's hex values.
    const favicon = readFileSync(join(DEMO, "favicon.svg"), "utf8");
    for (const x of [5, 11, 17]) {
      expect(favicon).toContain(
        `<path d="M${x} 4A13 13 0 0 1 ${x} 20" fill="none" stroke="#c2371a" stroke-width="2.25" stroke-linecap="round"/>`,
      );
    }
    expect(favicon.match(/<path/g)).toHaveLength(3);
    expect(favicon).not.toMatch(/class=|<style|<circle|<line/);
  });

  it("the end of an edition closes it and points to the neighbouring issues", () => {
    const html = page(DEMO, "2026-11-19");
    const end = html.match(/<div class="end">([\s\S]*?)<\/main>/)![1];
    expect(text(end)).toMatch(/^Baskı kapandı\. ?Sayı 3 · \d+ haber ?← Önceki sayı/);
    expect(end).toMatch(/<a class="pager-prev" href="\/2026-11-18\/" rel="prev">/);
    expect(end).toMatch(/<a class="pager-next" href="\/2026-11-20\/" rel="next">/);
  });

  it("no page contains <script, <style or a style attribute", () => {
    const files = [DEMO, HOSTILE, EMPTY, REAL].flatMap(htmlFiles);
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
        expect(item).toContain(`\n\n${lang === "tr" ? "Geliştiriciler için:" : "For developers:"} `);
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
