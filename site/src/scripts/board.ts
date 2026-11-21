// A departure board's flaps, for readers who have not asked for less motion.
// 1. An edition's big date and the masthead's counts settle in once, when first in view (and only
//    after the opening): each character flips through a few glyphs and lands, left to right, in
//    about half a second.
// 2. The subscribe button's label decodes the same way while a mouse comes onto it.
// The real text is in the page from the start. While the flaps turn, the element holds that text
// for assistive tech (visually hidden) beside the turning glyphs (hidden from it), each glyph in a
// cell as wide as its real character, so nothing moves; then the plain text comes back.

export {};

const root = document.documentElement;
const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIKLMNOPRSTUVYZ";
/** Glyphs a character shows before it lands, and how long each stays. */
const FLIPS = 3;
const FLIP_MS = 45;

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A glyph of the same kind as `ch`: a digit for a digit, a letter of the same case for a letter. */
function glyph(ch: string): string {
  const set = DIGITS.includes(ch) ? DIGITS : UPPER;
  const g = set[Math.floor(Math.random() * set.length)];
  return ch === ch.toLocaleLowerCase() && ch !== ch.toLocaleUpperCase() ? g.toLowerCase() : g;
}

function flap(el: HTMLElement): void {
  const text = el.textContent ?? "";
  if (el.dataset.flap || !text.trim() || el.children.length) return;
  el.dataset.flap = "1";
  const real = document.createElement("span");
  real.className = "visually-hidden";
  real.textContent = text;
  const show = document.createElement("span");
  show.setAttribute("aria-hidden", "true");
  const cells: [HTMLElement, string][] = [];
  // Words stay whole (no break inside one); the spaces between them stay plain text.
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s/.test(part)) {
      show.append(part);
      continue;
    }
    const word = document.createElement("span");
    word.className = "flap-word";
    for (const ch of part) {
      const cell = document.createElement("span");
      cell.textContent = ch;
      word.append(cell);
      if (/[\p{L}\p{N}]/u.test(ch)) cells.push([cell, ch]);
    }
    show.append(word);
  }
  el.replaceChildren(real, show);
  for (const [cell] of cells) cell.style.setProperty("--w", `${cell.getBoundingClientRect().width}px`);
  for (const [cell] of cells) cell.className = "flap";
  const gap = Math.min(24, 420 / cells.length);
  const start = performance.now();
  const tick = (now: number) => {
    let busy = false;
    cells.forEach(([cell, ch], i) => {
      const k = Math.floor((now - start - i * gap) / FLIP_MS);
      if (k < FLIPS) {
        busy = true;
        if (cell.dataset.k !== String(k)) {
          cell.dataset.k = String(k);
          cell.textContent = glyph(ch);
        }
      } else cell.textContent = ch;
    });
    if (busy) requestAnimationFrame(tick);
    else {
      el.replaceChildren(text);
      delete el.dataset.flap;
    }
  };
  requestAnimationFrame(tick);
}

/** Runs `fn` once the opening is over (at once when there is none). */
function afterOpening(fn: () => void): void {
  if (!root.classList.contains("intro")) return fn();
  const watch = new MutationObserver(() => {
    if (root.classList.contains("intro")) return;
    watch.disconnect();
    fn();
  });
  watch.observe(root, { attributes: true, attributeFilter: ["class"] });
}

try {
  const board = [...document.querySelectorAll<HTMLElement>(".masthead :is(.mh-big, .mh-rest)")];
  if (board.length && "IntersectionObserver" in window && !calm()) {
    afterOpening(() => {
      const seen = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seen.unobserve(entry.target);
          if (!calm()) flap(entry.target as HTMLElement);
        }
      });
      for (const el of board) seen.observe(el);
    });
  }
  for (const button of document.querySelectorAll<HTMLElement>(".subscribe:not([aria-current])")) {
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && !calm()) flap(button);
    });
  }
} catch {
  // The text stands as the page has it.
}
