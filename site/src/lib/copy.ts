import type { Category, Lang } from "./schema";

/** Every user-visible string of the site, Turkish and English side by side. */
export interface Copy {
  siteName: string;
  tagline: string;
  nav: { today: string; archive: string; week: string; method: string };
  issue(n: number): string;
  storyCount(n: number): string;
  minutes(n: number): string;
  sources(n: number): string;
  echoLabel(level: number, n: number): string;
  forDevelopers: string;
  sourceLabel: string;
  tryIt: string;
  label: { auto: string; human: string };
  closed: string;
  previous: string;
  next: string;
  noEdition: string;
  demo: string;
  otherLang: string;
  skip: string;
  categories: Record<Category, string>;
  /** Index 0 is January. */
  months: readonly string[];
  monthsShort: readonly string[];
  /** Index 0 is Sunday, as in `Date#getUTCDay`. */
  weekdays: readonly string[];
  archiveTitle: string;
  topicTitle(category: string): string;
  weekIndexTitle: string;
  weekTitle(id: string): string;
  notFoundTitle: string;
  notFoundText: string;
  feedTitle: string;
  feedDescription: string;
}

export const COPY: Record<Lang, Copy> = {
  tr: {
    siteName: "Radar",
    tagline: "Geliştiriciler için günün yapay zekâ haberleri. Beş dakika, gürültü yok.",
    nav: { today: "Bugün", archive: "Arşiv", week: "Hafta", method: "Yöntem" },
    issue: (n) => `Sayı ${n}`,
    storyCount: (n) => `${n} haber`,
    minutes: (n) => `~${n} dk`,
    sources: (n) => `${n} kaynak`,
    echoLabel: (level, n) => `5 üzerinden ${level}: ${n} bağımsız kaynak`,
    forDevelopers: "Geliştiriciler için:",
    sourceLabel: "Kaynak:",
    tryIt: "Bugün dene",
    label: {
      auto: "AI yazdı · otomatik yayımlandı",
      human: "AI yazdı · insan onayladı",
    },
    closed: "Baskı kapandı.",
    previous: "Önceki sayı",
    next: "Sonraki sayı",
    noEdition: "Henüz baskı yok.",
    demo: "Örnek veri: bu haberler gerçek değil.",
    otherLang: "English",
    skip: "İçeriğe geç",
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
    months: [
      "Ocak",
      "Şubat",
      "Mart",
      "Nisan",
      "Mayıs",
      "Haziran",
      "Temmuz",
      "Ağustos",
      "Eylül",
      "Ekim",
      "Kasım",
      "Aralık",
    ],
    monthsShort: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
    weekdays: ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"],
    archiveTitle: "Arşiv",
    topicTitle: (category) => `Konu: ${category}`,
    weekIndexTitle: "Haftanın öne çıkanları",
    weekTitle: (id) => `Hafta ${id}`,
    notFoundTitle: "Sayfa bulunamadı",
    notFoundText: "Aradığın sayfa yok. Bugünün baskısına dönebilirsin.",
    feedTitle: "Radar: günün yapay zekâ haberleri",
    feedDescription: "Geliştiriciler için günün yapay zekâ haberleri.",
  },
  en: {
    siteName: "Radar",
    tagline: "The day's AI and agentic news for developers. Five minutes, no noise.",
    nav: { today: "Today", archive: "Archive", week: "Week", method: "Method" },
    issue: (n) => `Issue ${n}`,
    storyCount: (n) => (n === 1 ? "1 story" : `${n} stories`),
    minutes: (n) => `~${n} min`,
    sources: (n) => (n === 1 ? "1 source" : `${n} sources`),
    echoLabel: (level, n) =>
      `${level} of 5: ${n} independent ${n === 1 ? "source" : "sources"}`,
    forDevelopers: "For developers:",
    sourceLabel: "Source:",
    tryIt: "Try it today",
    label: {
      auto: "Written by AI · auto-published",
      human: "Written by AI · human-approved",
    },
    closed: "End of this edition.",
    previous: "Previous issue",
    next: "Next issue",
    noEdition: "No edition yet.",
    demo: "Demo data: these stories are not real.",
    otherLang: "Türkçe",
    skip: "Skip to content",
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
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    archiveTitle: "Archive",
    topicTitle: (category) => `Topic: ${category}`,
    weekIndexTitle: "Top stories of the week",
    weekTitle: (id) => `Week ${id}`,
    notFoundTitle: "Page not found",
    notFoundText: "There is no such page. You can go back to today's edition.",
    feedTitle: "Radar: the day's AI news",
    feedDescription: "The day's AI and agentic news for developers.",
  },
};
