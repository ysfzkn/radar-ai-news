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
  /** The developer panel's heading; the feed adds a colon after it. */
  forDevelopers: string;
  sourceLabel: string;
  tryIt: string;
  /** The heading of an edition's index of stories. */
  inThisIssue: string;
  closed: string;
  previous: string;
  next: string;
  noEdition: string;
  demo: string;
  /** The demo line's short form, put before the feed title in a demo build. */
  demoShort: string;
  otherLang: string;
  skip: string;
  rss: string;
  sourceCode: string;
  categories: Record<Category, string>;
  /** Index 0 is January. */
  months: readonly string[];
  monthsShort: readonly string[];
  /** Index 0 is Sunday, as in `Date#getUTCDay`. */
  weekdays: readonly string[];
  archiveTitle: string;
  issueCount(n: number): string;
  topicTitle(category: string): string;
  topicEmpty: string;
  weekIndexTitle: string;
  /** "47. hafta" / "Week 47". */
  weekLabel(n: number): string;
  previousWeek: string;
  nextWeek: string;
  weekEmpty: string;
  notFoundTitle: string;
  notFoundText: string;
  notFoundHome: string;
  feedTitle: string;
  feedDescription: string;
  method: Method;
}

/** The method page: a few short sections, read top to bottom. */
export interface Method {
  title: string;
  description: string;
  sections: readonly {
    heading: string;
    paragraphs: readonly string[];
    /** The pipeline, in order. */
    steps?: readonly { name: string; text: string }[];
    after?: readonly string[];
    link?: { text: string; href: string };
  }[];
}

