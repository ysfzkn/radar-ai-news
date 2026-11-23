// The newsletter's two mails, as subject, HTML and plain text. Pure: no imports, no clock, no
// network, so the same functions serve the Worker, the tests and the preview script.
//
// Mail clients run no script and keep little CSS, so the HTML is tables with inline styles, no
// images, no web fonts and no remote resource of any kind: nothing in it can report an opening,
// and every link goes straight to its address, never through a counter.

export type MailLang = "tr" | "en";

export interface MailStory {
  uid: string;
  category: string;
  source_count: number;
  source_url: string;
  sources: { name: string; url: string }[];
  try_url: string | null;
  title: string;
  summary: string;
  dev_line: string;
}

export interface Mail {
  subject: string;
  html: string;
  text: string;
}

export interface DailyInput {
  /** The edition's Istanbul day, "YYYY-MM-DD". */
  day: string;
  /** The edition's number, as the site counts it. */
  number: number;
  /** In the edition's order; at least one. */
  stories: MailStory[];
  /** The site's origin, without a trailing slash. */
  siteUrl: string;
  /** The reader's own leave link (or UNSUBSCRIBE_SLOT, replaced per reader). */
  unsubscribeUrl: string;
}

/** Stands for the leave link in a mail rendered once and then personalised for each reader. */
export const UNSUBSCRIBE_SLOT = "https://radar.invalid/leave/0000";

// The site's colours (site/src/styles/tokens.css).
const BG = "#f7f7f4";
const SURFACE = "#ffffff";
const INK = "#17181a";
const BODY = "#2b2d31";
const MUTED = "#5a5e66";
const LINE = "#e4e4df";
const ACCENT = "#c2371a";
const ACCENT_SOFT = "#fbeae5";
const CATEGORY: Record<string, { ink: string; soft: string }> = {
  protocol: { ink: "#0f6b63", soft: "#dff3f0" },
  model: { ink: "#4338ca", soft: "#e6e8fb" },
  framework: { ink: "#1d4fbf", soft: "#e1ebfb" },
  tooling: { ink: "#8a4b06", soft: "#f8ecd8" },
  research: { ink: "#1b6b3a", soft: "#e0f2e6" },
  security: { ink: "#9f1239", soft: "#fbe4ea" },
  industry: { ink: "#3b4656", soft: "#e8ebf0" },
  policy: { ink: "#8e2a8a", soft: "#f6e4f5" },
};
const OTHER = { ink: "#3b4656", soft: "#e8ebf0" };

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace";

interface Copy {
  categories: Record<string, string>;
  months: readonly string[];
  weekdays: readonly string[];
  issue: (n: number) => string;
  storyCount: (n: number) => string;
  sources: (n: number) => string;
  minutes: (n: number) => string;
  readTime: (n: number) => string;
  stripCaption: string;
  why: string;
  sourceLabel: string;
  tryIt: string;
  closed: string;
  openOnSite: string;
  footerWhy: string;
  noTracking: string;
  leave: string;
  about: string;
  confirmSubject: string;
  confirmLabel: string;
  confirmTitle: string;
  confirmBody: string;
  confirmButton: string;
  confirmPaste: string;
  confirmIgnore: string;
  confirmPreheader: string;
}

