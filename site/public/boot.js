// Runs first, in <head>, before anything is painted. It marks the page as scripted and decides
// whether this view opens with the loading screen. It stores nothing.
// The opening: every time the site is entered (a new visit, a typed address, a link from
// elsewhere, a reload), on whichever page; not when the reader moves between pages of the site,
// never for a reader who asked for less motion, on back/forward or in a hidden tab, and not for a
// reader the newsletter's form has just sent back with its answer (the address then ends with
// "#mail-" and a name: they are waiting for that answer, not arriving). It is the
// class `intro` on <html>, which the stylesheet paints as an ink cover before the first paint; the
// loader (scripts/intro.ts) draws over it. Anything that removes the class ends the opening at
// once, and this file removes it at the hard cap of 3500 ms whatever the loader does. The press or
// key that skips it is consumed, and so is the click that follows a press, so nothing under the
// opening is activated.
(function () {
  var d = document.documentElement;
  d.classList.add("js");

  try {
    var nav = performance.getEntriesByType("navigation")[0];
    var type = nav ? nav.type : "navigate";
    // Reached from another page of this site: no opening. A reload keeps its first referrer.
    var inside = type !== "reload" && (document.referrer || "").indexOf(location.origin + "/") === 0;
    var answered = (location.hash || "").indexOf("#mail-") === 0;
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState === "hidden" ||
      type === "back_forward" ||
      inside ||
      answered
    )
      return;
  } catch (e) {
    return;
  }
  d.classList.add("intro");
  // Until when the click after a skipping press is swallowed (0: none is).
  var swallow = 0;
  function end() {
    d.classList.remove("intro");
  }
  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }
  function skip(event) {
    if (!d.classList.contains("intro")) return;
    consume(event);
    if (event.type !== "keydown") swallow = Date.now() + 1000;
    end();
  }
  function click(event) {
    if (d.classList.contains("intro")) return consume(event);
    if (!swallow) return;
    var due = Date.now() < swallow;
    swallow = 0;
    if (due) consume(event);
  }
  addEventListener("pointerdown", skip, true);
  addEventListener("touchstart", skip, { capture: true, passive: false });
  addEventListener("keydown", skip, true);
  addEventListener("click", click, true);
  addEventListener("visibilitychange", end);
  setTimeout(end, 3500);
})();
