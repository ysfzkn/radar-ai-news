export interface Env {
  DB: D1Database;
  INGEST_TOKEN: string; // secret
  ACCESS_TEAM_DOMAIN?: string; // e.g. "myteam.cloudflareaccess.com"
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string; // optional comma-separated allowlist
  DEV_NO_AUTH?: string; // "1" only in .dev.vars
  SITE_DEPLOY_HOOK?: string; // secret; an https URL that rebuilds the static site
}
