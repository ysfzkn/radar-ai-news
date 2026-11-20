// Two reading details on an edition page, both for readers who have not asked for less motion,
// both once, both by class only (the stylesheet does the timing):
// 1. The "Neden önemli" / "Why it matters" line inks in word by word the first time it is seen.
//    Its words are wrapped in spans; the text stays exactly what it was.
// 2. The end of the edition switches off like a screen the first time it is seen.
// Without this script, or with reduced motion, the lines simply stand as they are.
import { inkTokens } from "../lib/reading";

function inkLine(line: HTMLElement): void {
  // Only the line's own text: the pill and its read-only colon are elements and stay as they are.
  for (const node of [...line.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? "")) continue;
    const pieces = inkTokens(node.textContent ?? "").map((token) => {
      if (!token.word) return document.createTextNode(token.text);
      const span = document.createElement("span");
      span.className = "ink-w";
      span.textContent = token.text;
      span.style.setProperty("--i", String(token.step));
      return span;
    });
    node.replaceWith(...pieces);
  }
  line.classList.add("ink-wait");
}

function start(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const lines = [...document.querySelectorAll<HTMLElement>(".story-why")];
  const end = document.querySelector<HTMLElement>(".closed");
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        target.classList.add(target === end ? "is-off" : "ink-go");
        seen.unobserve(target);
      }
    },
    { threshold: 0.6 },
  );
  for (const line of lines) {
    inkLine(line);
    seen.observe(line);
  }
  if (end) seen.observe(end);
}

start();
