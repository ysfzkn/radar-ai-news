// Writes the newsletter's mails as files to look at in a browser: the daily mail and the
// confirmation mail, in Turkish and English, as HTML and as plain text. Sends nothing.
//
//   node --experimental-strip-types scripts/mail-preview.mjs [out-dir] [stories-url]
//
// The stories come from the public read endpoint (default: the live one); the newest edition in
// the answer is the one shown. The links in the preview are examples and lead nowhere.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { confirmMail, dailyMail } from "../src/email.ts";

const out = resolve(process.argv[2] ?? "../dev-notes/mail-preview");
const api = process.argv[3] ?? "https://radar-admin.ozkan-development.workers.dev/api/stories?limit=60";
const SITE = "https://radar.ozkanyusuf.com";
const TOKEN = "0".repeat(64);
const LEAVE = `https://radar-admin.example/api/unsubscribe?token=${TOKEN}`;
const CONFIRM = `https://radar-admin.example/api/subscribe/confirm?token=${TOKEN}`;

const istanbulDay = (iso) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);

const res = await fetch(api, { headers: { accept: "application/json" } });
if (!res.ok) throw new Error(`the stories endpoint answered ${res.status}`);
const { stories } = await res.json();
if (!Array.isArray(stories) || stories.length === 0) throw new Error("no published stories to show");

const days = [...new Set(stories.map((s) => istanbulDay(s.published_at)))].sort();
const day = days.at(-1);
const edition = stories
  .filter((s) => istanbulDay(s.published_at) === day)
  .sort((a, b) => b.source_count - a.source_count || a.published_at.localeCompare(b.published_at) || a.uid.localeCompare(b.uid));

await mkdir(out, { recursive: true });
for (const lang of ["tr", "en"]) {
  const mailStories = edition
    .filter((s) => s.texts[lang])
    .map((s) => ({ ...s, title: s.texts[lang].title, summary: s.texts[lang].summary, dev_line: s.texts[lang].dev_line }));
  const daily = dailyMail(lang, { day, number: days.length, stories: mailStories, siteUrl: SITE, unsubscribeUrl: LEAVE });
  const confirm = confirmMail(lang, { confirmUrl: CONFIRM, siteUrl: SITE });
  await writeFile(join(out, `daily-${lang}.html`), daily.html);
  await writeFile(join(out, `daily-${lang}.txt`), `Subject: ${daily.subject}\n\n${daily.text}`);
  await writeFile(join(out, `confirm-${lang}.html`), confirm.html);
  await writeFile(join(out, `confirm-${lang}.txt`), `Subject: ${confirm.subject}\n\n${confirm.text}`);
  console.log(`${lang}: ${daily.subject} (${mailStories.length} stories, ${Math.round(daily.html.length / 1024)} kB)`);
}
console.log(`written to ${out}`);
