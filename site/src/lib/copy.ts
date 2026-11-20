import { OWNER } from "./routes";
import type { Category, Lang } from "./schema";

/** Every user-visible string of the site, Turkish and English side by side. */
export interface Copy {
  siteName: string;
  tagline: string;
  nav: { today: string; archive: string; week: string; about: string };
  issue(n: number): string;
  storyCount(n: number): string;
  minutes(n: number): string;
  sources(n: number): string;
  echoLabel(level: number, n: number): string;
  /** The label of a story's last line; the feed adds a colon after it. */
  whyItMatters: string;
  /** Read, not shown, after the pill of that label, so a screen reader pauses before the line. */
  labelColon: string;
  sourceLabel: string;
  tryIt: string;
  /** The heading of an edition's index of stories. */
  inThisIssue: string;
  /** The scope of an edition: its name, the line under it and the readout's resting line. */
  scope: {
    label: string;
    caption: string;
    idle: string;
  };
  /** The end of an edition: the closing line, and its reading time under it. */
  closed: string;
  readTime(minutes: number): string;
  previous: string;
  next: string;
  noEdition: string;
  demo: string;
  /** The demo line's short form, put before the feed title in a demo build. */
  demoShort: string;
  /** The accessible name of a story's number (the two digits shown), a link to the story itself. */
  storyLink(no: string): string;
  /** The name of the language switch in the top strip. */
  language: string;
  /** This language's code in the switch: "TR" / "EN". */
  langShort: string;
  skip: string;
  rss: string;
  sourceCode: string;
  /** The owner's name, in the footer signature. */
  owner: string;
  /** The owner's site as shown beside the wordmark and in the footer. */
  by: string;
  github: string;
  /** The subscribe button, in the top strip and under the end of an edition. */
  subscribeFree: string;
  /** The line before the button under the end of an edition. */
  dontMiss: string;
  categories: Record<Category, string>;
  /** Index 0 is January. */
  months: readonly string[];
  monthsShort: readonly string[];
  /** Index 0 is Sunday, as in `Date#getUTCDay`. */
  weekdays: readonly string[];
  archiveTitle: string;
  issueCount(n: number): string;
  /** The archive search: its region, input label, topic chips, month select, source toggle, count, clear button, failure line. */
  search: {
    region: string;
    label: string;
    topics: string;
    allTopics: string;
    month: string;
    allMonths: string;
    /** The toggle for stories with three or more sources. */
    echo: string;
    clear: string;
    count(n: number): string;
    /**
     * What the search script writes, as templates with `{n}` where the number goes (filled by
     * `fill` in lib/search.ts); a test keeps them equal to `sources` and `count`.
     */
    templates: {
      sourceOne: string;
      sourceMany: string;
      countNone: string;
      countOne: string;
      countMany: string;
      /** Under the list when more were found than are shown. */
      more: string;
    };
    /** The empty state: a line and a hint. */
    emptyTitle: string;
    emptyHint: string;
    failed: string;
    /** The heat strip's name and one day's accessible name, for example "20 Kasım 2026, 6 haber". */
    heat: string;
    heatDay(date: string, n: number): string;
    /** The two ends of the heat strip's key. */
    heatLess: string;
    heatMore: string;
  };
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
  about: About;
  subscribe: Subscribe;
}

/** The Künye / About page: who makes Radar, then how a story is made, read top to bottom. */
export interface About {
  title: string;
  description: string;
  sections: readonly {
    heading: string;
    paragraphs: readonly string[];
    /** The pipeline, in order. */
    steps?: readonly { name: string; text: string }[];
    after?: readonly string[];
    /** Links that leave the site, in one line under the section. */
    links?: readonly { text: string; href: string }[];
  }[];
}

/** The subscribe page: what subscribing means today, the feed address and how to use it. */
export interface Subscribe {
  description: string;
  intro: readonly string[];
  feedHeading: string;
  stepsHeading: string;
  steps: readonly string[];
  /** The sentence before the link to the other language's feed, and that link's text. */
  otherFeed: string;
  otherFeedLink: string;
  noNewsletter: string;
}

