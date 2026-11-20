import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { COPY } from "../src/lib/copy";
import { routes } from "../src/lib/routes";
import { CATEGORIES } from "../src/lib/schema";

// These tests read the files of finished builds. beforeAll runs four builds one after
// another (never concurrently): the demo fixture, a hostile file, an empty file, and the
// demo fixture's stories read as real data (so feeds and pages are built without the demo marks).
// Each goes to its own git-ignored folder; site/dist, the folder a plain build and a preview use,
// is never written.
const root = resolve(import.meta.dirname, "..");
const astro = join(root, "node_modules", "astro", "bin", "astro.mjs");
const DEMO = join(root, "dist-demo");
const HOSTILE = join(root, "dist-hostile");
const EMPTY = join(root, "dist-empty");
const REAL = join(root, "dist-real");
// The configured site, as astro.config.mjs reads it; the builds inherit this environment.
const SITE = process.env.SITE_URL || "https://radar.ozkanyusuf.com";
const DEMO_DATES =["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];

// The demo build forces the fixture with RADAR_DEMO=1, so a fetched site/.data/stories.json
// (the owner's real data) is neither read nor touched; the others name their file explicitly.
function build(outDir: string, storiesFile?: string): void {
  const env = { ...process.env };
  delete env.RADAR_STORIES_FILE;
  delete env.RADAR_DEMO;
  if (storiesFile) env.RADAR_STORIES_FILE = storiesFile;
  else env.RADAR_DEMO = "1";
  execFileSync(process.execPath, [astro, "build", "--outDir", outDir], {
    cwd: root,
    env,
    stdio: "pipe",
  });
}

// The owner's own build in site/dist, as it was before the test builds ran.
const OWNER = join(root, "dist");
let ownerBefore = "";

/** Every file under `dir` with its size and modification time, or "absent". */
function stamp(dir: string): string {
  if (!existsSync(dir)) return "absent";
  return allFiles(dir)
    .map((file) => {
      const { size, mtimeMs } = statSync(file);
      return `${file} ${size} ${mtimeMs}`;
    })
    .sort()
    .join("\n");
}

beforeAll(() => {
  ownerBefore = stamp(OWNER);
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

// A build test cannot measure layout, so layout rules are checked in the stylesheet itself.
const css = () => readFileSync(join(root, "src", "styles", "base.css"), "utf8");

/** The body of the first rule whose selector list is exactly `selector`, at any indentation. */
function cssRule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sheet.match(new RegExp(`\\n\\s*${escaped} \\{([^}]*)\\}`));
  expect(match, selector).not.toBeNull();
  return match![1];
}

/** Both stylesheets, tokens first. */
const sheets = () => readFileSync(join(root, "src", "styles", "tokens.css"), "utf8") + "\n" + css();

interface Declaration {
  prop: string;
  value: string;
  /** The innermost block's prelude: a selector list, or an at-rule for a bare declaration. */
  selector: string;
  /** Every enclosing prelude, outermost first. */
  stack: string[];
}

/** Every declaration of a stylesheet with the blocks around it (comments dropped; no braces in strings). */
function declarations(sheet: string): Declaration[] {
  const source = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  const flush = () => {
    const m = buffer.match(/^\s*(-?[\w-]+)\s*:\s*([\s\S]*?)\s*$/);
    if (m && stack.length > 0) out.push({ prop: m[1], value: m[2], selector: stack.at(-1)!, stack: [...stack] });
    buffer = "";
  };
  for (const ch of source) {
    if (ch === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      flush();
      stack.pop();
    } else if (ch === ";") {
      flush();
    } else {
      buffer += ch;
    }
  }
  return out;
}

/** Every `<a …>` start tag of a page with its attributes. */
function anchors(html: string): { tag: string; attrs: Record<string, string> }[] {
  return [...html.matchAll(/<a\s[^>]*>/g)].map(([tag]) => {
    const attrs: Record<string, string> = {};
    for (const [, name, value] of tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)) attrs[name] = value ?? "";
    return { tag, attrs };
  });
}

const EXTERNAL = 'target="_blank" rel="noopener noreferrer"';

/** The pager of an edition page: the links to the previous and the next issue. */
const pager = (html: string) => html.match(/<p class="pager">([\s\S]*?)<\/p>/)![1];

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `@media print` block, which closes the stylesheet. */
function printRules(sheet: string): string {
  const start = sheet.indexOf("\n@media print {");
  expect(start).toBeGreaterThan(-1);
  return sheet.slice(start);
}

/** The lit arcs of an article's labelled echo meter. */
const litArcs = (article: string) =>
  (article.match(/<span class="echo">[\s\S]*?<\/svg>/)![0].match(/class="echo-on"/g) ?? []).length;

/** The source count an article's echo meter names. */
const sourceCount = (article: string) => Number(article.match(/role="img" aria-label="[^"]*: (\d+) /)![1]);

function langControl(html: string): { label: string; inner: string } {
  const all = [...html.matchAll(/<div class="lang label" role="group" aria-label="([^"]+)">([\s\S]*?)<\/div>/g)];
  expect(all).toHaveLength(1);
  return { label: all[0][1], inner: all[0][2] };
}

