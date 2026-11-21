// The home page's search field. The site's CSP (form-action 'none') refuses a plain form, so with
// script the field takes its words to the archive's own search (its `q` parameter, which
// scripts/search.ts reads on load); without script the form stays hidden and a link to the archive
// stands in its place. The topic chips need no script: they are radio buttons the stylesheet reads.

export {};

try {
  const form = document.querySelector<HTMLFormElement>("[data-desk]");
  const link = document.querySelector<HTMLElement>("[data-desk-link]");
  if (form && link) {
    form.hidden = false;
    link.hidden = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = String(new FormData(form).get("q") ?? "").trim();
      location.assign(form.dataset.desk + (q ? `?q=${encodeURIComponent(q)}` : ""));
    });
  }
} catch {
  // The link to the archive stays.
}
