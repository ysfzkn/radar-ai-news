// Every piece of Turkish text on the admin screen lives here.
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