describe("built site", () => {
  it("the test builds go to their own git-ignored folders and leave site/dist untouched", () => {
    expect(stamp(OWNER)).toBe(ownerBefore);
    const ignored = readFileSync(join(root, "..", ".gitignore"), "utf8").split(/\r?\n/);
    for (const dir of [DEMO, HOSTILE, EMPTY, REAL]) {
      expect(dir).not.toBe(OWNER);
      expect(ignored, dir).toContain(`${dir.slice(root.length + 1)}/`);
    }
  });

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
        // The pager only: the line under the end sign also speaks of the next issue.
        else expect(text(pager(html))).not.toContain(prefix ? "Next issue" : "Sonraki sayı");
      }
    });
    expect(page(DEMO, "")).toContain(`href="/2026-11-19/"`);
    expect(text(pager(page(DEMO, "")))).not.toContain("Sonraki sayı");
    expect(page(DEMO, "")).not.toContain('rel="next"');
  });

  it("each article has the why-it-matters line, a source link that opens in a new tab and the echo meter's aria-label", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"]] as const) {
      for (const article of articles(page(DEMO, path))) {
        expect(article).toMatch(/<article id="s-[0-9a-f]{8}"/);
        expect(article).toMatch(/<h2[^>]*>/);
        expect(article).not.toContain("story-dev");
        const why = article.match(/<p class="story-why">([\s\S]*?)<\/p>/);
        expect(why).not.toBeNull();
        expect(why![1]).toMatch(
          new RegExp(`^<span class="why-label label caps">${COPY[lang].whyItMatters}</span><span class="visually-hidden">:</span> \\S`),
        );
        // A screen reader hears "Neden önemli: …", the pill shows no colon.
        expect(text(why![1])).toMatch(new RegExp(`^${COPY[lang].whyItMatters}: \\S`));
        expect(article).toMatch(new RegExp(`<a href="https://[^"]+" ${EXTERNAL}>`));
        expect(article).toMatch(/role="img" aria-label="[^"]*"/);
        const label = article.match(/role="img" aria-label="([^"]*)"/)![1];
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

  it("the Künye page explains that every story is written by a model and which ones a person reads first", () => {
    const tr = text(page(DEMO, "kunye"));
    const en = text(page(DEMO, "en/about"));
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
    for (const html of [page(DEMO, "kunye"), page(DEMO, "en/about")]) {
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
          ? /^Sayı 4 · 20 Kasım 2026 Cuma · 5 haber · \d+ kaynak · ~\d+ dk$/
          : /^Issue 4 · Friday, 20 November 2026 · 5 stories · \d+ sources · ~\d+ min$/,
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
    expect(rule(".index-list li")).toContain("grid-template-columns: 2.25rem minmax(0, 1fr) auto;");
    expect(rule(".index-list a")).toContain("overflow-wrap: anywhere;");
    // The hostile fixture carries a 60-character token in a title in a two-story edition,
    // so the token is drawn inside an index row.
    const html = page(HOSTILE, "en/2026-11-19");
    expect(articles(html)).toHaveLength(2);
    const index = html.match(/<nav class="index"[^>]*>([\s\S]*?)<\/nav>/);
    expect(index).not.toBeNull();
    const rows = [...index![1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.includes("x".repeat(60)))).toHaveLength(1);
  });

  it("each index row carries that story's echo arcs with the right lit count, hidden from assistive tech", () => {
    for (const path of ["", "en", "2026-11-18", "en/2026-11-17"]) {
      const html = page(DEMO, path);
      const index = html.match(/<nav class="index"[^>]*>([\s\S]*?)<\/nav>/)![1];
      const rows = [...index.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
      const lit = articles(html).map(litArcs);
      expect(rows, path).toHaveLength(lit.length);
      rows.forEach((row, i) => {
        const svgs = row.match(/<svg[\s\S]*?<\/svg>/g)!;
        expect(svgs, path).toHaveLength(1);
        const svg = svgs[0];
        expect(svg).toMatch(/^<svg class="echo-arcs" viewBox="0 0 44 14" width="33" height="10.5" aria-hidden="true">/);
        expect(svg).not.toContain("aria-label");
        expect(svg.match(/class="echo-on"/g) ?? [], `${path} row ${i + 1}`).toHaveLength(lit[i]);
        expect(svg.match(/class="echo-off"/g) ?? []).toHaveLength(5 - lit[i]);
        // Number, title link, then the arcs at the row's end.
        expect(row.indexOf("<svg")).toBeGreaterThan(row.indexOf("</a>"));
      });
    }
    // The demo's 18 November mixes levels, so a wrong count would show.
    expect(new Set(articles(page(DEMO, "2026-11-18")).map(litArcs)).size).toBeGreaterThan(1);
  });

  it("the index rule keeps the title in a minmax(0, 1fr) track with the arcs in an auto track", () => {
    const sheet = css();
    expect(cssRule(sheet, ".index-list li")).toContain("grid-template-columns: 2.25rem minmax(0, 1fr) auto;");
    expect(cssRule(sheet, ".index-list a")).toContain("overflow-wrap: anywhere;");
    // The rail keeps the same tracks: no other rule redefines the row's columns.
    expect(sheet.match(/grid-template-columns: 2\.25rem/g)).toHaveLength(1);
  });

  it("each story's number links to its own anchor and its accessible name contains the number", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"], ["2026-11-18", "tr"], ["hafta/2026-W47", "tr"], ["en/week/2026-W47", "en"]] as const) {
      const list = articles(page(DEMO, path));
      expect(list.length).toBeGreaterThan(1);
      list.forEach((article, i) => {
        const id = article.match(/<article id="([^"]+)"/)![1];
        const no = String(i + 1).padStart(2, "0");
        expect(article, `${path} ${id}`).toContain(
          `<a class="story-no" href="#${id}" aria-label="${COPY[lang].storyLink(no)}">${no}</a>`,
        );
      });
    }
    expect(COPY.tr.storyLink("03")).toBe("03 numaralı haberin bağlantısı");
    expect(COPY.en.storyLink("03")).toBe("Link to story 03");
    const sheet = css();
    expect(cssRule(sheet, "a.story-no")).toContain("text-decoration-line: none;");
    expect(cssRule(sheet, "a.story-no:hover,\na.story-no:focus-visible")).toContain("text-decoration-line: underline;");
  });

  it("the stylesheet marks a targeted story and gives stories a scroll margin", () => {
    const sheet = css();
    expect(cssRule(sheet, ".story")).toContain("scroll-margin-top: 1.5rem;");
    const bars = declarations(sheet).filter((d) => d.selector.includes(".story:target::before"));
    expect(bars.length).toBeGreaterThan(0);
    // The bar takes the story's category colour, the accent where a story has none.
    expect(bars.map((d) => `${d.prop}: ${d.value}`)).toContain("border-left: 3px solid var(--cat, var(--accent))");
    // A bar only: no background change; it grows only where motion is welcome.
    expect(sheet).not.toMatch(/:target \{/);
    for (const bar of bars) {
      expect(bar.prop).not.toMatch(/background|transition/);
      if (bar.prop.startsWith("animation") && bar.value !== "none") {
        expect(bar.stack.join(" ")).toContain("prefers-reduced-motion: no-preference");
      }
    }
    // From 48rem it sits between the hanging number and the text; from 50rem, where the gutter
    // has room even beside a 20px scrollbar, 0.5rem left of the number (0.5rem from the rail).
    const left = (media: string) =>
      bars.find((d) => d.prop === "left" && d.stack[0] === `@media (min-width: ${media})`)?.value;
    expect(left("48rem")).toBe("calc(-0.6 * var(--hang-pad))");
    expect(left("50rem")).toBe("-3.5rem");
    // No width-based clamp that a scrollbar can throw off.
    for (const bar of bars) expect(bar.value).not.toContain("100vw");
  });

  it("the try link is one link with the button class, the mark and the host", () => {
    let seen = 0;
    for (const [path, lang] of [["", "tr"], ["en", "en"], ["2026-11-18", "tr"]] as const) {
      for (const article of articles(page(DEMO, path))) {
        const block = article.match(/<p class="story-try label">([\s\S]*?)<\/p>/);
        if (!block) continue;
        seen++;
        expect(block[1].match(/<a /g)).toHaveLength(1);
        const link = block[1].match(new RegExp(`<a class="try" href="(https://[^"]+)" ${EXTERNAL}>([\\s\\S]*?)</a>`));
        expect(link, path).not.toBeNull();
        const host = new URL(link![1]).host;
        expect(link![2]).toMatch(
          new RegExp(
            `^<span class="story-try-mark" aria-hidden="true">▸</span> ?${COPY[lang].tryIt} <span class="try-host">${host.replace(/\./g, "\\.")}</span>$`,
          ),
        );
      }
    }
    expect(seen).toBeGreaterThan(2);
    const sheet = css();
    const button = cssRule(sheet, ".try");
    expect(button).toContain("padding: 0.375rem 0.75rem;");
    expect(button).toContain("min-height: 2.25rem;");
    // The depth block, shared with the subscribe button: a 1.5px ink border on white, a 3px hard shadow.
    const block = cssRule(sheet, ".subscribe,\n.try");
    expect(block).toContain("border: 1.5px solid var(--ink);");
    expect(block).toContain("background: var(--surface);");
    expect(block).toContain("color: var(--ink);");
    expect(block).toContain("box-shadow: 3px 3px 0 var(--ink);");
    const hover = cssRule(sheet, ".subscribe:hover,\n.subscribe:focus-visible,\n.try:hover,\n.try:focus-visible");
    expect(hover).toContain("transform: translate(-1px, -1px);");
    expect(hover).toContain("box-shadow: 4px 4px 0 var(--ink);");
    const active = cssRule(sheet, ".subscribe:active,\n.try:active");
    expect(active).toContain("transform: translate(2px, 2px);");
    expect(active).toContain("box-shadow: 1px 1px 0 var(--ink);");
    expect(cssRule(sheet, ".story-try")).toContain("margin-top: var(--space-3);");
  });

  it("the language control shows both languages, marks the current one and links the other with hreflang", () => {
    const cases = [
      ["", "tr", "/en/"],
      ["en", "en", "/"],
      ["2026-11-18", "tr", "/en/2026-11-18/"],
      ["en/2026-11-18", "en", "/2026-11-18/"],
      ["kunye", "tr", "/en/about/"],
      ["en/about", "en", "/kunye/"],
      ["abone", "tr", "/en/subscribe/"],
      ["en/subscribe", "en", "/abone/"],
      ["arsiv", "tr", "/en/archive/"],
    ] as const;
    for (const [path, lang, href] of cases) {
      const { label, inner } = langControl(page(DEMO, path));
      expect(label).toBe(COPY[lang].language);
      const other = lang === "tr" ? "en" : "tr";
      const current = `<span class="lang-part" aria-current="true">${COPY[lang].langShort}</span>`;
      const link = `<a class="lang-part" href="${href}" hreflang="${other}" lang="${other}">${COPY[other].langShort}</a>`;
      expect(inner, path).toContain(current);
      expect(inner, path).toContain(link);
      // TR first, then EN, whichever is current.
      expect(inner.indexOf(">TR<")).toBeLessThan(inner.indexOf(">EN<"));
      expect(inner.match(/<a /g)).toHaveLength(1);
    }
    // The control replaces the lone other-language link in the strip.
    const strip = page(DEMO, "").match(/<header class="top">([\s\S]*?)<\/header>/)![1];
    expect(strip.match(/hreflang=/g)).toHaveLength(1);
    expect(text(strip)).not.toContain("English");
  });

  it("on a page with no counterpart the other language links to that language's home", () => {
    const { inner } = langControl(page(HOSTILE, "en/2026-11-19"));
    expect(inner).toContain(`<a class="lang-part" href="/" hreflang="tr" lang="tr">TR</a>`);
    expect(inner).toContain(`<span class="lang-part" aria-current="true">EN</span>`);
    expect(langControl(readFileSync(join(DEMO, "404.html"), "utf8")).inner).toContain(
      `<a class="lang-part" href="/en/" hreflang="en" lang="en">EN</a>`,
    );
  });

  it("archive rows show the lead headline and the edition's total sources, with one link per row", () => {
    for (const [path, prefix, lang] of [["arsiv", "", "tr"], ["en/archive", "en/", "en"]] as const) {
      const html = page(DEMO, path);
      const rows = [...html.matchAll(/<li>\s*<a class="row" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/g)];
      expect(rows).toHaveLength(DEMO_DATES.length);
      for (const [, href, row] of rows) {
        expect(row).not.toContain("<a ");
        const edition = articles(page(DEMO, `${prefix}${href.split("/").at(-2)}`));
        const lead = text(edition[0].match(/<h2[^>]*>([\s\S]*?)<\/h2>/)![1]);
        const total = edition.map(sourceCount).reduce((a, b) => a + b, 0);
        const leadSpan = row.match(/<span class="row-lead">([\s\S]*?)<\/span>/);
        expect(leadSpan, href).not.toBeNull();
        expect(text(leadSpan![1])).toBe(lead);
        expect(text(row)).toContain(`${COPY[lang].storyCount(edition.length)} · ${COPY[lang].sources(total)}`);
        // The lead sits under the date, before the count.
        expect(row.indexOf("row-date")).toBeLessThan(row.indexOf("row-lead"));
      }
    }
    const sheet = css();
    const lead = cssRule(sheet, ".row-lead");
    for (const rule of ["min-width: 0;", "white-space: nowrap;", "overflow: hidden;", "text-overflow: ellipsis;"]) {
      expect(lead).toContain(rule);
    }
    expect(cssRule(sheet, ".row")).toContain("grid-template-columns: 4.75em minmax(0, 1fr);");
  });

  it("the print rules hide the navigation, banner, index, pager and footer, and print source addresses", () => {
    const sheet = css();
    const print = printRules(sheet);
    // The print block closes the stylesheet, so nothing after it overrides it.
    expect(print.trimEnd().endsWith("}\n}") || print.trimEnd().endsWith("}\r\n}")).toBe(true);
    const hidden = cssRule(print, ".top-nav,\n  .demo,\n  .index,\n  .pager,\n  .foot,\n  .skip");
    expect(hidden).toContain("display: none;");
    expect(cssRule(print, "body")).toMatch(/background: var\(--surface\);[\s\S]*color: var\(--ink\);/);
    expect(cssRule(print, ".stories > li")).toContain("break-inside: avoid;");
    // Backgrounds do not print: the filled pills turn into outlined ink, and the shadows go.
    expect(cssRule(print, ".why-label,\n  .mh-no")).toMatch(
      /background: none;[\s\S]*color: var\(--ink\);[\s\S]*border: 1px solid var\(--ink\);/,
    );
    expect(cssRule(print, ".story-lead,\n  .subscribe,\n  .try")).toContain("box-shadow: none;");
    expect(cssRule(print, ".progress,\n  .top-act,\n  .by,\n  .closed-sub")).toContain("display: none;");
    expect(cssRule(print, '.story-sources a[href^="http"]::after,\n  .try[href^="http"]::after')).toContain(
      'content: " (" attr(href) ")";',
    );
    // The rail and the column shift give way to one column.
    expect(print).toContain(".edition-railed");
    // A landscape page is wider than 48rem, so the hanging numbers come back into the label row
    // at their phone-width size instead of hanging in a gutter the page margin cuts.
    const number = cssRule(print, ".story .story-no");
    for (const rule of ["position: static;", "width: auto;", "padding-right: 0;", "font-size: 1.0625rem;", "letter-spacing: 0;"]) {
      expect(number).toContain(rule);
    }
    expect(cssRule(css(), ".story-no")).toContain("font-size: 1.0625rem;");
    // The elements the print rules hide carry those classes.
    const edition = page(DEMO, "2026-11-19");
    expect(edition).toMatch(/<nav class="top-nav">/);
    expect(edition).toContain('<p class="pager">');
    expect(edition).toContain('<footer class="foot label">');
    expect(edition).toContain('<nav class="index"');
    expect(edition).toContain('<div class="progress" aria-hidden="true"></div>');
    expect(edition).toContain('<div class="top-act">');
    expect(edition).toContain('<p class="closed-sub">');
  });

  it("an edition with one story has no index", () => {
    for (const [path, lang] of [["2026-11-20", "tr"], ["en/2026-11-20", "en"]] as const) {
      const html = page(HOSTILE, path);
      expect(articles(html), path).toHaveLength(1);
      expect(html, path).not.toContain('class="index"');
      expect(text(html), path).not.toContain(COPY[lang].inThisIssue);
    }
  });

  it("the first story of an edition is marked as the lead and no story on a week page is", () => {
    for (const path of ["", "en", "2026-11-17", "en/2026-11-18"]) {
      const list = articles(page(DEMO, path));
      expect(list[0], path).toMatch(/^<article id="s-[0-9a-f]{8}" class="story story-lead cat-[a-z]+"/);
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
    expect(text(end)).toMatch(/^Baskı kapandı\. ?Sayı 3 · \d+ haber ?Sonraki sayıyı kaçırma\. ?Ücretsiz abone ol ?← Önceki sayı/);
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
      expect(text(rows[0][2])).toMatch(
        lang === "tr"
          ? /^Sayı 4 20 Kasım 2026 Cuma .+ 5 haber · \d+ kaynak$/
          : /^Issue 4 Friday, 20 November 2026 .+ 5 stories · \d+ sources$/,
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
      const numbers = list.map((a) => text(a.match(/<a class="story-no"[^>]*>(\d+)<\/a>/)![0]));
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
        expect(item).toContain(`\n\n${lang === "tr" ? "Neden önemli:" : "Why it matters:"} `);
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

  it("the Künye page exists in both languages and names the 72-hour rule", () => {
    const tr = page(DEMO, "kunye");
    const en = page(DEMO, "en/about");
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

  it("the Künye pages exist at /kunye/ and /en/about/, the old method addresses do not, and no page links to them", () => {
    for (const dir of [DEMO, HOSTILE, EMPTY, REAL]) {
      expect(existsSync(join(dir, "kunye", "index.html")), dir).toBe(true);
      expect(existsSync(join(dir, "en", "about", "index.html")), dir).toBe(true);
      expect(existsSync(join(dir, "yontem")), dir).toBe(false);
      expect(existsSync(join(dir, "en", "method")), dir).toBe(false);
      for (const file of htmlFiles(dir)) {
        const html = readFileSync(file, "utf8");
        expect(html, file).not.toMatch(/\/yontem\/|\/en\/method\//);
      }
    }
    expect(page(DEMO, "kunye")).toMatch(/<link rel="alternate" hreflang="en" href="https:\/\/[^"]+\/en\/about\/">/);
    expect(page(DEMO, "en/about")).toMatch(/<link rel="alternate" hreflang="tr" href="https:\/\/[^"]+\/kunye\/">/);
    expect(h1(page(DEMO, "kunye"))).toBe("Künye");
    expect(h1(page(DEMO, "en/about"))).toBe("About");
    const sitemap = readFileSync(join(DEMO, "sitemap-0.xml"), "utf8");
    for (const path of ["kunye/", "en/about/", "abone/", "en/subscribe/"]) expect(sitemap).toContain(`<loc>${SITE}/${path}</loc>`);
    expect(sitemap).not.toMatch(/yontem|method/);
    // The navigation and the footer name the page.
    for (const [path, lang] of [["", "tr"], ["en", "en"]] as const) {
      const html = page(DEMO, path);
      const nav = html.match(/<nav class="top-nav">([\s\S]*?)<\/nav>/)![1];
      expect(nav).toContain(`<a href="${lang === "tr" ? "/kunye/" : "/en/about/"}">${COPY[lang].nav.about}</a>`);
      const foot = html.match(/<footer[\s\S]*?<\/footer>/)![0];
      expect(foot).toContain(`<a href="${lang === "tr" ? "/kunye/" : "/en/about/"}">${COPY[lang].nav.about}</a>`);
    }
    expect(COPY.tr.nav.about).toBe("Künye");
    expect(COPY.en.nav.about).toBe("About");
  });

  it("the Künye page opens with who makes Radar and links ozkanyusuf.com and the GitHub account", () => {
    for (const [path, heading] of [["kunye", "Radar'ı kim çıkarıyor?"], ["en/about", "Who makes Radar?"]] as const) {
      const html = page(DEMO, path);
      const first = html.match(/<section>([\s\S]*?)<\/section>/)![1];
      expect(text(first.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)![1])).toBe(heading);
      expect(text(first)).toContain("Yusuf Özkan");
      for (const href of ["https://ozkanyusuf.com", "https://github.com/ysfzkn", "https://github.com/ysfzkn/radar-ai-news"]) {
        expect(first, `${path} ${href}`).toContain(`href="${href}" ${EXTERNAL}`);
      }
    }
    expect(text(page(DEMO, "kunye"))).toContain(
      "Radar, Yusuf Özkan'ın kişisel projesi; onu o yürütüyor ve sitenin kaynak kodu herkese açık.",
    );
    expect(text(page(DEMO, "en/about"))).toContain(
      "Radar is a personal project by Yusuf Özkan, who runs it; the site's source code is open.",
    );
    // Most stories publish themselves, so the page does not say he publishes every issue.
    expect(text(page(DEMO, "kunye"))).not.toContain("Her sayıyı o yayımlıyor");
    expect(text(page(DEMO, "en/about"))).not.toContain("He publishes every issue");
    // The rest of the method stays below it.
    expect(text(page(DEMO, "kunye"))).toContain("Yankı ölçer");
    expect(text(page(DEMO, "en/about"))).toContain("The echo meter");
  });

  it("every page shows ozkanyusuf.com beside the wordmark and the signature in the footer", () => {
    const files = [DEMO, REAL].flatMap(htmlFiles);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const html = readFileSync(file, "utf8");
      const strip = html.match(/<header class="top">([\s\S]*?)<\/header>/)![1];
      const afterWordmark = strip.slice(strip.indexOf("</a>", strip.indexOf('class="wordmark"')) + 4);
      expect(afterWordmark.match(/<a\s[^>]*>/)![0], file).toBe(`<a class="by label" href="https://ozkanyusuf.com" ${EXTERNAL}>`);
      expect(text(afterWordmark).startsWith("ozkanyusuf.com"), file).toBe(true);
      const foot = html.match(/<footer class="foot label">([\s\S]*?)<\/footer>/)![1];
      const sig = foot.match(/<p class="sig">([\s\S]*?)<\/p>/);
      expect(sig, file).not.toBeNull();
      expect(text(sig![1])).toBe("Yusuf Özkan · ozkanyusuf.com · GitHub");
      expect(sig![1]).toContain(`<a href="https://ozkanyusuf.com" ${EXTERNAL}>ozkanyusuf.com</a>`);
      expect(sig![1]).toContain(`<a href="https://github.com/ysfzkn" ${EXTERNAL}>GitHub</a>`);
      // Then the RSS, Künye and source code links, after the signature.
      expect(text(foot).indexOf("RSS")).toBeGreaterThan(text(foot).indexOf("GitHub"));
    }
  });

  it("no page says the site is for developers in its tagline or description", () => {
    expect(COPY.tr.tagline).toBe("Günün teknoloji ve yapay zekâ haberleri. Beş dakika, gürültü yok.");
    expect(COPY.en.tagline).toBe("The day's tech and AI news. Five minutes, no noise.");
    for (const file of [DEMO, REAL, EMPTY].flatMap(allFiles).filter((f) => /\.(html|xml)$/.test(f))) {
      const content = readFileSync(file, "utf8");
      for (const [, value] of content.matchAll(/<meta (?:name|property)="(?:description|og:description)" content="([^"]*)"/g)) {
        expect(value, file).not.toMatch(/geliştirici|developer/i);
      }
      expect(text(content), file).not.toMatch(/geliştiriciler için|for developers/i);
    }
  });

  it("the subscribe button is in the top strip of every page and under the end sign of an edition", () => {
    for (const file of [DEMO, REAL].flatMap(htmlFiles)) {
      const html = readFileSync(file, "utf8");
      const lang = html.match(/<html lang="(tr|en)"/)![1] as "tr" | "en";
      const strip = html.match(/<header class="top">([\s\S]*?)<\/header>/)![1];
      const buttons = [...strip.matchAll(/<a class="subscribe label" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      expect(buttons, file).toHaveLength(1);
      expect(buttons[0][1]).toBe(lang === "tr" ? "/abone/" : "/en/subscribe/");
      expect(text(buttons[0][2])).toBe(COPY[lang].subscribeFree);
      // The only button in the strip.
      expect(strip).not.toContain('class="try');
    }
    expect(COPY.tr.subscribeFree).toBe("Ücretsiz abone ol");
    expect(COPY.en.subscribeFree).toBe("Subscribe free");
    for (const [path, lang] of [["", "tr"], ["en", "en"], ["2026-11-18", "tr"]] as const) {
      const closed = page(DEMO, path).match(/<div class="closed">([\s\S]*?)<\/div>/)![1];
      const line = closed.match(/<p class="closed-sub">([\s\S]*?)<\/p>/);
      expect(line, path).not.toBeNull();
      expect(text(line![1])).toBe(`${COPY[lang].dontMiss} ${COPY[lang].subscribeFree}`);
      expect(line![1]).toContain(`<a class="subscribe label" href="${routes[lang].subscribe}">`);
    }
    expect(COPY.tr.dontMiss).toBe("Sonraki sayıyı kaçırma.");
    expect(COPY.en.dontMiss).toBe("Don't miss the next issue.");
  });

  it("the subscribe pages show the feed address as text and as a link, have no form and no input", () => {
    for (const [path, lang, other] of [["abone", "tr", "en"], ["en/subscribe", "en", "tr"]] as const) {
      const html = page(DEMO, path);
      const main = html.match(/<main[\s\S]*?<\/main>/)![0];
      const feed = `${SITE}${routes[lang].rss}`;
      const otherFeed = `${SITE}${routes[other].rss}`;
      expect(h1(html)).toBe(COPY[lang].subscribeFree);
      expect(main).toContain(`<code class="feed-url">${feed}</code>`);
      // The links are site-relative, so they work on a local preview too; the absolute address is the text to copy.
      const links = anchors(main).filter(({ attrs }) => attrs.type === "application/rss+xml");
      expect(links.map(({ attrs }) => attrs.href)).toEqual([routes[lang].rss, routes[other].rss]);
      for (const { tag, attrs } of links) expect(attrs.target, tag).toBeUndefined();
      expect(main).not.toContain(`href="${feed}"`);
      expect(main).not.toContain(`href="${otherFeed}"`);
      expect(main).not.toMatch(/<form|<input|<button|<textarea/i);
      expect(text(main)).toContain(COPY[lang].subscribe.noNewsletter);
      expect(main.match(/<ol class="steps"[^>]*>([\s\S]*?)<\/ol>/)![1].match(/<li>/g)).toHaveLength(3);
      // The page asks for nothing and stores nothing; it does not promise a date.
      expect(text(main)).not.toMatch(/\b20\d\d\b/);
    }
    expect(page(DEMO, "abone")).toMatch(/<link rel="alternate" hreflang="en" href="https:\/\/[^"]+\/en\/subscribe\/">/);
    // Turkish: "akış" for the feed and "RSS okuyucusu" for the reader, never "besleme".
    const tr = text(page(DEMO, "abone").match(/<main[\s\S]*?<\/main>/)![0]);
    expect(tr).not.toMatch(/besleme|akış okuyucu/i);
    expect(tr).toContain(
      "Radar'a abone olmak bugün RSS akışını takip etmek demek: yeni haberler, yayımlandıkça kullandığın RSS okuyucusunda kendiliğinden belirir.",
    );
    expect(tr).toContain("Akış adresi");
    expect(tr).toContain("Bir RSS okuyucusu aç; çoğu ücretsizdir ve telefonda da çalışır.");
    // The feed has one item per story and a day without stories has no issue: no daily promise.
    const en = text(page(DEMO, "en/subscribe").match(/<main[\s\S]*?<\/main>/)![0]);
    expect(en).toContain(
      "Subscribing to Radar today means following its RSS feed: new stories appear in your feed reader as they are published.",
    );
    expect(tr).toContain("Kaydet. Her yeni haber okuyucuna kendiliğinden gelir.");
    expect(en).toContain("Save it. Every new story arrives in your reader by itself.");
    expect(tr).not.toMatch(/her gün|yeni sayı/i);
    expect(en).not.toMatch(/each day|every day|new issue/i);
    expect(JSON.stringify(COPY.tr)).not.toMatch(/besleme/i);
    // The strip's button marks the subscribe page as the current page there.
    expect(page(DEMO, "abone")).toContain('<a class="subscribe label" href="/abone/" aria-current="page">');
  });

  it("every link leaving the site has target=_blank and rel noopener noreferrer, and no internal link has a target", () => {
    let external = 0;
    let internal = 0;
    for (const file of [REAL, DEMO].flatMap(htmlFiles)) {
      for (const { tag, attrs } of anchors(readFileSync(file, "utf8"))) {
        const href = attrs.href ?? "";
        const leaves = /^https?:\/\//.test(href) && new URL(href).origin !== SITE;
        if (leaves) {
          expect(attrs.target, `${file}: ${tag}`).toBe("_blank");
          expect(attrs.rel, `${file}: ${tag}`).toBe("noopener noreferrer");
          external++;
        } else {
          expect(attrs.target, `${file}: ${tag}`).toBeUndefined();
          internal++;
        }
      }
    }
    expect(external).toBeGreaterThan(100);
    expect(internal).toBeGreaterThan(100);
    // The arrow marks outside links in running text only: the footer signature and the Künye page.
    const arrows = declarations(css()).filter((d) => d.prop === "content" && d.value.includes("↗"));
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) {
      for (const part of arrow.selector.split(",").map((x) => x.trim())) {
        expect(part).toMatch(/^\.(sig|prose) a\[target="_blank"\]::after$/);
      }
    }
  });

  it("the per-story line is labelled Neden önemli / Why it matters, with no developer wording left on pages or in feeds", () => {
    expect(COPY.tr.whyItMatters).toBe("Neden önemli");
    expect(COPY.en.whyItMatters).toBe("Why it matters");
    expect(Object.keys(COPY.tr)).not.toContain("forDevelopers");
    for (const file of [REAL, DEMO, HOSTILE].flatMap(allFiles).filter((f) => /\.(html|xml)$/.test(f))) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/Geliştiriciler için|For developers|story-dev/i);
    }
    const xml = readFileSync(join(REAL, "rss.xml"), "utf8");
    expect(items(xml).every((item) => item.includes("\n\nNeden önemli: "))).toBe(true);
    // The pill: ink on page colour, the label face at 0.75rem, fully rounded; inline in the line.
    const sheet = css();
    const pill = cssRule(sheet, ".why-label");
    for (const rule of [
      "background: var(--ink);",
      "color: var(--bg);",
      "font-size: 0.75rem;",
      "letter-spacing: 0.04em;",
      "padding: 0.125rem 0.5rem;",
      "border-radius: 999px;",
    ]) {
      expect(pill).toContain(rule);
    }
    expect(pill).not.toMatch(/display:/);
    const line = cssRule(sheet, ".story-why");
    expect(line).toContain("margin-top: var(--space-3);");
    const hidden = cssRule(sheet, ".visually-hidden");
    for (const rule of ["position: absolute;", "width: 1px;", "height: 1px;", "overflow: hidden;", "clip-path: inset(50%);"]) {
      expect(hidden).toContain(rule);
    }
    expect(line).toContain("font-size: 1rem;");
    expect(line).not.toMatch(/border|background/);
  });

  it("each story block carries its category class and the stylesheet defines the eight category colours", () => {
    const table: Record<string, [string, string]> = {
      protocol: ["#0f6b63", "#dff3f0"],
      model: ["#4338ca", "#e6e8fb"],
      framework: ["#1d4fbf", "#e1ebfb"],
      tooling: ["#8a4b06", "#f8ecd8"],
      research: ["#1b6b3a", "#e0f2e6"],
      security: ["#9f1239", "#fbe4ea"],
      industry: ["#3b4656", "#e8ebf0"],
      policy: ["#8e2a8a", "#f6e4f5"],
    };
    expect(Object.keys(table).sort()).toEqual([...CATEGORIES].sort());
    let seen = 0;
    for (const path of ["", "en", "2026-11-17", "2026-11-18", "en/2026-11-19", "hafta/2026-W47"]) {
      for (const article of articles(page(DEMO, path))) {
        const category = article.match(/<a class="story-cat caps" href="\/(?:en\/topic|konu)\/([a-z]+)\/"/)![1];
        const classes = article.match(/^<article id="[^"]+" class="([^"]+)"/)![1].split(" ");
        expect(classes, path).toContain(`cat-${category}`);
        expect(classes.filter((c) => c.startsWith("cat-"))).toHaveLength(1);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
    // Topic pages: the list rows and the heading tag carry it too.
    for (const category of CATEGORIES) {
      for (const path of [`konu/${category}`, `en/topic/${category}`]) {
        expect(page(DEMO, path), path).toMatch(
          new RegExp(`<h1 class="kunye label cat-${category}">\\s*<span class="topic-tag caps">`),
        );
      }
    }
    expect(page(DEMO, "konu/security")).toMatch(/<li class="cat-security">/);
    const decls = declarations(sheets());
    const value = (selector: string, prop: string) =>
      decls.find((d) => d.selector === selector && d.prop === prop)?.value;
    for (const [category, [colour, tint]] of Object.entries(table)) {
      expect(value(":root", `--cat-${category}`), category).toBe(colour);
      expect(value(":root", `--cat-${category}-soft`), category).toBe(tint);
      expect(value(`.cat-${category}`, "--cat")).toBe(`var(--cat-${category})`);
      expect(value(`.cat-${category}`, "--cat-soft")).toBe(`var(--cat-${category}-soft)`);
      // Text contrast of the colour on the page, on its own tint and on white.
      for (const ground of [value(":root", "--bg")!, tint, value(":root", "--surface")!]) {
        expect(contrast(colour, ground), `${category} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Security reads apart from the brand red of the mark and the arcs.
    expect(table.security[0]).not.toBe(value(":root", "--accent"));
    expect(table.security[0]).not.toBe(value(":root", "--danger"));
    // Exactly three consumers: the tag, the hanging number and the target bar.
    const users = decls.filter((d) => /var\(--cat(-soft)?[,)]/.test(d.value)).map((d) => d.selector);
    for (const selector of users) {
      expect(selector).toMatch(/^(a\.story-cat, \.topic-tag|\.story-cat|\.story-no|\.story:target::before)$/);
    }
    expect(new Set(users)).toEqual(new Set(["a.story-cat, .topic-tag", ".story-cat", ".story-no", ".story:target::before"]));
  });

  it("only the lead card, the subscribe button and the try button have a box-shadow, and none is blurred", () => {
    const shadows = declarations(sheets()).filter((d) => d.prop === "box-shadow");
    expect(shadows.length).toBeGreaterThan(3);
    for (const shadow of shadows) {
      expect(shadow.value === "none" || /^\d+px \d+px 0 var\(--ink\)$/.test(shadow.value), shadow.value).toBe(true);
      for (const part of shadow.selector.split(",").map((x) => x.trim())) {
        expect(part.replace(/:(hover|focus-visible|active)$/, "").replace(/\[aria-current="page"\]$/, "")).toMatch(
          /^(\.story-lead \.try|\.(story-lead|subscribe|try))$/,
        );
        if (part.startsWith(".story-lead .try")) expect(shadow.value).toBe("none");
      }
    }
    // The lead card: a 3px shadow at phone width, 4px from 48rem.
    const lead = cssRule(css(), ".story-lead");
    for (const rule of [
      "padding: 1.25rem;",
      "border: 1.5px solid var(--ink);",
      "background: var(--surface);",
      "box-shadow: 3px 3px 0 var(--ink);",
    ]) {
      expect(lead).toContain(rule);
    }
    expect(
      shadows.find((d) => d.selector === ".story-lead" && d.stack[0] === "@media (min-width: 48rem)")?.value,
    ).toBe("4px 4px 0 var(--ink)");
    // On the subscribe page the strip's button is the current page: flat, on the chip, and still.
    const current = declarations(css()).filter((d) => d.selector.includes('.subscribe[aria-current="page"]'));
    const flat = current.find((d) => d.prop === "box-shadow")!;
    expect(flat.value).toBe("none");
    for (const state of ["", ":hover", ":focus-visible", ":active"]) {
      expect(flat.selector.split(", ")).toContain(`.subscribe[aria-current="page"]${state}`);
    }
    expect(current.find((d) => d.prop === "background" && d.selector === flat.selector)?.value).toBe("var(--chip)");
    expect(current.find((d) => d.prop === "transform" && d.selector === flat.selector)?.value).toBe("none");
    expect(flat.stack.join(" ")).not.toContain("@media");
    // Inside the lead card the try button is flat: no shadow of its own and no movement, in any
    // state; its border stays and hover or focus puts it on the chip. Outside the card it keeps its key.
    const inLead = declarations(css()).filter((d) => d.selector.split(", ").some((s) => s.startsWith(".story-lead .try")));
    const still = inLead.find((d) => d.prop === "box-shadow")!;
    expect(still.value).toBe("none");
    expect(inLead.find((d) => d.prop === "transform" && d.selector === still.selector)?.value).toBe("none");
    for (const state of ["", ":hover", ":focus-visible", ":active"]) {
      expect(still.selector.split(", ")).toContain(`.story-lead .try${state}`);
    }
    expect(still.stack.join(" ")).not.toContain("@media");
    const chip = inLead.find((d) => d.prop === "background")!;
    expect(chip.value).toBe("var(--chip)");
    expect(chip.selector.split(", ").sort()).toEqual([".story-lead .try:focus-visible", ".story-lead .try:hover"]);
    expect(inLead.some((d) => /^border/.test(d.prop))).toBe(false);
    expect(cssRule(css(), ".subscribe,\n.try")).toContain("box-shadow: 3px 3px 0 var(--ink);");
    expect(sheets()).not.toMatch(/gradient\(|backdrop-filter|filter:\s*drop-shadow|text-shadow/);
  });

  it("every animation and transition sits inside a reduced-motion or @supports guard", () => {
    const decls = declarations(sheets());
    const moving = decls.filter((d) => /^(animation|transition)/.test(d.prop) && d.value !== "none");
    expect(moving.length).toBeGreaterThan(5);
    for (const d of moving) {
      const context = d.stack.join(" | ");
      expect(context, `${d.selector} ${d.prop}`).toContain("@media (prefers-reduced-motion: no-preference)");
      if (d.prop === "animation-timeline") expect(context).toMatch(/@supports \(animation-timeline: scroll\(\)\)/);
      if (d.prop.startsWith("transition")) expect(d.value).toMatch(/120ms/);
    }
    // Nothing loops.
    expect(sheets()).not.toMatch(/infinite|alternate/);
    // The progress bar is invisible by default; only the edition view renders it.
    const bar = cssRule(css(), ".progress");
    for (const rule of ["position: fixed;", "top: 0;", "height: 3px;", "transform: scaleX(0);", "transform-origin: 0 50%;"]) {
      expect(bar).toContain(rule);
    }
    expect(decls.some((d) => d.prop === "animation-timeline" && d.value === "scroll(root)")).toBe(true);
    expect(decls.some((d) => d.prop === "animation-timeline" && d.value === "view()")).toBe(true);
    for (const path of ["", "en", "2026-11-18"]) expect(page(DEMO, path)).toContain('<div class="progress" aria-hidden="true"></div>');
    for (const path of ["arsiv", "kunye", "abone", "hafta/2026-W47", "konu/model"]) expect(page(DEMO, path)).not.toContain('class="progress"');
    // Print cancels every animation with the very same selector (so at least equal specificity),
    // and shows stories and lit arcs at full opacity in place, whatever a timeline left behind.
    const animated = decls
      .filter((d) => d.prop === "animation" && d.stack[0] === "@media (prefers-reduced-motion: no-preference)")
      .flatMap((d) => d.selector.split(", "));
    expect(animated.length).toBeGreaterThan(4);
    const print = decls.filter((d) => d.stack[0] === "@media print");
    for (const selector of animated) {
      const reset = print.find((d) => d.prop === "animation" && d.value === "none" && d.selector.split(", ").includes(selector));
      expect(reset, `print does not cancel ${selector}`).toBeDefined();
    }
    for (const selector of [".story:not(.story-lead)", ".echo .echo-on", ".index-list .echo-on"]) {
      const rules = print.filter((d) => d.selector.split(", ").includes(selector));
      expect(rules.find((d) => d.prop === "opacity")?.value, selector).toBe("1");
      expect(rules.find((d) => d.prop === "transform")?.value, selector).toBe("none");
    }
    // Faded or offset states live only in keyframes, never as an element's default.
    for (const d of decls.filter((x) => x.prop === "opacity")) expect(d.stack.join(" ")).toMatch(/@keyframes|@media print/);
    // Where a timeline does not advance (a capture, a throttled view), an element sits at its
    // first keyframe: no keyframe fades a lit arc or a story below half strength.
    const keyframes = decls.filter((d) => d.stack[0]?.startsWith("@keyframes"));
    expect(new Set(keyframes.map((d) => d.stack[0]))).toEqual(
      new Set(["@keyframes arc-in", "@keyframes bar-grow", "@keyframes progress-fill", "@keyframes story-rise"]),
    );
    const fades = keyframes.filter((d) => d.prop === "opacity");
    expect(fades.map((d) => d.stack[0]).sort()).toEqual(["@keyframes arc-in", "@keyframes story-rise"]);
    for (const d of fades) expect(Number(d.value), `${d.stack[0]} ${d.selector}`).toBeGreaterThanOrEqual(0.5);
    const arc = keyframes.filter((d) => d.stack[0] === "@keyframes arc-in");
    expect(arc.map((d) => `${d.selector} ${d.prop}: ${d.value}`)).toEqual([
      "from opacity: 0.5",
      "from transform: translateX(-2px)",
    ]);
  });

  it("the masthead shows the issue pill and the total sources", () => {
    for (const [path, lang] of [["", "tr"], ["en", "en"], ["2026-11-18", "tr"]] as const) {
      const html = page(DEMO, path);
      const total = articles(html).map(sourceCount).reduce((a, b) => a + b, 0);
      expect(text(html.match(/<span class="mh-rest label">([\s\S]*?)<\/span>/)![1])).toMatch(
        new RegExp(`^· \\d+ ${lang === "tr" ? "haber" : "stories"} · ${COPY[lang].sources(total)} · ~\\d+ ${lang === "tr" ? "dk" : "min"}$`),
      );
    }
    const pill = cssRule(css(), ".mh-no");
    expect(pill).toContain("background: var(--accent);");
    expect(pill).toContain("color: var(--surface);");
    expect(pill).toContain("border-radius: 999px;");
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
