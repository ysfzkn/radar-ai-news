// The heat strip is one tab stop (the newest edition's day carries tabindex 0 in the markup, the
// others -1); with this script the arrow keys, Home and End move between the days. Without it the
// other days are still links for a pointer, and every edition is a row of the archive list below.
import { heatTarget } from "../lib/heat";

function start(strip: HTMLElement): void {
  // Oldest first: the dates sort as text.
  const days = [...strip.querySelectorAll<HTMLAnchorElement>("a[data-day]")].sort((a, b) =>
    (a.dataset.day ?? "") < (b.dataset.day ?? "") ? -1 : 1,
  );
  const stop = (day: HTMLAnchorElement) => {
    for (const other of days) other.tabIndex = other === day ? 0 : -1;
  };
  days.forEach((day, i) => {
    day.addEventListener("focus", () => stop(day));
    day.addEventListener("keydown", (event) => {
      const to = heatTarget(event, i, days.length);
      if (to === null) return;
      event.preventDefault();
      days[to].focus();
    });
  });
}

try {
  const strip = document.querySelector<HTMLElement>(".heat");
  if (strip) start(strip);
} catch {
  // The strip stays as the markup made it: one tab stop, every day a link.
}