const ISSUES = "https://github.com/ysfzkn/radar-ai-news/issues";

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
    forDevelopers: "Geliştiriciler için",
    sourceLabel: "Kaynak:",
    tryIt: "Bugün dene",
    inThisIssue: "Bu sayıda",
    closed: "Baskı kapandı.",
    previous: "Önceki sayı",
    next: "Sonraki sayı",
    noEdition: "Henüz baskı yok.",
    demo: "Örnek veri: bu haberler gerçek değil.",
    demoShort: "Örnek veri",
    otherLang: "English",
    skip: "İçeriğe geç",
    rss: "RSS",
    sourceCode: "Kaynak kodu",
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
    issueCount: (n) => `${n} sayı`,
    topicTitle: (category) => `Konu: ${category}`,
    topicEmpty: "Bu konuda henüz haber yok.",
    weekIndexTitle: "Haftanın öne çıkanları",
    weekLabel: (n) => `${n}. hafta`,
    previousWeek: "Önceki hafta",
    nextWeek: "Sonraki hafta",
    weekEmpty: "Henüz haftalık özet yok.",
    notFoundTitle: "Sayfa bulunamadı",
    notFoundText: "Sayfa bulunamadı.",
    notFoundHome: "Bugünün baskısına dön",
    feedTitle: "Radar: günün yapay zekâ haberleri",
    feedDescription: "Geliştiriciler için günün yapay zekâ haberleri.",
    method: {
      title: "Yöntem",
      description: "Radar haberleri nasıl seçer, yazar ve denetler; neyi bir insana bırakır.",
      sections: [
        {
          heading: "Radar nedir?",
          paragraphs: [
            "Radar, geliştiriciler için her gün çıkan kısa ve numaralı bir yapay zekâ haberleri baskısıdır. Bir baskıda genellikle beş ile sekiz haber olur; her haber, bir geliştirici olarak senin için ne anlama geldiğini söyleyen tek bir satırla biter. Sonra baskı kapanır.",
            "Türkçe ve İngilizce yayımlanır. İki dil aynı olgu kartından yazılır, bu yüzden aynı şeyi söyler.",
          ],
        },
        {
          heading: "Bir haber nasıl hazırlanır?",
          paragraphs: [
            "Haberleri yedi adımlı bir işlem hattı hazırlar. Bu adımlardan yalnızca ikisi bir dil modeli çağırır; diğer beşi sıradan koddur.",
          ],
          steps: [
            { name: "Toplama", text: "Kaynak listesindeki her kaynağı çeker." },
            { name: "Tekilleştirme", text: "Farklı kaynaklarda çıkan aynı haberi tek bir grupta toplar." },
            { name: "Ön eleme", text: "Grupları sıralar ve en iyi 30 adayı tutar." },
            {
              name: "Puanlama",
              text: "Küçük bir model, tek bir toplu çağrıda her adaya ilgi, yenilik ve yararlılık puanı verir; riskli konuları işaretler.",
            },
            {
              name: "Yazım",
              text: "Orta boyutlu bir model önce kaynaktan bir olgu kartı çıkarır, ardından Türkçe ve İngilizce metni bu karttan yazar.",
            },
            { name: "Doğrulama", text: "Kod, metindeki her sayının, sürümün ve adın kaynakta geçtiğini denetler." },
            { name: "Yönlendirme", text: "Haber ya otomatik yayımlanır ya da bir insanın incelemesine gönderilir." },
          ],
          after: [
            "Doğrulama bir güvenlik ağıdır, doğruluğun kanıtı değil: kaynaktaki gerçek bir sayının yanlış bir iddiada kullanıldığını anlayamaz. Bu yüzden şüpheli her şey bir insana gider.",
          ],
        },
        {
          heading: "Yankı ölçer",
          paragraphs: [
            "Her haberin yanındaki beş yay, haberi kaç bağımsız kaynağın verdiğini gösterir: her kaynak için bir yay yanar, en fazla beş. Kaynak sayısı hemen yanında yazar. Böylece gerçekten ses getiren bir haberi tek bir blogun heyecanından ayırabilirsin.",
          ],
        },
        {
          heading: "Haberleri kim yazar?",
          paragraphs: [
            "Her haberi, altında bağlantısı verilen kaynaklardan bir dil modeli yazar.",
            "Riskli konulardaki haberler ancak bir insan okuduktan sonra yayımlanır. Geri kalanlar otomatik denetimden geçtikten sonra kendiliğinden yayımlanır.",
            "Yanlış bir haber düzeltilir ya da yayından kaldırılır.",
          ],
          link: { text: "Yanlış bir haberi GitHub'da bildir", href: ISSUES },
        },
        {
          heading: "Riskli haberler bir insanı bekler",
          paragraphs: [
            "Bazı haberler hiçbir zaman kendiliğinden yayımlanmaz: güvenlik olayları, suçlamalar, yatırım rakamları, üçüncü tarafların benchmark iddiaları ve düzenlemeler. Doğrulamadan geçemeyen ya da birincil kaynağı bulunamayan haberler de bunlara katılır.",
            "Bu haberler bir inceleme kuyruğunda bekler. 72 saat içinde incelenmeyen haberin süresi dolar; hiçbir haber varsayılan olarak yayımlanmaz.",
          ],
        },
        {
          heading: "Yanlış bir haber mi gördün?",
          paragraphs: [
            "Yanlış ya da yanıltıcı bir haber gördüysen haberin bağlantısıyla birlikte bir issue aç. En değerli bildirim budur.",
          ],
          link: { text: "GitHub'da issue aç", href: ISSUES },
        },
        {
          heading: "Gizlilik",
          paragraphs: [
            "Bu site çerez kullanmaz ve üçüncü taraflardan hiçbir şey yüklemez: analitik, reklam, dış yazı tipi ya da betik yok. Her sayfa statik bir HTML dosyasıdır.",
          ],
        },
      ],
    },
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
    forDevelopers: "For developers",
    sourceLabel: "Source:",
    tryIt: "Try it today",
    inThisIssue: "In this issue",
    closed: "End of this edition.",
    previous: "Previous issue",
    next: "Next issue",
    noEdition: "No edition yet.",
    demo: "Demo data: these stories are not real.",
    demoShort: "Demo data",
    otherLang: "Türkçe",
    skip: "Skip to content",
    rss: "RSS",
    sourceCode: "Source code",
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
    issueCount: (n) => (n === 1 ? "1 issue" : `${n} issues`),
    topicTitle: (category) => `Topic: ${category}`,
    topicEmpty: "No stories on this topic yet.",
    weekIndexTitle: "Top stories of the week",
    weekLabel: (n) => `Week ${n}`,
    previousWeek: "Previous week",
    nextWeek: "Next week",
    weekEmpty: "No weekly digest yet.",
    notFoundTitle: "Page not found",
    notFoundText: "Page not found.",
    notFoundHome: "Go to today's edition",
    feedTitle: "Radar: the day's AI news",
    feedDescription: "The day's AI and agentic news for developers.",
    method: {
      title: "Method",
      description: "How Radar chooses, writes and checks its stories, and what it leaves to a person.",
      sections: [
        {
          heading: "What Radar is",
          paragraphs: [
            "Radar is a short, numbered daily edition of AI news for developers. An edition usually has five to eight stories, and each one ends with a single line on what it means for you as a developer. Then the edition closes.",
            "It is published in Turkish and English. Both are written from the same fact card, so they say the same thing.",
          ],
        },
        {
          heading: "How a story is made",
          paragraphs: [
            "A pipeline of seven steps prepares the stories. Only two of them call a language model; the other five are plain code.",
          ],
          steps: [
            { name: "Collect", text: "Pulls every source on the source list." },
            { name: "Deduplicate", text: "Groups the same story from different sources." },
            { name: "Prefilter", text: "Ranks the groups and keeps the top 30 candidates." },
            {
              name: "Score",
              text: "A small model, in one batched call, rates each candidate for relevance, novelty and usefulness and flags risky topics.",
            },
            {
              name: "Write",
              text: "A mid-sized model first builds a fact card from the source, then writes the Turkish and English text from that card.",
            },
            { name: "Verify", text: "Code checks that every number, version and name in the text appears in the source." },
            { name: "Route", text: "The story is published automatically or sent to a person for review." },
          ],
          after: [
            "The check is a safety net, not proof of accuracy: it cannot tell when a real number from the source is used in a wrong claim. That is why anything doubtful goes to a person.",
          ],
        },
        {
          heading: "The echo meter",
          paragraphs: [
            "The five arcs beside each story show how many independent sources covered it: one arc lights up per source, up to five, with the exact count next to them. It separates a story that is making waves from one that a single blog is excited about.",
          ],
        },
        {
          heading: "Who writes the stories",
          paragraphs: [
            "Every story is written by a language model from the sources linked under it.",
            "Stories on risky subjects are published only after a person has read them. The rest are published automatically once they pass the automatic check.",
            "A story that is wrong is corrected or taken down.",
          ],
          link: { text: "Report a wrong story on GitHub", href: ISSUES },
        },
        {
          heading: "Risky stories wait for a person",
          paragraphs: [
            "Some stories never publish themselves: security incidents, accusations, funding figures, third-party benchmark claims and regulation. The same goes for stories that fail the check or have no primary source.",
            "They wait in a review queue. A story nobody reviews within 72 hours expires; nothing is published by default.",
          ],
        },
        {
          heading: "Found a wrong story?",
          paragraphs: [
            "If a story is wrong or misleading, please open an issue with the story's link. It is the most valuable report there is.",
          ],
          link: { text: "Open an issue on GitHub", href: ISSUES },
        },
        {
          heading: "Privacy",
          paragraphs: [
            "This site sets no cookies and loads nothing from third parties: no analytics, no ads, no outside fonts or scripts. Every page is a static HTML file.",
          ],
        },
      ],
    },
  },
};