const { site: SITE, github: GITHUB, repository: REPOSITORY, issues: ISSUES } = OWNER;

export const COPY: Record<Lang, Copy> = {
  tr: {
    siteName: "Radar",
    tagline: "Günün teknoloji ve yapay zekâ haberleri. Beş dakika, gürültü yok.",
    nav: { today: "Bugün", archive: "Arşiv", week: "Hafta", about: "Künye" },
    issue: (n) => `Sayı ${n}`,
    storyCount: (n) => `${n} haber`,
    minutes: (n) => `~${n} dk`,
    sources: (n) => `${n} kaynak`,
    echoLabel: (level, n) => `5 üzerinden ${level}: ${n} bağımsız kaynak`,
    whyItMatters: "Neden önemli",
    labelColon: ":",
    sourceLabel: "Kaynak:",
    tryIt: "Bugün dene",
    inThisIssue: "Bu sayıda",
    scope: {
      label: "Bugünün radarı",
      caption: "Merkeze yakın: daha çok kaynak",
      idle: "Her nokta bir haber.",
    },
    closed: "Bugünlük bu kadar.",
    readTime: (n) => `${n} dk okuma`,
    previous: "Önceki sayı",
    next: "Sonraki sayı",
    noEdition: "Henüz baskı yok.",
    demo: "Örnek veri: bu haberler gerçek değil.",
    demoShort: "Örnek veri",
    storyLink: (no) => `${no} numaralı haberin bağlantısı`,
    language: "Dil",
    langShort: "TR",
    skip: "İçeriğe geç",
    rss: "RSS",
    sourceCode: "Kaynak kodu",
    owner: "Yusuf Özkan",
    by: "ozkanyusuf.com",
    github: "GitHub",
    subscribeFree: "Ücretsiz abone ol",
    dontMiss: "Sonraki sayıyı kaçırma.",
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
    search: {
      region: "Arşivde ara",
      label: "Haberlerde ara",
      topics: "Konu",
      allTopics: "Tümü",
      month: "Ay",
      allMonths: "Tüm aylar",
      echo: "3+ kaynak",
      clear: "Temizle",
      count: (n) => (n === 0 ? "Sonuç yok." : `${n} sonuç`),
      templates: {
        sourceOne: "1 kaynak",
        sourceMany: "{n} kaynak",
        countNone: "Sonuç yok.",
        countOne: "1 sonuç",
        countMany: "{n} sonuç",
        more: "İlk {n} sonuç gösteriliyor.",
      },
      emptyTitle: "Bu aramayla eşleşen haber yok.",
      emptyHint: "Daha kısa bir sözcük dene ya da filtreleri temizle.",
      failed: "Arama şu an çalışmıyor; arşiv listesi aşağıda.",
      heat: "Son 26 hafta: her kare bir gün",
      heatDay: (date, n) => `${date}, ${n} haber`,
      heatLess: "az",
      heatMore: "çok",
    },
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
    feedTitle: "Radar: günün teknoloji ve yapay zekâ haberleri",
    feedDescription: "Günün teknoloji ve yapay zekâ haberleri. Beş dakika, gürültü yok.",
    about: {
      title: "Künye",
      description: "Radar'ı kim çıkarıyor; haberler nasıl seçiliyor, yazılıyor ve denetleniyor.",
      sections: [
        {
          heading: "Radar'ı kim çıkarıyor?",
          paragraphs: [
            "Radar, Yusuf Özkan'ın kişisel projesi; onu o yürütüyor ve sitenin kaynak kodu herkese açık.",
          ],
          links: [
            { text: "ozkanyusuf.com", href: SITE },
            { text: "GitHub", href: GITHUB },
            { text: "Radar'ın kaynak kodu", href: REPOSITORY },
          ],
        },
        {
          heading: "Radar nedir?",
          paragraphs: [
            "Radar, her gün çıkan kısa ve numaralı bir teknoloji ve yapay zekâ haberleri baskısıdır. Bir baskıda genellikle beş ile sekiz haber olur; her haber, neden önemli olduğunu söyleyen tek bir satırla biter. Sonra baskı kapanır.",
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
            "Her haberi bir dil modeli, haberin altında bağlantıları verilen kaynaklardan yazar.",
            "Riskli konulardaki haberler ancak bir insan okuduktan sonra yayımlanır. Geri kalanlar otomatik denetimden geçtikten sonra kendiliğinden yayımlanır.",
            "Yanlış bir haber düzeltilir ya da yayından kaldırılır.",
          ],
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
          links: [{ text: "GitHub'da issue aç", href: ISSUES }],
        },
        {
          heading: "Gizlilik",
          paragraphs: [
            "Bu site çerez kullanmaz, seni izlemez ve üçüncü taraflardan hiçbir şey yüklemez: analitik, reklam ya da dış yazı tipi yok. Her sayfa statik bir HTML dosyasıdır ve betik olmadan da eksiksiz çalışır.",
            "Sitenin kendi küçük betiği yalnızca bir kolaylık ekler: arşivde arama (arama verisi bu siteden gelir), radar ekranının eğimi ve okunan haberlerin işareti, “Neden önemli” satırının belirişi ve günün ilk sayfasındaki kısa açılış. Hareketi azaltmayı seçtiysen hareketlerin hiçbiri oynamaz.",
            "Açılışın bir kez gösterildiğini hatırlamak için tarayıcının oturum belleğine tek bir anahtar yazılır: radar:intro. Sekme kapanınca silinir. Başka hiçbir şey saklanmaz ve hiçbir yere gönderilmez.",
          ],
        },
      ],
    },
    subscribe: {
      description: "Radar'ı RSS ile ücretsiz takip et: hesap yok, e-posta yok.",
      intro: [
        "Radar'a abone olmak bugün RSS akışını takip etmek demek: yeni haberler, yayımlandıkça kullandığın RSS okuyucusunda kendiliğinden belirir.",
        "Ücretsiz. Hesap yok, e-posta adresi yok; hiçbir şey kaydedilmez.",
      ],
      feedHeading: "Akış adresi",
      stepsHeading: "Üç adımda",
      steps: [
        "Bir RSS okuyucusu aç; çoğu ücretsizdir ve telefonda da çalışır.",
        "Yeni bir abonelik ekle ve yukarıdaki adresi yapıştır.",
        "Kaydet. Her yeni haber okuyucuna kendiliğinden gelir.",
      ],
      otherFeed: "İngilizce sayıların ayrı bir akışı var:",
      otherFeedLink: "İngilizce akış",
      noNewsletter: "E-posta bülteni yok; Radar'ı şimdilik yalnızca RSS ile takip edebilirsin.",
    },
  },
  en: {
    siteName: "Radar",
    tagline: "The day's tech and AI news. Five minutes, no noise.",
    nav: { today: "Today", archive: "Archive", week: "Week", about: "About" },
    issue: (n) => `Issue ${n}`,
    storyCount: (n) => (n === 1 ? "1 story" : `${n} stories`),
    minutes: (n) => `~${n} min`,
    sources: (n) => (n === 1 ? "1 source" : `${n} sources`),
    echoLabel: (level, n) =>
      `${level} of 5: ${n} independent ${n === 1 ? "source" : "sources"}`,
    whyItMatters: "Why it matters",
    labelColon: ":",
    sourceLabel: "Source:",
    tryIt: "Try it today",
    inThisIssue: "In this issue",
    scope: {
      label: "Today's radar",
      caption: "Nearer the centre: more sources",
      idle: "Each blip is a story.",
    },
    closed: "That's all for today.",
    readTime: (n) => `${n} min read`,
    previous: "Previous issue",
    next: "Next issue",
    noEdition: "No edition yet.",
    demo: "Demo data: these stories are not real.",
    demoShort: "Demo data",
    storyLink: (no) => `Link to story ${no}`,
    language: "Language",
    langShort: "EN",
    skip: "Skip to content",
    rss: "RSS",
    sourceCode: "Source code",
    owner: "Yusuf Özkan",
    by: "ozkanyusuf.com",
    github: "GitHub",
    subscribeFree: "Subscribe free",
    dontMiss: "Don't miss the next issue.",
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
    search: {
      region: "Search the archive",
      label: "Search stories",
      topics: "Topic",
      allTopics: "All",
      month: "Month",
      allMonths: "All months",
      echo: "3+ sources",
      clear: "Clear",
      count: (n) => (n === 0 ? "No results." : n === 1 ? "1 result" : `${n} results`),
      templates: {
        sourceOne: "1 source",
        sourceMany: "{n} sources",
        countNone: "No results.",
        countOne: "1 result",
        countMany: "{n} results",
        more: "Showing the first {n} results.",
      },
      emptyTitle: "No story matches this search.",
      emptyHint: "Try a shorter word, or clear the filters.",
      failed: "Search is not working right now; the archive list is below.",
      heat: "The last 26 weeks: each square is a day",
      heatDay: (date, n) => `${date}, ${n === 1 ? "1 story" : `${n} stories`}`,
      heatLess: "fewer",
      heatMore: "more",
    },
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
    feedTitle: "Radar: the day's tech and AI news",
    feedDescription: "The day's tech and AI news. Five minutes, no noise.",
    about: {
      title: "About",
      description: "Who makes Radar, and how its stories are chosen, written and checked.",
      sections: [
        {
          heading: "Who makes Radar?",
          paragraphs: [
            "Radar is a personal project by Yusuf Özkan, who runs it; the site's source code is open.",
          ],
          links: [
            { text: "ozkanyusuf.com", href: SITE },
            { text: "GitHub", href: GITHUB },
            { text: "Radar's source code", href: REPOSITORY },
          ],
        },
        {
          heading: "What Radar is",
          paragraphs: [
            "Radar is a short, numbered daily edition of tech and AI news. An edition usually has five to eight stories, and each one ends with a single line on why it matters. Then the edition closes.",
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
          heading: "Who writes the stories?",
          paragraphs: [
            "Every story is written by a language model from the sources linked under it.",
            "Stories on risky subjects are published only after a person has read them. The rest are published automatically once they pass the automatic check.",
            "A story that is wrong is corrected or taken down.",
          ],
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
          links: [{ text: "Open an issue on GitHub", href: ISSUES }],
        },
        {
          heading: "Privacy",
          paragraphs: [
            "This site sets no cookies, does not track you and loads nothing from third parties: no analytics, no ads, no outside fonts. Every page is a static HTML file and is complete without scripts.",
            "The site's own small script only adds conveniences: the archive search (its data comes from this site), the radar's tilt and the marks on stories you have read, the way the “Why it matters” line appears, and a short opening on the day's first page. If you have asked for less motion, none of it moves.",
            "To remember that the opening has been shown, one key is written to the browser's session storage: radar:intro. It is gone when the tab closes. Nothing else is stored, and nothing is sent anywhere.",
          ],
        },
      ],
    },
    subscribe: {
      description: "Follow Radar for free with RSS: no account, no e-mail.",
      intro: [
        "Subscribing to Radar today means following its RSS feed: new stories appear in your feed reader as they are published.",
        "It is free. No account, no e-mail address, nothing stored.",
      ],
      feedHeading: "Feed address",
      stepsHeading: "In three steps",
      steps: [
        "Open a feed reader; most are free and work on a phone too.",
        "Add a new subscription and paste the address above.",
        "Save it. Every new story arrives in your reader by itself.",
      ],
      otherFeed: "The Turkish issues have a feed of their own:",
      otherFeedLink: "Turkish feed",
      noNewsletter: "There is no e-mail newsletter; for now Radar is RSS only.",
    },
  },
};