const COPY: Record<MailLang, Copy> = {
  tr: {
    categories: {
      protocol: "Protokol",
      model: "Model",
      framework: "Çatı",
      tooling: "Araçlar",
      research: "Araştırma",
      security: "Güvenlik",
      industry: "Sektör",
      policy: "Politika",
    },
    months: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
    weekdays: ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"],
    issue: (n) => `Sayı ${n}`,
    storyCount: (n) => `${n} haber`,
    sources: (n) => `${n} kaynak`,
    minutes: (n) => `~${n} dk`,
    readTime: (n) => `${n} dk okuma`,
    stripCaption: "Bugünün radarı · her dilim bir haber",
    why: "Neden önemli",
    sourceLabel: "Kaynak:",
    tryIt: "Bugün dene",
    closed: "Bugünlük bu kadar.",
    openOnSite: "Sayıyı sitede aç",
    footerWhy: "Bu e-postayı Radar'ın günlük bültenine abone olduğun için aldın.",
    noTracking: "Açılma ya da tıklama takibi yok.",
    leave: "Abonelikten çık",
    about: "Künye",
    confirmSubject: "Radar aboneliğini onayla",
    confirmLabel: "Abonelik",
    confirmTitle: "Bir adım kaldı.",
    confirmBody: "Bu adresle Radar'ın günlük bültenine abone olmak istendi. Onaylarsan her sabah günün teknoloji ve yapay zekâ haberleri kısa ve öz hâlde gelir.",
    confirmButton: "Aboneliği onayla",
    confirmPaste: "Düğme çalışmazsa bu adresi tarayıcına yapıştır:",
    confirmIgnore: "Bunu sen istemediysen hiçbir şey yapma. Onaylanmayan adres 7 gün sonra silinir ve başka e-posta gelmez.",
    confirmPreheader: "Tek bir düğme: onayla, her sabah gelsin.",
  },
  en: {
    categories: {
      protocol: "Protocol",
      model: "Model",
      framework: "Framework",
      tooling: "Tooling",
      research: "Research",
      security: "Security",
      industry: "Industry",
      policy: "Policy",
    },
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    issue: (n) => `Issue ${n}`,
    storyCount: (n) => (n === 1 ? "1 story" : `${n} stories`),
    sources: (n) => (n === 1 ? "1 source" : `${n} sources`),
    minutes: (n) => `~${n} min`,
    readTime: (n) => `${n} min read`,
    stripCaption: "Today's radar · each band is a story",
    why: "Why it matters",
    sourceLabel: "Source:",
    tryIt: "Try it today",
    closed: "That's all for today.",
    openOnSite: "Open the issue on the site",
    footerWhy: "You are getting this e-mail because you subscribed to Radar's daily newsletter.",
    noTracking: "No open or click tracking.",
    leave: "Unsubscribe",
    about: "About",
    confirmSubject: "Confirm your Radar subscription",
    confirmLabel: "Subscription",
    confirmTitle: "One step left.",
    confirmBody: "Someone asked to subscribe this address to Radar's daily newsletter. Confirm, and the day's tech and AI news arrives every morning, short and to the point.",
    confirmButton: "Confirm subscription",
    confirmPaste: "If the button does not work, paste this address into your browser:",
    confirmIgnore: "If this was not you, do nothing. An address that is not confirmed is deleted after 7 days and gets no more e-mail.",
    confirmPreheader: "One button: confirm, and it arrives every morning.",
  },
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

// Capitals are written out, not left to text-transform: a mail client may drop the language, and
// then "i" would become "I" in Turkish.
function upper(value: string, lang: MailLang): string {
  return lang === "tr" ? value.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase() : value.toUpperCase();
}

function httpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function host(url: string): string {
  try {
    const name = new URL(url).hostname;
    return name.startsWith("www.") ? name.slice(4) : name;
  } catch {
    return "";
  }
}

function dateParts(day: string): { year: number; month: number; date: number; weekday: number } {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return { year: y, month: m - 1, date: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** The site's reading time: the words of every title, summary and "why" line, at 200 a minute. */
export function readingMinutes(stories: readonly MailStory[]): number {
  let words = 0;
  for (const s of stories) {
    const joined = `${s.title} ${s.summary} ${s.dev_line}`.trim();
    if (joined) words += joined.split(/\s+/).length;
  }
  return Math.max(1, Math.ceil(words / 200));
}

const SOURCE_LIMIT = 4;

// The main source first, by its name if the list has it, else by its host: as on the site.
function shownSources(story: MailStory): { shown: { name: string; url: string }[]; more: number } {
  const listed = story.sources.filter((s) => httpUrl(s.url) !== null && s.name.trim() !== "");
  const mainUrl = httpUrl(story.source_url);
  const main = listed.find((s) => s.url === story.source_url);
  const all = mainUrl ? [main ?? { name: host(mainUrl), url: mainUrl }, ...listed.filter((s) => s !== main)] : listed;
  const shown = all.filter((s) => s.name !== "").slice(0, SOURCE_LIMIT);
  return { shown, more: Math.max(0, all.length - shown.length) };
}

const siteRoutes = (siteUrl: string, lang: MailLang) => ({
  home: `${siteUrl}${lang === "tr" ? "/" : "/en/"}`,
  edition: (day: string) => `${siteUrl}${lang === "tr" ? "" : "/en"}/${day}/`,
  story: (day: string, uid: string) => `${siteUrl}${lang === "tr" ? "" : "/en"}/${day}/#s-${uid.slice(0, 8)}`,
  about: `${siteUrl}${lang === "tr" ? "/kunye/" : "/en/about/"}`,
});

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

// The site's depth block: a white plate with an ink border and a hard shadow down and to the
// right. Mail clients drop box-shadow, so the shadow is two real strips of ink.
function plate(rows: string): string {
  return `<table ${TABLE} width="100%" style="width:100%">
<tr>
<td style="background:${SURFACE};border:2px solid ${INK}"><table ${TABLE} width="100%" style="width:100%">${rows}</table></td>
<td width="5" valign="top" style="width:5px;background:${INK};font-size:0;line-height:0"><div style="height:5px;background:${BG};font-size:0;line-height:0">&nbsp;</div></td>
</tr>
<tr><td colspan="2" style="padding-left:5px;font-size:0;line-height:0"><div style="height:5px;background:${INK};font-size:0;line-height:0">&nbsp;</div></td></tr>
</table>`;
}

// Radar's mark is three arcs bulging to the right; in a mail, three brackets.
function masthead(lang: MailLang, right: string, home: string): string {
  return `<table ${TABLE} width="100%" style="width:100%"><tr>
<td style="font:700 15px ${MONO};letter-spacing:.16em;color:${INK}"><a href="${esc(home)}" style="color:${INK};text-decoration:none"><span style="color:${ACCENT};letter-spacing:-.04em">)))</span>&nbsp;RADAR</a></td>
<td align="right" style="font:12px ${MONO};letter-spacing:.1em;color:${MUTED}">${esc(upper(right, lang))}</td>
</tr></table>`;
}

function shell(p: { lang: MailLang; title: string; preheader: string; masthead: string; rows: string; footer: string }): string {
  return `<!doctype html>
<html lang="${p.lang}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(p.title)}</title>
<style>
body{margin:0;padding:0}
@media (max-width:480px){
.outer{padding:18px 8px 28px!important}
.px{padding-left:18px!important;padding-right:18px!important}
.big{font-size:32px!important}
.lead{font-size:23px!important}
.title{font-size:20px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(p.preheader)}</div>
<table ${TABLE} width="100%" style="width:100%;background:${BG}"><tr><td align="center" class="outer" style="padding:28px 12px 40px">
<table ${TABLE} width="600" style="width:100%;max-width:600px">
<tr><td style="padding:0 6px 14px">${p.masthead}</td></tr>
<tr><td>${plate(p.rows)}</td></tr>
<tr><td style="padding:20px 6px 0">${p.footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
}

function button(href: string, label: string, lang: MailLang): string {
  return `<table ${TABLE} align="center" style="margin:0 auto"><tr><td style="background:${INK}"><a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font:700 13px ${MONO};letter-spacing:.08em;color:#ffffff;text-decoration:none">${esc(upper(label, lang))}&nbsp;&rarr;</a></td></tr></table>`;
}

function storyRow(story: MailStory, index: number, lang: MailLang, link: string): string {
  const copy = COPY[lang];
  const cat = CATEGORY[story.category] ?? OTHER;
  const label = copy.categories[story.category] ?? story.category;
  const no = String(index + 1).padStart(2, "0");
  const lead = index === 0;
  const level = Math.min(5, Math.max(1, Math.floor(story.source_count)));
  const bars = `<span style="color:${cat.ink}">${"&#9632;".repeat(level)}</span><span style="color:${LINE}">${"&#9632;".repeat(5 - level)}</span>`;
  const { shown, more } = shownSources(story);
  const sources =
    shown.length === 0
      ? ""
      : `<p style="margin:14px 0 0;font:12px/1.7 ${MONO};color:${MUTED}">${esc(copy.sourceLabel)} ${shown
          .map((s) => `<a href="${esc(s.url)}" style="color:${MUTED};text-decoration:underline">${esc(s.name)}</a>`)
          .join(" &middot; ")}${more > 0 ? ` &middot; +${more}` : ""}</p>`;
  const tryUrl = httpUrl(story.try_url);
  const tryIt = tryUrl
    ? `<p style="margin:16px 0 0"><a href="${esc(tryUrl)}" style="display:inline-block;border:2px solid ${INK};padding:7px 12px;font:700 12px ${MONO};letter-spacing:.06em;color:${INK};text-decoration:none">&#9656;&nbsp;${esc(upper(copy.tryIt, lang))}&nbsp;&middot;&nbsp;${esc(host(tryUrl))}</a></p>`
    : "";
  return `<tr><td class="px" style="padding:24px 30px 26px;border-top:${lead ? `2px solid ${INK}` : `1px solid ${LINE}`}">
<table ${TABLE} width="100%" style="width:100%"><tr>
<td style="font:700 13px ${MONO};color:${cat.ink}">${no}&nbsp;&nbsp;<span style="background:${cat.soft};border:1px solid ${cat.ink};padding:2px 7px;font:700 11px ${MONO};letter-spacing:.1em;color:${cat.ink}">${esc(upper(label, lang))}</span></td>
<td align="right" style="font:12px ${MONO};color:${MUTED};white-space:nowrap"><span style="font-size:9px;letter-spacing:.12em">${bars}</span>&nbsp;${esc(copy.sources(story.source_count))}</td>
</tr></table>
<h2 class="${lead ? "lead" : "title"}" style="margin:12px 0 0;font:${lead ? "800 27px/1.2" : "700 21px/1.28"} ${SANS};letter-spacing:-.02em;color:${INK}"><a href="${esc(link)}" style="color:${INK};text-decoration:none">${esc(story.title)}</a></h2>
<p style="margin:10px 0 0;font:16px/1.6 ${SANS};color:${BODY}">${esc(story.summary)}</p>
<table ${TABLE} width="100%" style="width:100%;margin-top:16px"><tr><td style="border-left:3px solid ${ACCENT};background:${ACCENT_SOFT};padding:11px 14px 12px">
<div style="font:700 11px ${MONO};letter-spacing:.12em;color:${ACCENT}">${esc(upper(copy.why, lang))}</div>
<div style="margin-top:5px;font:15px/1.55 ${SANS};color:${INK}">${esc(story.dev_line)}</div>
</td></tr></table>
${sources}${tryIt}
</td></tr>`;
}

export function dailyMail(lang: MailLang, input: DailyInput): Mail {
  const copy = COPY[lang];
  const { day, number, stories } = input;
  const routes = siteRoutes(input.siteUrl, lang);
  const d = dateParts(day);
  const count = stories.length;
  const minutes = readingMinutes(stories);
  const sourceTotal = stories.reduce((sum, s) => sum + Math.max(0, Math.floor(s.source_count)), 0);
  const lead = stories[0];
  const dayMonth = `${d.date} ${copy.months[d.month] ?? ""}`;
  const subject = `Radar ${number} · ${lead ? lead.title : dayMonth}`;
  const preheader = stories.slice(1, 4).map((s) => s.title).join(" · ") || copy.storyCount(count);
  const facts = `${copy.storyCount(count)} · ${copy.sources(sourceTotal)} · ${copy.minutes(minutes)}`;

  // The edition's fingerprint: one band per story, in its topic's colour, in reading order.
  const bands = stories
    .map((s, i) => {
      const gap = i < count - 1 ? `;border-right:3px solid ${SURFACE}` : "";
      return `<td height="10" style="height:10px;background:${(CATEGORY[s.category] ?? OTHER).ink};font-size:0;line-height:0${gap}">&nbsp;</td>`;
    })
    .join("");

  const rows = `<tr><td class="px" style="padding:26px 30px 18px">
<div style="font:12px ${MONO};letter-spacing:.12em;color:${MUTED}">${esc(upper(`${copy.weekdays[d.weekday] ?? ""} · ${d.year}`, lang))}</div>
<div class="big" style="margin-top:6px;font:800 40px/1.05 ${SANS};letter-spacing:-.035em;color:${INK}">${esc(dayMonth)}</div>
<div style="margin-top:10px;font:13px ${MONO};color:${MUTED}">${esc(facts)}</div>
</td></tr>
<tr><td class="px" style="padding:0 30px 22px">
<table ${TABLE} width="100%" style="width:100%;table-layout:fixed"><tr>${bands}</tr></table>
<div style="padding-top:8px;font:11px ${MONO};letter-spacing:.08em;color:${MUTED}">${esc(upper(copy.stripCaption, lang))}</div>
</td></tr>
${stories.map((s, i) => storyRow(s, i, lang, routes.story(day, s.uid))).join("\n")}
<tr><td class="px" align="center" style="padding:28px 30px 32px;border-top:2px solid ${INK};background:${BG}">
<div style="font:800 23px/1.2 ${SANS};letter-spacing:-.02em;color:${INK}">${esc(copy.closed)}</div>
<div style="margin:7px 0 20px;font:12px ${MONO};letter-spacing:.04em;color:${MUTED}">${esc(`${copy.issue(number)} · ${copy.storyCount(count)} · ${copy.readTime(minutes)}`)}</div>
${button(routes.edition(day), copy.openOnSite, lang)}
</td></tr>`;

  const footer = `<p style="margin:0;font:12px/1.7 ${MONO};color:${MUTED}">${esc(copy.footerWhy)} ${esc(copy.noTracking)}</p>
<p style="margin:10px 0 0;font:12px/1.7 ${MONO};color:${MUTED}"><a href="${esc(input.unsubscribeUrl)}" style="color:${INK}">${esc(copy.leave)}</a> &middot; <a href="${esc(routes.home)}" style="color:${INK}">${esc(host(routes.home))}</a> &middot; <a href="${esc(routes.about)}" style="color:${INK}">${esc(copy.about)}</a></p>`;

  const html = shell({
    lang,
    title: subject,
    preheader,
    masthead: masthead(lang, copy.issue(number), routes.home),
    rows,
    footer,
  });

  const text = [
    `))) RADAR · ${copy.issue(number)} · ${dayMonth} ${d.year} ${copy.weekdays[d.weekday] ?? ""}`.trim(),
    facts,
    "",
    ...stories.flatMap((s, i) => {
      const { shown } = shownSources(s);
      const tryUrl = httpUrl(s.try_url);
      return [
        `${String(i + 1).padStart(2, "0")} · ${upper(copy.categories[s.category] ?? s.category, lang)}`,
        s.title,
        "",
        s.summary,
        "",
        `${copy.why}: ${s.dev_line}`,
        ...(shown.length > 0 ? ["", ...shown.map((src) => `${copy.sourceLabel} ${src.name} ${src.url}`)] : []),
        ...(tryUrl ? [`${copy.tryIt}: ${tryUrl}`] : []),
        "",
        "- - -",
        "",
      ];
    }),
    copy.closed,
    `${copy.openOnSite}: ${routes.edition(day)}`,
    "",
    `${copy.footerWhy} ${copy.noTracking}`,
    `${copy.leave}: ${input.unsubscribeUrl}`,
    "",
  ].join("\n");

  return { subject, html, text };
}

export function confirmMail(lang: MailLang, input: { confirmUrl: string; siteUrl: string }): Mail {
  const copy = COPY[lang];
  const routes = siteRoutes(input.siteUrl, lang);
  const rows = `<tr><td class="px" style="padding:30px 30px 8px">
<div style="font:12px ${MONO};letter-spacing:.12em;color:${ACCENT}">${esc(upper(copy.confirmLabel, lang))}</div>
<div class="big" style="margin-top:8px;font:800 36px/1.08 ${SANS};letter-spacing:-.035em;color:${INK}">${esc(copy.confirmTitle)}</div>
<p style="margin:16px 0 0;font:16px/1.6 ${SANS};color:${BODY}">${esc(copy.confirmBody)}</p>
</td></tr>
<tr><td class="px" align="center" style="padding:22px 30px 28px">${button(input.confirmUrl, copy.confirmButton, lang)}</td></tr>
<tr><td class="px" style="padding:20px 30px 26px;border-top:1px solid ${LINE};background:${BG}">
<p style="margin:0;font:12px/1.7 ${MONO};color:${MUTED}">${esc(copy.confirmPaste)}<br><a href="${esc(input.confirmUrl)}" style="color:${INK};word-break:break-all">${esc(input.confirmUrl)}</a></p>
<p style="margin:14px 0 0;font:13px/1.6 ${SANS};color:${MUTED}">${esc(copy.confirmIgnore)}</p>
</td></tr>`;
  const footer = `<p style="margin:0;font:12px/1.7 ${MONO};color:${MUTED}"><a href="${esc(routes.home)}" style="color:${INK}">${esc(host(routes.home))}</a> &middot; <a href="${esc(routes.about)}" style="color:${INK}">${esc(copy.about)}</a></p>`;
  const html = shell({
    lang,
    title: copy.confirmSubject,
    preheader: copy.confirmPreheader,
    masthead: masthead(lang, copy.confirmLabel, routes.home),
    rows,
    footer,
  });
  const text = [
    `))) RADAR · ${copy.confirmTitle}`,
    "",
    copy.confirmBody,
    "",
    `${copy.confirmButton}: ${input.confirmUrl}`,
    "",
    copy.confirmIgnore,
    "",
  ].join("\n");
  return { subject: copy.confirmSubject, html, text };
}
