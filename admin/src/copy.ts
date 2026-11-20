// Every piece of Turkish text on the admin screen lives here.
import type { Failure } from "./stories";
import type { Lang, Status } from "./schema";

export const COPY = {
  appName: "Radar · Onay",
  brand: "Radar",
  brandSuffix: "Onay",
  tabs: {
    review: "Bekleyen",
    published: "Yayında",
    rejected: "Reddedilen",
    expired: "Süresi dolan",
  } satisfies Record<Status, string>,
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
  emptyOther: "Bu listede haber yok.",
  older: "Daha eski",
  newer: "Daha yeni",
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
  fields: { title: "Başlık", summary: "Özet", dev_line: "Geliştirici notu" },
  fieldName: { title: "başlık", summary: "özet", dev_line: "geliştirici notu" } as Record<string, string>,
  tryUrlHint: "Boş bırakılırsa bağlantı kaldırılır.",
  limitHint: "Sayaç yayın sınırını gösterir.",
  save: "Kaydet",
  decisionHeading: "Karar",
  approveHint: "Onay, kayıtlı metni yayınlar. Değişiklik yaptıysan önce kaydet.",
  checked: "Kaynağı kontrol ettim",
  approve: "Onayla ve yayınla",
  rejectNote: "Ret notu (isteğe bağlı)",
  reject: "Reddet",
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
  } as Record<string, string>,
  actors: { agent: "ajan", system: "sistem" } as Record<string, string>,

  notFoundTitle: "Bulunamadı",
  notFound: "Haber bulunamadı.",
  badRequest: "Geçersiz istek.",
  forbidden: "Bu istek reddedildi.",
  mustCheck: "Onaylamadan önce kaynağı kontrol ettiğini işaretle.",
  failures: {
    conflict: "Bu haber başka bir yerde değişti. Güncel hâli aşağıda.",
    wrong_status: "Bu işlem haberin şu anki durumunda yapılamaz.",
    expired: "Bu haberin 72 saatlik süresi doldu.",
    invalid: "Eksik ya da geçersiz alan var.",
    not_found: "Haber bulunamadı.",
  } satisfies Record<Exclude<Failure, "too_long">, string>,
  tooLong: (field: string) => `Yayınlamak için metin çok uzun: ${field}`,
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
