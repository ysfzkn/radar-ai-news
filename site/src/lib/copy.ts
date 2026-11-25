import { OWNER } from "./routes";
import type { Category, Lang } from "./schema";

/** Every user-visible string of the site, Turkish and English side by side. */
export interface Copy {
  siteName: string;
  tagline: string;
  /** What Radar is, beside the day's radar at the top of the home page. */
  hero: {
    label: string;
    /** The statement, in three parts: the middle one is underlined in the accent. */
    lead: [string, string, string];
    /** Its two promises, on one line. */
    promises: [string, string];
    /** The quiet link to the About page. */
    more: string;
  };
  /** The home page's toolbar over the day's stories: the search and the topic chips. */
  desk: {
    /** The search field's label and placeholder, its button, and the link that stands in without script. */
    search: string;
    placeholder: string;
    go: string;
    fallback: string;
    /** The chips' group name and the chip for every topic. */
    topics: string;
    all: string;
    /** A chosen topic with no story today, and the link to that topic's page. */
    none: string;
    more(topic: string): string;
  };
  nav: { today: string; archive: string; week: string; about: string };
  /** The name of the dial that holds those four links. */
  navLabel: string;
  /** A story's signal bars (one, two or three lit), as read by assistive tech. */
  signal: readonly [string, string, string];
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
    /** A ghost blip's prefix: a story of an earlier edition, with that edition's short date. */
    earlier(date: string): string;
    /** The readout panel beside the scope: its name and its column heads. */
    panel: string;
    columns: readonly [string, string, string, string, string];
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
  /** The owner's name, in the footer signature. */
  owner: string;
  /** The owner's site as shown beside the wordmark and in the footer. */
  by: string;
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
  /** The share picture's description, for those who cannot see it. */
  ogImageAlt: string;
  /** The 404 page's headline, over the empty scope. */
  noSignal: string;
  notFoundHint: string;
  feedTitle: string;
  feedDescription: string;
  /** The command palette, the shortcut sheet and the copy buttons: all of them come with script. */
  palette: {
    /** The accessible name of the strip's button, and the word beside its key. */
    open: string;
    hint: string;
    title: string;
    placeholder: string;
    pages: string;
    stories: string;
    none: string;
    loading: string;
    /** The other language's edition, as a palette item. */
    other: string;
    rss: string;
    /** The line of keys under the list. */
    foot: string;
    keysTitle: string;
    keys: readonly (readonly [string, string])[];
    close: string;
  };
  /** The copy buttons: on a command, and on each story's link. */
  copy: { code: string; done: string; link: string; linkName(no: string): string };
  /** The status line at the foot of every page, built with the site. */
  status: { command: string; line(issue: number, date: string, stories: number, sources: number): string; none: string };
  /** The horizon: its landmarks tell their names when picked, and the dish calls the Kangal. */
  horizon: {
    /** Read before the seven landmarks; never shown. */
    legend: string;
    /** The dish's name for assistive tech; never shown. */
    dish: string;
    names: { bridge: string; maiden: string; mosque: string; galata: string; medrese: string; divrigi: string; castle: string };
  };
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
    /** The privacy section: it gains the newsletter's paragraph when the newsletter is open. */
    privacy?: true;
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
  /** The feed from a command line: a heading, a line, and the label of the command block. */
  terminalHeading: string;
  terminalText: string;
  terminalTitles: string;
  /** The e-mail newsletter, shown only when it is open (lib/newsletter.ts). */
  mail: MailCopy;
}

/** The newsletter's form on the subscribe page, and its paragraph in the Künye's privacy section. */
export interface MailCopy {
  /** Replaces the page's description and its intro when the newsletter is open. */
  description: string;
  intro: readonly string[];
  heading: string;
  emailLabel: string;
  placeholder: string;
  button: string;
  /** What is stored and why, under the form. */
  notice: string;
  /** The line a reader sees after the form, by the answer's name. */
  states: Record<"sent" | "invalid" | "later" | "error" | "closed", string>;
  /** The heading of the RSS part, which follows the form. */
  rssHeading: string;
  rssIntro: string;
  /** The Künye's privacy section gains this paragraph. */
  privacy: string;
}

