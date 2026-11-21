// The command palette, the keyboard shortcuts and the copy buttons, on every page.
// - Ctrl K or ⌘K (anywhere), or / (outside a field), opens the palette: the site's pages, filtered
//   as the reader types, and the stories of this language from the search data, fetched from this
//   site on first use. Arrow keys move, Enter opens, Esc closes.
// - j and k go to the next and the previous story, [ and ] to the previous and the next issue or
//   week, ? opens the list of shortcuts. These are ignored while typing in a field and with Ctrl,
//   ⌘ or Alt held.
// - A command on the page (data-copy) and each story's link get a copy button.
// Story text reaches the page as text only.
import { categoryOf, fold, safeHref, search, type SearchDoc } from "../lib/search";
import type { Category } from "../lib/schema";

const root = document.documentElement;
const palette = document.querySelector<HTMLDialogElement>("dialog[data-palette]");
const sheet = document.querySelector<HTMLDialogElement>("dialog[data-keys]");
/** Most stories the palette lists. */
const LIMIT = 8;

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  if (label) b.setAttribute("aria-label", label);
  return b;
}

/** Copies text, then reads `done` on the button for a moment. */
function copier(b: HTMLButtonElement, text: () => string, done: string): void {
  b.addEventListener("click", () => {
    const was = b.textContent;
    navigator.clipboard
      ?.writeText(text())
      .then(() => {
        b.textContent = done;
        b.classList.add("is-done");
        setTimeout(() => {
          b.textContent = was;
          b.classList.remove("is-done");
        }, 1600);
      })
      .catch(() => {});
  });
}

