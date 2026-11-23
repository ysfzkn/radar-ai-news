import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Lang } from "../schema";

// The newsletter's own small pages, reached from the links inside a mail: confirm, leave, and a
// link that leads nowhere. They are served by this Worker (the static site cannot read a token),
// in the site's look, without script.

type View = HtmlEscapedString | Promise<HtmlEscapedString>;

interface PageCopy {
  site: string;
  backToSite: string;
  confirmTitle: string;
  confirmText: (email: string) => string;
  confirmButton: string;
  confirmedTitle: string;
  confirmedText: string;
  leaveTitle: string;
  leaveText: (email: string) => string;
  leaveButton: string;
  leftTitle: string;
  leftText: string;
  invalidTitle: string;
  invalidText: string;
  subscribeAgain: string;
}

export const PAGE_COPY: Record<Lang, PageCopy> = {
  tr: {
    site: "Radar",
    backToSite: "Radar'a dön",
    confirmTitle: "Aboneliği onayla",
    confirmText: (email) => `${email} adresi Radar'ın günlük bültenine eklenecek. Onaylamak için düğmeye bas.`,
    confirmButton: "Aboneliği onayla",
    confirmedTitle: "Abonelik onaylandı.",
    confirmedText: "Bundan sonra günün sayısı her sabah e-posta kutuna gelir. Her e-postanın altında tek tıkla çıkış bağlantısı var.",
    leaveTitle: "Abonelikten çık",
    leaveText: (email) => `${email} adresi listeden silinecek ve bir daha e-posta gelmeyecek.`,
    leaveButton: "Abonelikten çık",
    leftTitle: "Abonelikten çıktın.",
    leftText: "Adresin silindi; Radar'dan bir daha e-posta gelmez. Fikrini değiştirirsen yeniden abone olabilirsin.",
    invalidTitle: "Bu bağlantı geçerli değil.",
    invalidText: "Bağlantının süresi dolmuş ya da abonelik zaten sonlandırılmış olabilir. Onaylanmayan adresler 7 gün sonra silinir.",
    subscribeAgain: "Yeniden abone ol",
  },
  en: {
    site: "Radar",
    backToSite: "Back to Radar",
    confirmTitle: "Confirm your subscription",
    confirmText: (email) => `${email} will be added to Radar's daily newsletter. Press the button to confirm.`,
    confirmButton: "Confirm subscription",
    confirmedTitle: "Subscription confirmed.",
    confirmedText: "From now on the day's issue arrives in your inbox every morning. Every e-mail ends with a one-click unsubscribe link.",
    leaveTitle: "Unsubscribe",
    leaveText: (email) => `${email} will be deleted from the list and will get no more e-mail.`,
    leaveButton: "Unsubscribe",
    leftTitle: "You are unsubscribed.",
    leftText: "Your address is deleted; Radar will not e-mail you again. If you change your mind, you can subscribe again.",
    invalidTitle: "This link is not valid.",
    invalidText: "It may have expired, or the subscription may already have ended. Addresses that are not confirmed are deleted after 7 days.",
    subscribeAgain: "Subscribe again",
  },
};

export const PAGE_CSS = `:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:2.5rem 1rem;background:#f7f7f4;color:#17181a;font:1rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:30rem;margin:0 auto}
.brand{margin:0 0 .9rem .25rem;font:700 .95rem ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;letter-spacing:.16em}
.brand a{color:inherit;text-decoration:none}
.brand span{color:#c2371a;letter-spacing:-.04em}
.plate{background:#fff;border:2px solid #17181a;box-shadow:5px 5px 0 #17181a;padding:1.75rem 1.75rem 2rem}
h1{margin:0;font-size:1.85rem;line-height:1.12;letter-spacing:-.03em;font-weight:800}
p{margin:1rem 0 0;overflow-wrap:anywhere}
form{margin:1.5rem 0 0}
button{appearance:none;border:2px solid #17181a;background:#17181a;color:#fff;padding:.8rem 1.3rem;font:700 .82rem ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border-radius:0}
button:hover,button:focus-visible{background:#c2371a;border-color:#c2371a}
button:focus-visible,a:focus-visible{outline:3px solid #c2371a;outline-offset:3px}
.links{margin-top:1.5rem;font:.82rem ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace}
.links a{color:#17181a}
.links a+a{margin-left:1.25rem}
`;

export const PAGE_CSS_PATH = "/api/newsletter.css";

function shell(lang: Lang, title: string, home: string, body: View): View {
  const copy = PAGE_COPY[lang];
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · ${copy.site}</title>
<link rel="stylesheet" href="${PAGE_CSS_PATH}">
</head>
<body>
<main>
<p class="brand"><a href="${home}"><span>)))</span> RADAR</a></p>
<div class="plate">${body}</div>
</main>
</body>
</html>`;
}

export interface SiteLinks {
  home: string;
  subscribe: string;
}

/** The step before a change: what will happen, and one button that posts back to the same address. */
export function askView(lang: Lang, kind: "confirm" | "leave", email: string, action: string, site: SiteLinks): View {
  const copy = PAGE_COPY[lang];
  const title = kind === "confirm" ? copy.confirmTitle : copy.leaveTitle;
  const text = kind === "confirm" ? copy.confirmText(email) : copy.leaveText(email);
  const label = kind === "confirm" ? copy.confirmButton : copy.leaveButton;
  return shell(
    lang,
    title,
    site.home,
    html`<h1>${title}</h1>
<p>${text}</p>
<form method="post" action="${action}"><button type="submit">${label}</button></form>`,
  );
}

/** After a change, or for a link that leads nowhere. */
export function resultView(lang: Lang, kind: "confirmed" | "left" | "invalid", site: SiteLinks): View {
  const copy = PAGE_COPY[lang];
  const title = kind === "confirmed" ? copy.confirmedTitle : kind === "left" ? copy.leftTitle : copy.invalidTitle;
  const text = kind === "confirmed" ? copy.confirmedText : kind === "left" ? copy.leftText : copy.invalidText;
  const again = kind === "confirmed" ? html`` : html`<a href="${site.subscribe}">${copy.subscribeAgain}</a>`;
  return shell(
    lang,
    title,
    site.home,
    html`<h1>${title}</h1>
<p>${text}</p>
<p class="links"><a href="${site.home}">${copy.backToSite}</a>${again}</p>`,
  );
}