const { site: SITE } = OWNER;

export const COPY: Record<Lang, Copy> = {
  tr: {
    siteName: "Radar",
    tagline: "Günün teknoloji ve yapay zekâ haberleri. Beş dakika, gürültü yok.",
    hero: {
      label: "Günlük bülten",
      lead: ["Günün teknoloji ve ", "yapay zekâ", " haberleri."],
      promises: ["Her sabah", "Kısa ve öz"],
      more: "Nasıl çalışır",
    },
    desk: {
      search: "Tüm haberlerde ara",
      placeholder: "Tüm haberlerde ara…",
      go: "Ara",
      fallback: "Arşivde ara",
      topics: "Konular",
      all: "Tümü",
      none: "Bugün bu konuda haber yok.",
      more: (topic) => `Tüm ${topic} haberleri`,
    },
    nav: { today: "Bugün", archive: "Arşiv", week: "Hafta", about: "Künye" },
    navLabel: "Bölümler",
    signal: ["Sinyal: zayıf", "Sinyal: orta", "Sinyal: güçlü"],
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
      earlier: (date) => `Önceki baskı, ${date}:`,
      panel: "Okuma",
      columns: ["No", "Krt", "Kyn", "Konu", "Başlık"],
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
    owner: "Yusuf Özkan",
    by: "ozkanyusuf.com",
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
    ogImageAlt: "Radar: üç yaylı işaret ve bir radar ekranı; günün teknoloji ve yapay zekâ haberleri",
    noSignal: "Sinyal yok",
    notFoundHint: "Bu adres radarda görünmüyor. Belki taşındı, belki hiç yoktu.",
    feedTitle: "Radar: günün teknoloji ve yapay zekâ haberleri",
    feedDescription: "Günün teknoloji ve yapay zekâ haberleri. Beş dakika, gürültü yok.",
    palette: {
      open: "Komut paletini aç",
      hint: "Ara",
      title: "Komut paleti",
      placeholder: "Sayfa ya da haber ara…",
      pages: "Sayfalar",
      stories: "Haberler",
      none: "Eşleşen bir şey yok.",
      loading: "Haberler yükleniyor…",
      other: "English edition",
      rss: "RSS akışı",
      foot: "↑↓ seç · ↵ aç · esc kapat · ? kısayollar",
      keysTitle: "Klavye kısayolları",
      keys: [
        ["Ctrl K · ⌘K", "Komut paletini aç"],
        ["/", "Ara"],
        ["j · k", "Sonraki · önceki haber"],
        ["[ · ]", "Önceki · sonraki sayı"],
        ["?", "Bu liste"],
        ["Esc", "Kapat"],
      ],
      close: "Kapat",
    },
    copy: {
      code: "Kopyala",
      done: "Kopyalandı",
      link: "bağlantı",
      linkName: (no) => `${no} numaralı haberin bağlantısını kopyala`,
    },
    status: {
      command: "radar status",
      line: (issue, date, stories, sources) => `sayı ${issue} · ${date} · ${stories} haber · ${sources} kaynak`,
      none: "henüz baskı yok",
    },
    horizon: {
      legend: "Ufuktaki yerler: adını görmek için birini seç",
      dish: "Radar çanağı: Kangal'ı çağır",
      names: {
        bridge: "Boğaz Köprüsü",
        maiden: "Kız Kulesi",
        mosque: "Süleymaniye Camii",
        galata: "Galata Kulesi",
        medrese: "Çifte Minareli Medrese",
        divrigi: "Divriği Ulu Camii",
        castle: "Sivas Kalesi",
      },
    },
    about: {
      title: "Künye",
      description: "Radar'ın yayıncısı, yayın ilkeleri ve haberlerin seçilme, yazılma ve denetlenme süreci.",
      sections: [
        {
          heading: "Yayıncı",
          paragraphs: [
            "Radar, Yusuf Özkan'ın kişisel yayınıdır. Yayının editoryal sorumluluğu Yusuf Özkan'a aittir.",
          ],
          links: [{ text: "ozkanyusuf.com", href: SITE }],
        },
        {
          heading: "Yayın hakkında",
          paragraphs: [
            "Radar, teknoloji ve yapay zekâ alanındaki gelişmeleri her gün kısa ve numaralı bir baskı hâlinde sunar. Bir baskıda genellikle beş ile sekiz haber yer alır; her haber, gelişmenin neden önemli olduğunu belirten tek bir satırla sona erer. Baskı bu haberlerle tamamlanır.",
            "Yayın Türkçe ve İngilizce olarak hazırlanır. İki metin aynı olgu kartından yazıldığı için aynı içeriği taşır.",
          ],
        },
        {
          heading: "Hazırlık süreci",
          paragraphs: [
            "Haberler yedi adımlı bir işlem hattıyla hazırlanır. Bu adımlardan yalnızca ikisinde bir dil modeli kullanılır; diğer beşi kural tabanlı yazılımdır.",
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
            { name: "Yönlendirme", text: "Haber otomatik olarak yayımlanır ya da editör incelemesine gönderilir." },
          ],
          after: [
            "Doğrulama bir güvenlik önlemidir, doğruluğun kanıtı değildir: kaynakta yer alan gerçek bir sayının yanlış bir iddiada kullanıldığını saptayamaz. Bu nedenle yüksek risk taşıyan haberler yayımlanmadan önce editör tarafından incelenir.",
          ],
        },
        {
          heading: "Yankı ölçer",
          paragraphs: [
            "Her haberin yanındaki beş yay, haberi kaç bağımsız kaynağın verdiğini gösterir: her kaynak için bir yay yanar, en fazla beş. Kaynak sayısı hemen yanında belirtilir. Böylece geniş yankı uyandıran bir haber, tek bir kaynağın duyurusundan ayırt edilebilir.",
          ],
        },
        {
          heading: "Yazım ve editoryal denetim",
          paragraphs: [
            "Her haber, altında bağlantıları verilen kaynaklara dayanılarak bir dil modeli tarafından yazılır.",
            "Haberlerin büyük bölümü otomatik denetimin ardından doğrudan yayımlanır. Yüksek risk taşıyan haberler ise yalnızca editör incelemesinden sonra yayımlanır.",
            "Hatalı olduğu belirlenen haber düzeltilir ya da yayından kaldırılır.",
          ],
        },
        {
          heading: "Editör incelemesi gerektiren haberler",
          paragraphs: [
            "Şu haberler otomatik olarak yayımlanmaz: güvenlik olaylarına ve suçlamalara ilişkin haberler; metninde kaynakta bulunmayan bir sayı yer alan ya da eski bir gelişmeyi bugünün haberi gibi sunan haberler; metninde bağlantı, alan adı ya da komut saptanan veya deneme bağlantısı kaynağa ait olmayan haberler; birincil kaynağı bulunmayan yatırım, benchmark ve düzenleme haberleri.",
            "Otomatik denetimin diğer bulguları habere not olarak kaydedilir ve yayımı durdurmaz.",
            "İncelemeye ayrılan haberler bir kuyrukta bekler. 72 saat içinde incelenmeyen haberin süresi dolar; inceleme bekleyen hiçbir haber kendiliğinden yayımlanmaz.",
          ],
        },
        {
          heading: "Düzeltme ve bildirim",
          paragraphs: [
            "Hatalı ya da yanıltıcı olduğu düşünülen haberler, haberin bağlantısıyla birlikte aşağıdaki adres üzerinden bildirilebilir.",
          ],
          links: [{ text: "ozkanyusuf.com üzerinden iletişim", href: SITE }],
        },
        {
          heading: "Gizlilik",
          privacy: true,
          paragraphs: [
            "Bu site çerez kullanmaz, ziyaretçileri izlemez ve üçüncü taraflardan hiçbir içerik yüklemez: analitik, reklam ya da dış yazı tipi bulunmaz. Her sayfa statik bir HTML dosyasıdır ve betik olmadan da eksiksiz çalışır.",
            "Sitenin kendi küçük betiği yalnızca kullanım kolaylığı sağlar: arşivde arama ve komut paleti (arama verisi bu siteden gelir), klavye kısayolları, kopyalama düğmeleri (panoya yalnızca düğmeye basıldığında yazar), radar ekranının eğimi ve okunan haberlerin işareti, ana sayfadaki arama kutusu (yazılan sözcükleri arşivin aramasına, yani o sayfanın adresine taşır), ana sayfanın başındaki yazının ve radarın açılıştan sonra bir kez yerine oturması, “Neden önemli” satırının belirişi, baskının tarihinin ve sayılarının bir kalkış tabelası gibi yerine oturması, abone ol düğmesinin yazısının, imleç üzerine geldiğinde çözülmesi, komut paletine “ping” yazıldığında radarın bir kez atması ve siteye her girişte oynayan kısa açılış. Sayfanın altındaki ufuk çizimi akşamdan sabaha gece hâline geçer: saati ziyaretçinin cihaz saatinden İstanbul saatine göre hesaplar, hiçbir sunucuya sormaz. Hareketi azaltma tercihi açıksa hareketlerin hiçbiri oynamaz.",
            "Arşivde aranan sözcükler tarayıcıda ve sayfanın adresinde kalır; adres de tarayıcı geçmişine yazılır. Sayfa yenilendiğinde ya da bir sonuca tıklandığında adres yalnızca bu siteye gider; başka kimseye gönderilmez.",
            "Tarayıcıya hiçbir şey yazılmaz: ne çerez ne yerel ya da oturum belleği. Sayfa yenilendiğinde her şey baştan başlar.",
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
      terminalHeading: "Terminalden",
      terminalText: "Akış düz XML'dir; komut satırından da okunur. Bu komut son başlıkları listeler:",
      terminalTitles: "Son başlıklar",
      mail: {
        description: "Radar'a ücretsiz abone ol: günün sayısı her sabah e-posta kutunda. RSS de var.",
        intro: [
          "Radar her sabah e-postayla gelir: günün teknoloji ve yapay zekâ haberleri, kısa ve öz. Yeni sayı olmayan gün e-posta da olmaz.",
          "Ücretsiz. Hesap yok, şifre yok; yalnızca e-posta adresin.",
        ],
        heading: "E-postayla",
        emailLabel: "E-posta adresin",
        placeholder: "sen@ornek.com",
        button: "Abone ol",
        notice:
          "Adresini yalnızca bu bülteni göndermek için saklarım; kimseyle paylaşmam, reklam göndermem. Önce bir onay e-postası gelir; onaylamadığın adres 7 gün sonra silinir. E-postalarda açılma ya da tıklama takibi yoktur ve her birinin altında tek tıkla çıkış bağlantısı bulunur: çıktığında adresin silinir.",
        states: {
          sent: "Tamam. Gelen kutuna bak: onay bağlantısını gönderdim. Görünmüyorsa gereksiz (spam) klasörüne de bak.",
          invalid: "Bu bir e-posta adresine benzemiyor. Bir daha dener misin?",
          later: "Şu an çok fazla istek var. Biraz sonra yeniden dene.",
          error: "Onay e-postası gönderilemedi. Biraz sonra yeniden dene.",
          closed: "E-posta bülteni henüz açılmadı. Şimdilik RSS ile takip edebilirsin.",
        },
        rssHeading: "RSS ile",
        rssIntro: "E-posta vermek istemiyorsan Radar'ı RSS ile de takip edebilirsin: yeni haberler, yayımlandıkça kullandığın RSS okuyucusunda kendiliğinden belirir.",
        privacy:
          "Tek istisna e-posta bültenidir: abone olunduğunda yalnızca e-posta adresi ve seçilen dil saklanır. Adres yalnızca bülteni göndermek için kullanılır; gönderimi Resend, saklamayı Cloudflare yapar. E-postalarda açılma ya da tıklama takibi yoktur. Onaylanmayan adres 7 gün sonra, abonelikten çıkıldığında ise hemen silinir.",
      },
    },
  },
  en: {
    siteName: "Radar",
    tagline: "The day's tech and AI news. Five minutes, no noise.",
    hero: {
      label: "Daily briefing",
      lead: ["The day's tech and ", "AI", " news."],
      promises: ["Every morning", "Short and to the point"],
      more: "How it works",
    },
    desk: {
      search: "Search all stories",
      placeholder: "Search all stories…",
      go: "Search",
      fallback: "Search the archive",
      topics: "Topics",
      all: "All",
      none: "No story on this topic today.",
      more: (topic) => `All ${topic} stories`,
    },
    nav: { today: "Today", archive: "Archive", week: "Week", about: "About" },
    navLabel: "Sections",
    signal: ["Signal: weak", "Signal: fair", "Signal: strong"],
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
      earlier: (date) => `Earlier edition, ${date}:`,
      panel: "Readout",
      columns: ["No", "Brg", "Src", "Topic", "Title"],
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
    owner: "Yusuf Özkan",
    by: "ozkanyusuf.com",
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
    ogImageAlt: "Radar: the three-arc mark and a radar screen; the day's tech and AI news",
    noSignal: "No signal",
    notFoundHint: "This address does not show on the radar. It may have moved, or never existed.",
    feedTitle: "Radar: the day's tech and AI news",
    feedDescription: "The day's tech and AI news. Five minutes, no noise.",
    palette: {
      open: "Open the command palette",
      hint: "Search",
      title: "Command palette",
      placeholder: "Search pages or stories…",
      pages: "Pages",
      stories: "Stories",
      none: "Nothing matches.",
      loading: "Loading stories…",
      other: "Türkçe baskı",
      rss: "RSS feed",
      foot: "↑↓ select · ↵ open · esc close · ? shortcuts",
      keysTitle: "Keyboard shortcuts",
      keys: [
        ["Ctrl K · ⌘K", "Open the command palette"],
        ["/", "Search"],
        ["j · k", "Next · previous story"],
        ["[ · ]", "Previous · next issue"],
        ["?", "This list"],
        ["Esc", "Close"],
      ],
      close: "Close",
    },
    copy: {
      code: "Copy",
      done: "Copied",
      link: "link",
      linkName: (no) => `Copy the link to story ${no}`,
    },
    status: {
      command: "radar status",
      line: (issue, date, stories, sources) =>
        `issue ${issue} · ${date} · ${stories} ${stories === 1 ? "story" : "stories"} · ${sources} ${sources === 1 ? "source" : "sources"}`,
      none: "no edition yet",
    },
    horizon: {
      legend: "Places on the horizon: pick one to see its name",
      dish: "Radar dish: call the Kangal",
      names: {
        bridge: "Bosphorus Bridge",
        maiden: "Maiden's Tower",
        mosque: "Süleymaniye Mosque",
        galata: "Galata Tower",
        medrese: "Çifte Minareli Medrese",
        divrigi: "Great Mosque of Divriği",
        castle: "Sivas Castle",
      },
    },
    about: {
      title: "About",
      description: "Radar's publisher, and how its stories are chosen, written and checked.",
      sections: [
        {
          heading: "Publisher",
          paragraphs: [
            "Radar is a personal publication of Yusuf Özkan, who holds editorial responsibility for it.",
          ],
          links: [{ text: "ozkanyusuf.com", href: SITE }],
        },
        {
          heading: "About the publication",
          paragraphs: [
            "Radar is a short, numbered daily edition of tech and AI news. An edition usually has five to eight stories, and each one ends with a single line on why it matters. Then the edition closes.",
            "It is published in Turkish and English. Both are written from the same fact card, so they say the same thing.",
          ],
        },
        {
          heading: "How a story is prepared",
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
            { name: "Route", text: "The story is published automatically or sent to the editor for review." },
          ],
          after: [
            "The check is a safety net, not proof of accuracy: it cannot tell when a real number from the source is used in a wrong claim. That is why high-risk stories are reviewed by the editor before publication.",
          ],
        },
        {
          heading: "The echo meter",
          paragraphs: [
            "The five arcs beside each story show how many independent sources covered it: one arc lights up per source, up to five, with the exact count next to them. It separates a story that is making waves from one that a single blog is excited about.",
          ],
        },
        {
          heading: "Authorship and editorial review",
          paragraphs: [
            "Every story is written by a language model from the sources linked under it.",
            "Most stories are published automatically after the automatic check. High-risk stories are published only after editorial review.",
            "A story found to be wrong is corrected or taken down.",
          ],
        },
        {
          heading: "Stories that require editorial review",
          paragraphs: [
            "The following are never published automatically: stories about security incidents and accusations; stories whose text contains a number that is not in the source or presents an older event as today's; stories whose text contains a link, a domain name or a command, or whose \"try it\" link does not belong to the source; and funding, benchmark and regulation stories without a primary source.",
            "Other findings of the automatic check are recorded with the story as notes and do not stop publication.",
            "Stories held for review wait in a queue. A story not reviewed within 72 hours expires; a story awaiting review is never published by default.",
          ],
        },
        {
          heading: "Corrections",
          paragraphs: [
            "A story believed to be wrong or misleading can be reported, with the story's link, through the address below.",
          ],
          links: [{ text: "Contact via ozkanyusuf.com", href: SITE }],
        },
        {
          heading: "Privacy",
          privacy: true,
          paragraphs: [
            "This site sets no cookies, does not track you and loads nothing from third parties: no analytics, no ads, no outside fonts. Every page is a static HTML file and is complete without scripts.",
            "The site's own small script only adds conveniences: the archive search and the command palette (their data comes from this site), keyboard shortcuts, copy buttons (they write to your clipboard only when you press them), the radar's tilt and the marks on stories you have read, the home page's search field (it takes your words to the archive search, that is, into that page's address), the home page's words and radar rising into place once after the opening, the way the “Why it matters” line appears, the edition's date and counts settling in like a departure board, the subscribe button's label decoding when you point at it, the radar's single pulse when you type “ping” in the command palette and a short opening each time you enter the site. The horizon at the foot of each page turns to night from evening to morning: it works out Istanbul's time from your own device's clock and asks nothing of anyone. If you have asked for less motion, none of it moves.",
            "What you type in the archive search stays in your browser and in the page's address, so it is also in your browser history. When you reload the page or click a result, that address goes to this site only; it is sent to no one else.",
            "Nothing is written to your browser: no cookie, no local or session storage. When you reload a page, everything starts afresh.",
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
      terminalHeading: "From the terminal",
      terminalText: "The feed is plain XML, so a command line reads it too. This lists the latest headlines:",
      terminalTitles: "Latest headlines",
      mail: {
        description: "Subscribe to Radar for free: the day's issue in your inbox every morning. There is RSS too.",
        intro: [
          "Radar arrives by e-mail every morning: the day's tech and AI news, short and to the point. A day without a new issue has no e-mail.",
          "It is free. No account, no password; only your e-mail address.",
        ],
        heading: "By e-mail",
        emailLabel: "Your e-mail address",
        placeholder: "you@example.com",
        button: "Subscribe",
        notice:
          "I keep your address only to send this newsletter; I share it with no one and send no advertising. A confirmation e-mail comes first; an address you do not confirm is deleted after 7 days. The e-mails have no open or click tracking, and each ends with a one-click unsubscribe link: when you leave, your address is deleted.",
        states: {
          sent: "Done. Check your inbox: I have sent the confirmation link. If it is not there, look in the spam folder too.",
          invalid: "That does not look like an e-mail address. Try once more?",
          later: "There are too many requests right now. Try again in a little while.",
          error: "The confirmation e-mail could not be sent. Try again in a little while.",
          closed: "The e-mail newsletter is not open yet. For now you can follow Radar with RSS.",
        },
        rssHeading: "With RSS",
        rssIntro: "If you would rather not give an e-mail address, you can follow Radar with RSS: new stories appear in your feed reader as they are published.",
        privacy:
          "The one exception is the e-mail newsletter: if you subscribe, your e-mail address and the language you chose are stored, and nothing else. The address is used only to send the newsletter; Resend does the sending and Cloudflare the storing. The e-mails have no open or click tracking. An address you do not confirm is deleted after 7 days, and one that unsubscribes is deleted at once.",
      },
    },
  },
};
