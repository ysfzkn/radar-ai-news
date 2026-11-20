// The archive search. It runs only on the archive pages, fetches its data on first use,
// and writes story text to the page with textContent only.
import { isEmptyQuery, readQuery, search, writeQuery, type SearchDoc, type SearchQuery } from "../lib/search";

interface Labels {
  months: string[];
  sourceOne: string;
  sourceMany: string;
  countNone: string;
  countOne: string;
  countMany: string;
}

/** Most results written to the page at once. */
const LIMIT = 100;

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
  const list = document.querySelector<HTMLElement>("[data-archive-list]")!;
  const names = new Map(chips.map((chip) => [chip.dataset.category!, chip.textContent!.trim()]));

  let state: SearchQuery = readQuery(new URLSearchParams(location.search), lang);
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

  function row(doc: SearchDoc): HTMLLIElement {
    const [y, m, d] = doc.d.split("-").map(Number);
    const sources = doc.n === 1 ? labels.sourceOne : labels.sourceMany.replace("{n}", String(doc.n));
    const li = document.createElement("li");
    li.className = `result cat-${doc.c}`;
    const meta = document.createElement("p");
    meta.className = "result-meta label";
    const date = document.createElement("time");
    date.dateTime = doc.d;
    date.textContent = `${d} ${labels.months[m - 1]} ${y}`;
    const tag = document.createElement("span");
    tag.className = "result-cat caps";
    tag.textContent = names.get(doc.c) ?? doc.c;
    meta.append(date, " · ", tag, " · ", sources);
    const title = document.createElement("a");
    title.className = "result-title list-title";
    title.href = doc.u.startsWith("/") && !doc.u.startsWith("//") ? doc.u : "/";
    title.textContent = doc.t;
    const summary = document.createElement("p");
    summary.className = "result-summary";
    summary.textContent = doc.s;
    li.append(meta, title, summary);
    return li;
  }

  function render(): void {
    if (isEmptyQuery(state) || failed || docs === null) {
      list.hidden = false;
      results.hidden = true;
      results.replaceChildren();
      count.textContent = failed ? (root.dataset.failed ?? "") : "";
      return;
    }
    const found = search(docs, state);
    list.hidden = true;
    results.hidden = false;
    results.replaceChildren(...found.slice(0, LIMIT).map(row));
    count.textContent =
      found.length === 0
        ? labels.countNone
        : found.length === 1
          ? labels.countOne
          : labels.countMany.replace("{n}", String(found.length));
  }

  /** The state changed: mirror it to the address bar and show it. */
  function change(): void {
    history.replaceState(null, "", location.pathname + writeQuery(state, lang) + location.hash);
    load();
    render();
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", () => {
    state = { ...state, q: input.value };
    change();
  });
  month.addEventListener("change", () => {
    state = { ...state, month: month.value || null };
    change();
  });
  echo.addEventListener("change", () => {
    state = { ...state, minEcho: echo.checked ? 3 : 0 };
    change();
  });
  chips.forEach((chip, i) => {
    chip.addEventListener("click", () => {
      state = { ...state, category: (chip.dataset.category || null) as SearchQuery["category"] };
      sync();
      change();
    });
    chip.addEventListener("keydown", (event) => {
      const step =
        event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
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
