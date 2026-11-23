import { describe, expect, it } from "vitest";
import { UNSUBSCRIBE_SLOT, confirmMail, dailyMail, readingMinutes, type MailStory } from "../src/email";

const SITE = "https://radar.ozkanyusuf.com";
const LEAVE = `https://admin.example/api/unsubscribe?token=${"a".repeat(64)}`;

const story = (change: Partial<MailStory> = {}): MailStory => ({
  uid: "0123456789abcdef0123456789abcdef",
  category: "model",
  source_count: 3,
  source_url: "https://example.org/post",
  sources: [
    { name: "Example Blog", url: "https://example.org/post" },
    { name: "Other", url: "https://other.example/x" },
  ],
  try_url: null,
  title: "Yeni model yayında",
  summary: "Kısa bir özet.",
  dev_line: "Bugün deneyebilirsin.",
  ...change,
});

const daily = (stories: MailStory[], lang: "tr" | "en" = "tr") =>
  dailyMail(lang, { day: "2026-11-23", number: 12, stories, siteUrl: SITE, unsubscribeUrl: LEAVE });

describe("the daily mail", () => {
  it("has the issue number and the lead headline as its subject", () => {
    expect(daily([story(), story({ title: "İkinci" })]).subject).toBe("Radar 12 · Yeni model yayında");
  });

  it("shows the date, the counts and every story with its topic, summary, why line and sources", () => {
    const mail = daily([story(), story({ uid: "f".repeat(32), category: "security", title: "İkinci haber", source_count: 1 })]);
    expect(mail.html).toContain("23 Kasım");
    expect(mail.html).toContain("PAZARTESİ · 2026");
    expect(mail.html).toContain("2 haber · 4 kaynak · ~1 dk");
    expect(mail.html).toContain("SAYI 12");
    expect(mail.html).toContain(">MODEL<");
    expect(mail.html).toContain(">GÜVENLİK<");
    expect(mail.html).toContain("NEDEN ÖNEMLİ");
    expect(mail.html).toContain("Kısa bir özet.");
    expect(mail.html).toContain("Bugün deneyebilirsin.");
    expect(mail.html).toContain('<a href="https://example.org/post" style="color:#5a5e66;text-decoration:underline">Example Blog</a>');
    expect(mail.html).toContain("Bugünlük bu kadar.");
    // One band per story in the strip, in the topic's colour.
    expect(mail.html.match(/<td height="10"/g)).toHaveLength(2);
    expect(mail.html).toContain("height:10px;background:#4338ca");
    expect(mail.html).toContain("height:10px;background:#9f1239");
  });

  it("links each headline to its story on the site and the button to the edition, in the mail's language", () => {
    const tr = daily([story()]);
    expect(tr.html).toContain(`href="${SITE}/2026-11-23/#s-01234567"`);
    expect(tr.html).toContain(`href="${SITE}/2026-11-23/"`);
    expect(tr.html).toContain(`href="${SITE}/kunye/"`);
    const en = daily([story({ title: "A new model" })], "en");
    expect(en.html).toContain('<html lang="en"');
    expect(en.html).toContain(`href="${SITE}/en/2026-11-23/#s-01234567"`);
    expect(en.html).toContain(`href="${SITE}/en/about/"`);
    expect(en.html).toContain("MONDAY · 2026");
    expect(en.html).toContain("1 story · 3 sources · ~1 min");
    expect(en.html).toContain("WHY IT MATTERS");
    expect(en.subject).toBe("Radar 12 · A new model");
  });

  it("carries the reader's leave link in the HTML and in the text", () => {
    const mail = daily([story()]);
    expect(mail.html).toContain(`<a href="${LEAVE}" style="color:#17181a">Abonelikten çık</a>`);
    expect(mail.text).toContain(`Abonelikten çık: ${LEAVE}`);
  });

  it("rendered with the slot, every occurrence of the slot is the leave link", () => {
    const mail = dailyMail("tr", { day: "2026-11-23", number: 1, stories: [story()], siteUrl: SITE, unsubscribeUrl: UNSUBSCRIBE_SLOT });
    expect(mail.html.split(UNSUBSCRIBE_SLOT)).toHaveLength(2);
    expect(mail.text.split(UNSUBSCRIBE_SLOT)).toHaveLength(2);
    expect(mail.html.replaceAll(UNSUBSCRIBE_SLOT, LEAVE)).toBe(daily([story()]).html.replace("SAYI 12", "SAYI 1").replaceAll("Radar 12", "Radar 1").replaceAll("Sayı 12", "Sayı 1"));
  });

  it("loads nothing from anywhere: no image, no script, no stylesheet, no font, no form", () => {
    const { html } = daily([story({ try_url: "https://github.com/x/y" })]);
    expect(html).not.toMatch(/<img|<script|<link|<iframe|<form|<object|<video|@import|url\(|src=/i);
    // Every link is a plain address the reader can see: the site, a source or the leave link.
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href.startsWith(SITE) || href === LEAVE || href.startsWith("https://example.org") || href.startsWith("https://other.example") || href.startsWith("https://github.com"), href).toBe(true);
    }
  });

  it("escapes story text and source names, in the body and in attributes", () => {
    const mail = daily([
      story({
        title: `<script>alert(1)</script> & "quotes"`,
        summary: "a < b > c",
        dev_line: "it's <b>bold</b>",
        sources: [{ name: `<img src=x onerror=1>`, url: `https://example.org/post?a=1&b="2"` }],
        source_url: "https://example.org/other",
      }),
    ]);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>bold</b>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;");
    expect(mail.html).toContain("it&#39;s &lt;b&gt;bold&lt;/b&gt;");
    expect(mail.html).toContain('href="https://example.org/post?a=1&amp;b=&quot;2&quot;"');
    // The plain text keeps the words as written.
    expect(mail.text).toContain(`<script>alert(1)</script> & "quotes"`);
  });

  it("never turns a non-http address into a link", () => {
    const mail = daily([
      story({
        source_url: "javascript:alert(1)",
        sources: [{ name: "Bad", url: "javascript:alert(2)" }, { name: "Data", url: "data:text/html,x" }],
        try_url: "javascript:alert(3)",
      }),
    ]);
    expect(mail.html).not.toMatch(/javascript:|data:/);
    expect(mail.text).not.toMatch(/javascript:|data:/);
    expect(mail.html).not.toContain("Kaynak:");
    expect(mail.html).not.toContain("BUGÜN DENE");
  });

  it("puts the main source first, by host when the list does not name it, and shows at most four", () => {
    const mail = daily([
      story({
        source_url: "https://www.main.example/a",
        sources: ["A", "B", "C", "D", "E"].map((name) => ({ name, url: `https://${name.toLowerCase()}.example/` })),
      }),
    ]);
    const line = mail.html.match(/Kaynak:[\s\S]*?<\/p>/)![0];
    expect(line.replace(/<[^>]+>/g, "")).toBe("Kaynak: main.example &middot; A &middot; B &middot; C &middot; +2");
  });

  it("shows the try-it button only for a story that has one, with the host", () => {
    expect(daily([story()]).html).not.toContain("BUGÜN DENE");
    const mail = daily([story({ try_url: "https://www.github.com/x/y" })]);
    expect(mail.html).toContain("BUGÜN DENE&nbsp;&middot;&nbsp;github.com");
    expect(mail.text).toContain("Bugün dene: https://www.github.com/x/y");
  });

  it("writes Turkish capitals itself and uses a neutral colour for an unknown topic", () => {
    const mail = daily([story({ category: "industry" }), story({ category: "brand-new" })]);
    expect(mail.html).toContain(">SEKTÖR<");
    expect(mail.html).toContain(">BRAND-NEW<");
    expect(mail.html).not.toContain("text-transform");
  });

  it("the plain text has every story, numbered, and the edition's address", () => {
    const mail = daily([story(), story({ title: "İkinci haber", category: "tooling" })]);
    expect(mail.text).toContain("))) RADAR · Sayı 12 · 23 Kasım 2026 Pazartesi");
    expect(mail.text).toContain("01 · MODEL\nYeni model yayında");
    expect(mail.text).toContain("02 · ARAÇLAR\nİkinci haber");
    expect(mail.text).toContain("Neden önemli: Bugün deneyebilirsin.");
    expect(mail.text).toContain(`Sayıyı sitede aç: ${SITE}/2026-11-23/`);
  });

  it("counts reading time as the site does: 200 words a minute, at least one", () => {
    expect(readingMinutes([story()])).toBe(1);
    expect(readingMinutes([story({ summary: Array(401).fill("söz").join(" ") })])).toBe(3);
  });
});

describe("the confirmation mail", () => {
  const link = `https://admin.example/api/subscribe/confirm?token=${"c".repeat(64)}`;

  it("has the link as a button, as text to paste and in the plain text, and says what happens otherwise", () => {
    const mail = confirmMail("tr", { confirmUrl: link, siteUrl: SITE });
    expect(mail.subject).toBe("Radar aboneliğini onayla");
    expect(mail.html.split(`href="${link}"`)).toHaveLength(3);
    expect(mail.html).toContain(`>${link}</a>`);
    expect(mail.html).toContain("ABONELİĞİ ONAYLA");
    expect(mail.html).toContain("7 gün sonra silinir");
    expect(mail.text).toContain(`Aboneliği onayla: ${link}`);
    expect(mail.html).not.toMatch(/<img|<script|<link|src=/i);
  });

  it("is in English for an English reader", () => {
    const mail = confirmMail("en", { confirmUrl: link, siteUrl: SITE });
    expect(mail.subject).toBe("Confirm your Radar subscription");
    expect(mail.html).toContain("CONFIRM SUBSCRIPTION");
    expect(mail.html).toContain(`href="${SITE}/en/about/"`);
  });
});
