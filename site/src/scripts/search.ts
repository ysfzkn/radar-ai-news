// The archive search. It runs only on the archive pages, fetches its data on first use,
// and writes story text to the page with textContent only.
import {
  MIN_ECHO,
  arrowStep,
  categoryOf,
  fill,
  highlight,
  isEmptyQuery,
  readQuery,
  safeHref,
  search,
  writeQuery,
  type SearchDoc,
  type SearchQuery,
} from "../lib/search";
import type { Category } from "../lib/schema";

/** The copy templates of `COPY[lang].search.templates`, with `{n}` where the number goes. */
interface Labels {
  months: string[];
  sourceOne: string;
  sourceMany: string;
  countNone: string;
  countOne: string;
  countMany: string;
  more: string;
}

/** Most results written to the page at once. */
const LIMIT = 100;
/** How long typing must pause before the search runs. */
const TYPING = 150;

function start(root: HTMLElement): void {
  const lang = document.documentElement.lang === "en" ? "en" : "tr";
  const labels: Labels = JSON.parse(root.dataset.labels ?? "{}");
  const input = root.querySelector<HTMLInputElement>("#search-q")!;
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-category]")];
  const month = root.querySelector<HTMLSelectElement>("[data-month]")!;
  const echo = root.querySelector<HTMLInputElement>("[data-echo]")!;
  const clear = root.querySelector<HTMLButtonElement>("[data-clear]")!;
  const count = root.querySelector<HTMLElement>("[data-count]")!;
  const results = root.querySelector<HTMLElement>("[data-results]")!;
  const more = root.querySelector<HTMLElement>("[data-more]")!;
  const empty = root.querySelector<HTMLElement>("[data-empty]")!;
  const list = document.querySelector<HTMLElement>("[data-archive-list]")!;
  // The category names of this language, from the chips: shown on each result and searched too.
  const names: Partial<Record<Category, string>> = {};
  for (const chip of chips) {
    const category = categoryOf(chip.dataset.category);
    if (category) names[category] = chip.textContent!.trim();
  }
  const offered = [...month.options].map((option) => option.value).filter(Boolean);

  let state: SearchQuery = readQuery(new URLSearchParams(location.search), lang, offered);
  let docs: SearchDoc[] | null = null;
  let pending: Promise<void> | null = null;
  let failed = false;

  function load(): void {
    if (pending) return;
    pending = fetch(root.dataset.src!)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((json: { version?: number; docs?: SearchDoc[] }) => {
        if (json.version !== 1 || !Array.isArray(json.docs)) throw new Error("bad data");
        docs = json.docs;
      })
      .catch(() => {
        failed = true;
      })
      .then(render);
  }

  /** Puts the state into the controls. */
  function sync(): void {
    input.value = state.q;
    month.value = state.month ?? "";
    echo.checked = state.minEcho > 0;
    for (const chip of chips) {
      const on = (chip.dataset.category || null) === state.category;
      chip.setAttribute("aria-checked", String(on));
      chip.tabIndex = on ? 0 : -1;
    }
  }

  /** Text with the query's matches in <mark>, built from text nodes only. */
  function marked(parent: HTMLElement, text: string): HTMLElement {
    for (const part of highlight(text, state.q)) {
      if (part.hit) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        parent.append(mark);
      } else {
        parent.append(document.createTextNode(part.text));
      }
    }
    return parent;
  }

  function row(doc: SearchDoc): HTMLLIElement {
    const [y, m, d] = doc.d.split("-").map(Number);
    const sources = doc.n === 1 ? labels.sourceOne : fill(labels.sourceMany, doc.n);
    // The category comes from JSON: it names a class only when it is one of the eight.
    const category = categoryOf(doc.c);
    const li = document.createElement("li");
    li.className = category ? `result cat-${category}` : "result";
    const meta = document.createElement("p");
    meta.className = "result-meta label";
    const tag = document.createElement("span");
    tag.className = "result-cat caps";
    tag.textContent = (category && names[category]) || String(doc.c);
    const date = document.createElement("time");
    date.className = "result-date";
    date.dateTime = String(doc.d);
    date.textContent = `${d} ${labels.months[m - 1] ?? ""} ${y}`;
    const count = document.createElement("span");
    count.className = "result-sources";
    count.textContent = sources;
    meta.append(tag, " ", date, " · ", count);
    const heading = document.createElement("h2");
    heading.className = "result-title list-title";
    const title = document.createElement("a");
    title.href = safeHref(String(doc.u)) ?? "/";
    heading.append(marked(title, String(doc.t)));
    const summary = marked(document.createElement("p"), String(doc.s));
    summary.className = "result-summary";
    li.append(meta, heading, summary);
    return li;
  }

  /** The archive list back, no results: the state without a search, or after a failure. */
  function plain(): void {
    list.hidden = false;
    results.hidden = true;
    more.hidden = true;
    empty.hidden = true;
    results.replaceChildren();
    count.textContent = failed ? (root.dataset.failed ?? "") : "";
  }

  function render(): void {
    try {
      show();
    } catch {
      // Whatever went wrong (malformed data, an old browser), the reader keeps the archive list
      // and the line that says the search is not working.
      failed = true;
      plain();
    }
  }

  function show(): void {
    if (isEmptyQuery(state) || failed || docs === null) {
      plain();
      return;
    }
    const found = search(docs, state, names);
    // The rows are built before the list is hidden, so a failure leaves the list in place.
    const rows = found.slice(0, LIMIT).map(row);
    list.hidden = true;
    results.hidden = found.length === 0;
    empty.hidden = found.length > 0;
    results.replaceChildren(...rows);
    // The count is the true total; when more were found than are shown, the line under the list says so.
    more.hidden = found.length <= LIMIT;
    more.textContent = found.length > LIMIT ? fill(labels.more, LIMIT) : "";
    count.textContent =
      found.length === 0
        ? labels.countNone
        : found.length === 1
          ? labels.countOne
          : fill(labels.countMany, found.length);
  }

  /** The state changed: mirror it to the address bar and show it. */
  function change(): void {
    clearTimeout(typing);
    typing = 0;
    try {
      // Safari allows only so many calls in a short time and throws past that; the address then
      // lags behind, the results do not.
      history.replaceState(null, "", location.pathname + writeQuery(state, lang) + location.hash);
    } catch {
      // The search goes on without updating the address.
    }
    load();
    render();
  }

  // Typing waits for a pause of TYPING ms before it searches; the other controls act at once.
  let typing = 0;
  input.addEventListener("focus", load);
  input.addEventListener("input", () => {
    state = { ...state, q: input.value };
    clearTimeout(typing);
    typing = window.setTimeout(change, TYPING);
  });
  month.addEventListener("change", () => {
    state = { ...state, month: month.value || null };
    change();
  });
  echo.addEventListener("change", () => {
    state = { ...state, minEcho: echo.checked ? MIN_ECHO : 0 };
    change();
  });
  chips.forEach((chip, i) => {
    chip.addEventListener("click", () => {
      state = { ...state, category: categoryOf(chip.dataset.category) };
      sync();
      change();
    });
    chip.addEventListener("keydown", (event) => {
      const step = arrowStep(event);
      if (!step) return;
      event.preventDefault();
      const next = chips[(i + step + chips.length) % chips.length];
      next.focus();
      next.click();
    });
  });
  clear.addEventListener("click", () => {
    state = { q: "", category: null, month: null, minEcho: 0 };
    sync();
    change();
    input.focus();
  });

  sync();
  root.hidden = false;
  if (!isEmptyQuery(state)) load();
}

const root = document.querySelector<HTMLElement>("[data-search]");
if (root) start(root);
