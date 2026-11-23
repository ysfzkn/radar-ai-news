// The e-mail newsletter's switch. Read at build time only (pages and components), never by a
// script that runs in the browser.
//
// The form posts to the admin Worker, which stores the address and mails a confirmation link (see
// docs/admin.md). While the switch is off the subscribe page is RSS only and says that there is no
// newsletter; nothing on the site asks for an address. Turn it on only once that Worker is
// deployed with sending set up: an open form whose Worker cannot send answers "not open yet".

/** The state of a build that does not say otherwise. */
const OPEN_BY_DEFAULT = false;

// RADAR_NEWSLETTER=1 or =0 overrides the default for one build, so the tests can build both.
const asked = process.env.RADAR_NEWSLETTER;

export const NEWSLETTER = {
  open: asked === "1" || (asked !== "0" && OPEN_BY_DEFAULT),
  /** Where the form posts. The site's Content-Security-Policy (public/_headers) names this origin. */
  action: "https://radar-admin.ozkan-development.workers.dev/api/subscribe",
} as const;

/** The notices of the subscribe page, by the id the Worker sends the reader back to. */
export const MAIL_STATES = ["sent", "invalid", "later", "error", "closed"] as const;
export type MailState = (typeof MAIL_STATES)[number];