function setup(dialog: HTMLDialogElement, keys: HTMLDialogElement): void {
  const data = dialog.dataset;
  const input = dialog.querySelector<HTMLInputElement>(".pal-input")!;
  const list = dialog.querySelector<HTMLElement>(".pal-list")!;
  const pages = [...list.querySelectorAll<HTMLLIElement>(".pal-item")];
  const storiesGroup = list.querySelector<HTMLElement>('[data-group="stories"]')!;
  const pagesGroup = list.querySelector<HTMLElement>('[data-group="pages"]')!;
  const note = dialog.querySelector<HTMLElement>("[data-note]")!;
  const names: Partial<Record<Category, string>> = {};
  for (const li of pages) {
    const category = categoryOf(li.dataset.category);
    if (category) names[category] = li.dataset.find!.split(" ").slice(2).join(" ");
  }
  const haystack = new Map(pages.map((li) => [li, fold(`${li.textContent} ${li.dataset.find}`)]));
  let docs: SearchDoc[] | null = null;
  let loading = false;
  let found: HTMLLIElement[] = [];
  let active = 0;

  const shown = () => [...pages.filter((li) => !li.hidden), ...found];

  function mark(i: number): void {
    const items = shown();
    active = items.length ? (i + items.length) % items.length : 0;
    items.forEach((li, k) => li.setAttribute("aria-selected", String(k === active)));
    const on = items[active];
    if (on) {
      input.setAttribute("aria-activedescendant", on.id);
      on.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function storyItem(doc: SearchDoc, i: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "pal-item";
    li.id = `pal-s-${i}`;
    li.setAttribute("role", "option");
    const a = document.createElement("a");
    a.href = safeHref(String(doc.u)) ?? "/";
    a.tabIndex = -1;
    const kind = document.createElement("span");
    kind.className = "pal-kind label";
    kind.textContent = String(doc.n);
    const title = document.createElement("span");
    title.className = "pal-text";
    title.textContent = String(doc.t);
    const date = document.createElement("span");
    date.className = "pal-path label";
    date.textContent = String(doc.d);
    a.append(kind, title, date);
    li.append(a);
    return li;
  }

  function filter(): void {
    const terms = fold(input.value).split(/\s+/).filter(Boolean);
    for (const li of pages) li.hidden = !terms.every((t) => haystack.get(li)!.includes(t));
    pagesGroup.hidden = pages.every((li) => li.hidden);
    for (const li of found) li.remove();
    found = [];
    const q = input.value.trim();
    if (q.length > 1 && docs) {
      found = search(docs, { q, category: null, month: null, minEcho: 0 }, names).slice(0, LIMIT).map(storyItem);
      list.append(...found);
    }
    storiesGroup.hidden = found.length === 0;
    const empty = shown().length === 0;
    note.hidden = !(empty || (q.length > 1 && !docs && loading));
    note.textContent = empty && !(loading && !docs) ? data.none! : data.loading!;
    mark(0);
  }

  function load(): void {
    if (docs || loading) return;
    loading = true;
    fetch(data.src!)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { version?: number; docs?: SearchDoc[] } | null) => {
        if (json?.version === 1 && Array.isArray(json.docs)) docs = json.docs;
      })
      .catch(() => {})
      .then(() => {
        loading = false;
        if (dialog.open) filter();
      });
  }

  function open(): void {
    if (keys.open) keys.close();
    if (!dialog.open) {
      dialog.showModal();
      input.value = "";
      filter();
      load();
    }
    input.focus();
  }

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      mark(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      shown()[active]?.querySelector("a")?.click();
    }
  });
  list.addEventListener("pointermove", (event) => {
    const li = (event.target as Element).closest?.(".pal-item");
    const i = shown().indexOf(li as HTMLLIElement);
    if (i >= 0 && i !== active) mark(i);
  });
  // A press on the backdrop (the dialog box itself, outside its content) closes it.
  for (const d of [dialog, keys]) d.addEventListener("click", (event) => event.target === d && d.close());
  keys.querySelector("[data-close]")?.addEventListener("click", () => keys.close());

  // The strip's button: shown with script, reading ⌘K on Apple systems and Ctrl K elsewhere.
  const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-palette-open]")) {
    const key = b.querySelector("kbd");
    if (key) key.textContent = apple ? "⌘K" : "Ctrl K";
    b.hidden = false;
    b.addEventListener("click", open);
  }

  const stories = () => [...document.querySelectorAll<HTMLElement>("article.story")];
  /** Scrolls to the next (1) or the previous (-1) story and puts the focus on its number. */
  function step(dir: number): void {
    const all = stories();
    const tops = all.map((s) => s.getBoundingClientRect().top);
    let i = -1;
    if (dir > 0) i = tops.findIndex((y) => y > 40);
    else for (let k = 0; k < tops.length; k++) if (tops[k] < 8) i = k;
    const target = all[i];
    if (!target) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    target.querySelector<HTMLElement>(".story-no")?.focus({ preventScroll: true });
  }

  addEventListener("keydown", (event) => {
    if (root.classList.contains("intro") || event.defaultPrevented) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
      return;
    }
    const field = (event.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]");
    if (field || event.ctrlKey || event.metaKey || event.altKey || dialog.open || keys.open) return;
    const go = (rel: string) => document.querySelector<HTMLAnchorElement>(`.pager a[rel="${rel}"]`)?.click();
    if (key === "/") open();
    else if (key === "?") keys.showModal();
    else if (key === "j") step(1);
    else if (key === "k") step(-1);
    else if (key === "[") go("prev");
    else if (key === "]") go("next");
    else return;
    event.preventDefault();
  });

  // Copy buttons: after each command on the page, and in each story's label row.
  for (const code of document.querySelectorAll<HTMLElement>("code[data-copy]")) {
    const b = button("copy-code label", data.copyLabel!);
    copier(b, () => code.textContent ?? "", data.done!);
    code.after(b);
  }
  for (const story of stories()) {
    const no = story.querySelector(".story-no");
    const meta = story.querySelector(".story-meta");
    if (!no || !meta || !story.id) continue;
    const b = button("copy-link label", data.link!, data.linkName!.replace("{n}", no.textContent ?? ""));
    copier(b, () => `${location.origin}${location.pathname}#${story.id}`, data.done!);
    meta.append(b);
  }
}

try {
  if (palette && sheet) setup(palette, sheet);
} catch {
  // Without the palette the page is still whole: every link and the archive search stay.
}
