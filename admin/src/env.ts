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
}
