// Every piece of Turkish text on the admin screen lives here.
import type { GithubFailure, RunEvent, RunMode, RunState } from "./github";
import type { DispatchOutcome } from "./runs";
import type { Failure, Tab } from "./stories";
import type { Lang, RISK_FLAGS, Status } from "./schema";

export const COPY = {
  appName: "Radar · Onay",
  brand: "Radar",
  brandSuffix: "Onay",
  tabs: {
    review: "Bekleyen",
    published: "Yayında",
    rejected: "Reddedilen",
    expired: "Süresi dolan",
    edition: "Bugün",
  } satisfies Record<Tab, string>,
  statusLine: {
    review: "Onay bekliyor",
    published: "Yayında",
    rejected: "Reddedildi",
    expired: "Süresi doldu",
  } satisfies Record<Status, string>,
  publishMode: { auto: "otomatik yayın", human: "insan onayı" },
  categories: {
    protocol: "Protokol",
    model: "Model",
    framework: "Çatı",
    tooling: "Araçlar",
    research: "Araştırma",
    security: "Güvenlik",
    industry: "Sektör",
    policy: "Politika",
  } as Record<string, string>,
  months: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],

  queueHeading: "Haber kuyruğu",
  emptyReview: "Bekleyen haber yok.",
  emptyReviewTitle: "Hepsi tamam.",
  emptyToEdition: "Bugünkü baskıya bak",
  emptyFiltered: "Aramaya uyan haber yok.",
  emptyOther: "Bu listede haber yok.",
  nextPage: "Sonraki sayfa",
  prevPage: "Önceki sayfa",
  sourceCount: (n: number) => `${n} kaynak`,
  edited: "düzenlendi",
  timeLeft: (value: string) => `Kalan süre: ${value}`,
  hours: (h: number) => `${h} sa`,
  minutes: (m: number) => `${m} dk`,
  receivedAt: (date: string) => `Geliş: ${date}`,
  decidedAt: (date: string) => `Karar: ${date}`,
  publishedAt: (date: string) => `Yayın: ${date}`,

  back: "Kuyruğa dön",
  reasonsHeading: "Neden onay bekliyor",
  factCardHeading: "Bilgi kartı",
  fact: { what: "Ne oldu", who: "Kim", numbers: "Rakamlar", versions: "Sürümler", tryUrl: "Deneme bağlantısı" },
  none: "Yok",
  sourcesHeading: "Kaynaklar",
  mainSource: "Ana kaynak",
  tier: (t: number) => `kademe ${t}`,
  textsHeading: "Metinler",
  editHeading: "Düzenle",
  category: "Kategori",
  langs: { tr: "Türkçe", en: "İngilizce" } satisfies Record<Lang, string>,
  fields: { title: "Başlık", summary: "Özet", dev_line: "Neden önemli" },
  fieldName: { title: "başlık", summary: "özet", dev_line: "neden önemli satırı" } as Record<string, string>,
  tryUrlHint: "Boş bırakılırsa bağlantı kaldırılır.",
  limitHint: "Sayaç yayın sınırını gösterir.",
  save: "Kaydet",
  decisionHeading: "Karar",
  approveNote: "Onay, formdaki metni kaydeder ve yayınlar.",
  checked: "Kaynağı kontrol ettim",
  approve: "Kaydet ve onayla",
  rejectNote: "Ret notu (isteğe bağlı)",
  reject: "Reddet",
  // The phone bar's way to the reject card: a link down the page, never a decision by itself.
  barReject: "Reddet…",
  unpublishNote: "Kaldırma nedeni",
  unpublish: "Yayından kaldır",
  readOnly: "Bu haber artık değiştirilemez.",
  historyHeading: "Geçmiş",
  actions: {
    ingested: "Alındı",
    edited: "Düzenlendi",
    approved: "Onaylandı",
    rejected: "Reddedildi",
    unpublished: "Yayından kaldırıldı",
    expired: "Süresi doldu",
    restored: "Kuyruğa döndürüldü",
  } as Record<string, string>,
  actors: { agent: "ajan", system: "sistem" } as Record<string, string>,

  notFoundTitle: "Bulunamadı",
  notFound: "Haber bulunamadı.",
  badRequest: "Geçersiz istek.",
  serverErrorTitle: "Hata",
  serverError: "Sunucuda bir hata oldu; istek tamamlanmadı. Haberin şu anki hâlini açıp tekrar dene.",
  forbidden: "Bu istek reddedildi.",
  mustCheck: "Onaylamadan önce kaynağı kontrol ettiğini işaretle.",
  savedNotApproved: "Değişikliklerin kaydedildi ama haber yayınlanmadı.",
  failures: {
    conflict: "Bu haber başka bir yerde değişti. Güncel hâli aşağıda.",
    wrong_status: "Bu işlem haberin şu anki durumunda yapılamaz.",
    expired: "Bu haberin 72 saatlik süresi doldu.",
    invalid: "Eksik ya da geçersiz alan var.",
    not_found: "Haber bulunamadı.",
  } satisfies Record<Exclude<Failure, "too_long">, string>,
  tooLong: (field: string) => `Yayınlamak için metin çok uzun: ${field}`,
  conflictKept: "Bu haber başka bir yerde değişti. Yazdıkların aşağıda duruyor; kaydedersen diğer değişikliğin üzerine yazar.",

  queueSummary: (count: number, soonest: string) => `${count} haber bekliyor · en yakın süre ${soonest}`,
  openSource: "Kaynağı aç ↗",
  unsaved: "Kaydedilmemiş değişiklik var",
  reasonKinds: { verify: "Doğrulama", risk: "Risk", other: "Not" },
  riskFlags: {
    security_incident: "güvenlik olayı",
    accusation: "suçlama",
    funding_figure: "yatırım tutarı",
    third_party_benchmark: "üçüncü taraf kıyaslaması",
    regulation: "düzenleme",
  } satisfies Record<(typeof RISK_FLAGS)[number], string>,
  tooLongReason: (field: string, n: string, max: string) => `${field} çok uzun (${n} / ${max})`,
  // The agent's injection checks (a story with any of these waits for a person).
  factCard: "Bilgi kartı",
  hasLinkReason: (where: string, token: string) => `${where}: bağlantı ya da alan adı içeriyor (${token})`,
  hasHandleReason: (where: string, handle: string) => `${where}: kullanıcı adı içeriyor (${handle})`,
  hasBackticksReason: (where: string) => `${where}: ters tırnak içeriyor`,
  hasCommandReason: (where: string, fragment: string) => `${where}: komut benzeri metin içeriyor (${fragment})`,
  // The agent's reason for a story of a "Hepsi onaya" run (radar daily --review-all).
  reviewAllReason: "Hepsi onaya istenen bir çalıştırmadan: kendiliğinden yayınlanmadı.",
  foreignTryHostReason: (host: string) => `“Dene” bağlantısı kaynakların dışında bir siteye gidiyor (${host})`,

  // Said after a successful action, from the redirect's `done` hint.
  done: {
    saved: "Kaydedildi.",
    approved: "Haber yayınlandı.",
    rejected: "Haber reddedildi.",
    unpublished: "Haber yayından kaldırıldı.",
    restored: "Haber kuyruğa döndü.",
    next_approved: "Onaylandı. Sıradaki haber.",
    next_rejected: "Reddedildi. Sıradaki haber.",
    dispatched: "Çalıştırma başlatıldı. GitHub'ın listesinde görünmesi birkaç saniye sürebilir; Yenile ile bak.",
    subscriber_removed: "Abone silindi.",
  },

  // The header.
  siteLink: "Site",
  siteLinkLabel: "Yayındaki siteyi yeni sekmede aç",
  signedInAs: "Oturum:",
  mainNav: "Ana menü",

  // The newsletter's readers (/admin/subscribers).
  subscribers: {
    tab: "Aboneler",
    title: "Aboneler",
    intro:
      "E-posta bültenine kayıtlı adresler, en yenisi üstte. Onay bekleyen adres, onay e-postasındaki düğmeye basılana kadar bülten almaz ve 7 gün sonra kendiliğinden silinir.",
    notSending: "Bu Worker şu an e-posta gönderemiyor: RESEND_API_KEY, MAIL_FROM ya da PUBLIC_URL eksik. Abone formu “henüz açılmadı” der, günlük bülten gitmez.",
    stripLabel: "Abone durumu",
    confirmed: "Onaylı abone",
    pending: "Onay bekleyen",
    byLang: "Dil (onaylı)",
    langSplit: (tr: number, en: number) => `${tr} TR · ${en} EN`,
    lastSend: "Son gönderim",
    lastSendValue: (day: string, readers: number) => `${day} · ${readers} okur`,
    noSendYet: "Henüz yok",
    listHeading: "Adresler",
    empty: "Henüz abone yok.",
    emptyPage: "Bu sayfada adres yok.",
    statuses: { confirmed: "Onaylı", pending: "Onay bekliyor" } satisfies Record<"confirmed" | "pending", string>,
    langs: { tr: "Türkçe", en: "İngilizce" } satisfies Record<"tr" | "en", string>,
    joined: (date: string) => `Kayıt: ${date}`,
    confirmedAt: (date: string) => `Onay: ${date}`,
    lastMailed: (day: string) => `Son sayı: ${day}`,
    neverMailed: "Henüz bülten gitmedi",
    remove: "Sil",
    removeHint: "Adres listeden silinir ve bir daha e-posta gitmez. Geri alınamaz; kişi isterse yeniden abone olabilir.",
    removeConfirm: "Evet, aboneyi sil",
    notFound: "Bu abone bulunamadı; daha önce silinmiş ya da abonelikten çıkmış olabilir.",
  },

  // Starting the agent from here (/admin/run).
  run: {
    tab: "Çalıştır",
    title: "Ajanı çalıştır",
    intro:
      "Günlük işi GitHub Actions'ta şimdi başlatır: her gece 00:15'ten sonra kendiliğinden çalışan işin aynısı. Nasıl çalışacağını aşağıdan seç.",
    notSetUpTitle: "Buradan çalıştırma kurulu değil.",
    notSetUp:
      "Worker'da GITHUB_DISPATCH_TOKEN (gizli) ve GITHUB_REPO ayarlanınca bu sayfa işi başlatabilir. O zamana kadar iş sabah kendiliğinden ya da GitHub'daki Actions sekmesinden başlar.",
    formHeading: "Yeni çalıştırma",
    modeLegend: "Nasıl çalışsın?",
    modes: {
      normal: {
        label: "Normal",
        desc: "Sabahki iş gibi: kaynakları toplar, haber yazar, temiz olanları kendiliğinden yayınlar, gerisini onaya gönderir.",
      },
      review_all: {
        label: "Hepsi onaya",
        desc: "Haber yazar ama hiçbirini kendiliğinden yayınlamaz: her yeni haber Bekleyen listesine düşer.",
      },
      collect_only: {
        label: "Yalnızca topla",
        desc: "Kaynakları okur ve saklar. Haber yazmaz, model çağırmaz, para harcamaz, bir şey göndermez.",
      },
    } satisfies Record<RunMode, { label: string; desc: string }>,
    storiesLabel: "Haber sayısı",
    storiesDefault: "Varsayılan (8)",
    storiesHint:
      "Günün baskısı için üst sınır: bugün yazılmış haberler de sayılır. Yalnızca toplamada kullanılmaz.",
    costHint: "Normal ve Hepsi onaya model çağırır; harcama günlük sınırın içinde kalır.",
    submit: "Çalıştır",
    refresh: "Yenile",
    busy: (state: string, at: string) => `Şu an bir çalıştırma sürüyor (${state}, ${at}). Bitince yenisini başlatabilirsin.`,
    cooldown: (left: string) => `Az önce buradan bir çalıştırma başlatıldı; yenisi ${left} sonra başlatılabilir.`,
    unknownState:
      "GitHub'a ulaşılamadığı için süren bir çalıştırma olup olmadığı bilinmiyor; şimdilik başlatılamaz.",
    ready: "Şu an süren bir çalıştırma yok; başlatılabilir.",
    runsHeading: "Son çalıştırmalar",
    runsEmpty: "GitHub'da bu işin henüz bir çalıştırması yok.",
    runsUnavailable: (why: string) => `Son çalıştırmalar alınamadı. ${why}`,
    openRun: "GitHub'da aç ↗",
    states: {
      queued: "Kuyrukta",
      in_progress: "Çalışıyor",
      success: "Başarılı",
      failure: "Başarısız",
      cancelled: "İptal edildi",
      skipped: "Atlandı",
      timed_out: "Süre aşıldı",
      other: "Bitti",
    } satisfies Record<RunState, string>,
    events: { schedule: "Zamanlanmış", workflow_dispatch: "Elle", other: "Diğer" } satisfies Record<RunEvent, string>,
    skippedHint: "Atlanan çalıştırma çoğunlukla RADAR_ENABLED değişkeninin true olmadığını gösterir.",
    took: (d: string) => `${d} sürdü`,
    tookUnderMinute: "1 dk'dan kısa sürdü",
    stories: (n: number) => `en çok ${n} haber`,
    historyHeading: "Buradan başlatılanlar",
    historyEmpty: "Buradan henüz bir çalıştırma başlatılmadı.",
    outcomes: { dispatched: "Başlatıldı", failed: "Başlatılamadı", pending: "Sonuç bilinmiyor" } satisfies Record<
      DispatchOutcome,
      string
    >,
    failures: {
      unauthorized: "GitHub anahtarı kabul etmedi ya da anahtarın yetkisi yetmiyor.",
      not_found: "Depo ya da iş akışı bulunamadı: GITHUB_REPO ve anahtarın erişimi doğru mu?",
      invalid: "GitHub isteği kabul etmedi; main dalındaki iş akışı bu seçenekleri tanımıyor olabilir.",
      rate_limited: "GitHub istek sınırına ulaşıldı; biraz sonra tekrar dene.",
      unavailable: "GitHub'a ulaşılamadı ya da zamanında yanıt vermedi.",
    } satisfies Record<GithubFailure, string>,
    dispatchFailed: (why: string) => `Çalıştırma başlatılamadı. ${why}`,
    invalid: "Geçersiz seçim: üç çalışma biçiminden birini ve 1 ile 8 arasında bir sayı seç.",
  },
  previewHeading: "Sitede görünüm",

  // The queue's search and category chips.
  searchLabel: "Başlıkta ara",
  searchPlaceholder: "Türkçe ya da İngilizce başlık",
  searchButton: "Ara",
  categoryFilter: "Kategoriye göre süz",
  allCategories: "Tümü",
  clearFilter: "Temizle",
  results: (n: number) => `${n} sonuç`,
  termsIgnored: (n: number) => `ilk 10 kelime arandı, kalan ${n} kelime yok sayıldı`,

  // The status strip over the review queue.
  stripLabel: "Kuyruğun durumu",
  stripWaiting: "Bekleyen",
  stripToday: "Bugün yayınlanan",
  stripOldest: "En eski bekleyen",
  stripNextExpiry: "İlk süre dolumu",
  stripNone: "—",
  ago: (d: string) => `${d} önce`,
  within: (d: string) => `${d} içinde`,

  // Moving between stories.
  storyNav: "Haberler arasında",
  position: "Sıra",
  prevStory: "← Önceki",
  nextStory: "Sonraki →",
  backToEdition: "Bugünkü baskıya dön",

  // Undoing a rejection.
  restoreHeading: "Geri al",
  restore: "Geri al: kuyruğa döndür",
  restoreNote: "Haber bekleyen listesine döner; kalan süresi değişmez.",
  restoreExpired: "Geri alınamaz: haberin 72 saatlik inceleme süresi doldu.",

  // Today's edition.
  editionHeading: "Bugünkü baskı",
  editionIntro: "Bugün yayınlanan haberler, sitede görünecekleri sırayla.",
  editionEmpty: "Bugün henüz yayınlanan haber yok.",
  editionTakeDown: "Yayından kaldır…",

  // Keyboard.
  kbdHint: "Klavye:",
  shortcutsHeading: "Klavye kısayolları",
  shortcuts: [
    [["j", "k"], "Listede aşağı / yukarı"],
    [["Enter"], "Seçili haberi aç"],
    [["n", "p"], "Sonraki / önceki haber"],
    [["a"], "Onay düğmesine git"],
    [["r"], "Ret notuna git"],
    [["?"], "Bu listeyi aç / kapat"],
    [["Esc"], "Kapat"],
  ] as [string[], string][],
  shortcutsNote: "Kısayollar karar vermez: onaylamak ya da reddetmek için düğmeye ayrıca bas.",
  close: "Kapat",
  previewDev: { tr: "Neden önemli", en: "Why it matters" } satisfies Record<Lang, string>,
};

// "tr.summary" -> "Türkçe özet". Unknown details fall back to the raw path.
export function fieldLabel(detail: string | undefined): string {
  const [lang, field] = (detail ?? "").split(".");
  const langLabel = lang === "tr" || lang === "en" ? COPY.langs[lang] : undefined;
  const fieldLabel = field ? COPY.fieldName[field] : undefined;
  return langLabel && fieldLabel ? `${langLabel} ${fieldLabel}` : (detail ?? "");
}

export function failureMessage(error: Failure, detail?: string): string {
  return error === "too_long" ? COPY.tooLong(fieldLabel(detail)) : COPY.failures[error];
}
