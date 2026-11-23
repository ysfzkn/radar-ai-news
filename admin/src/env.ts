export interface Env {
  DB: D1Database;
  INGEST_TOKEN: string; // secret
  ACCESS_TEAM_DOMAIN?: string; // e.g. "myteam.cloudflareaccess.com"
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string; // optional comma-separated allowlist
  DEV_NO_AUTH?: string; // "1" only in .dev.vars
  SITE_DEPLOY_HOOK?: string; // secret; an https URL that rebuilds the static site
  // Starting the daily workflow from /admin/run. Both are needed; without them the page says so.
  GITHUB_DISPATCH_TOKEN?: string; // secret; fine-grained token, Actions read and write on one repository
  GITHUB_REPO?: string; // "owner/name", not a secret
  // The e-mail newsletter (see src/mail.ts). Without the first three nothing is ever sent.
  RESEND_API_KEY?: string; // secret; a Resend key with sending access only
  MAIL_FROM?: string; // the sender's bare address on the domain verified at Resend, not a secret
  PUBLIC_URL?: string; // this Worker's own https origin, for the links inside a mail
  MAIL_REPLY_TO?: string; // optional address that replies go to
  SITE_URL?: string; // the static site's https origin; defaults to the live site
}
