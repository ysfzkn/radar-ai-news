// Runs first, in <head>, before anything is painted. It marks the page as scripted, applies the
// reader's pause and decides whether this view opens with the loading screen.
// 1. The pause: the class `still` on <html> stops every looping motion. The buttons marked
//    `data-still` (on the scope and in the footer) toggle it; it is remembered for the browser
//    session under `radar:still`.
// 2. The opening: the first page of a browser session, whichever page it is; never for a reader
//    who asked for less motion, on back/forward or in a hidden tab. It is the class `intro` on
//    <html>, which the stylesheet paints as an ink cover before the first paint; the loader
//    (scripts/intro.ts) draws over it. Anything that removes the class ends the opening at once,
//    and this file removes it at the hard cap of 3500 ms whatever the loader does. The press or key
//    that skips it is consumed, and so is the click that follows a press, so nothing under the
//    opening is activated.
// Storage is only ever touched inside try/catch: when it fails, motion stays on and the opening
// is skipped.
(function () {
  var d = document.documentElement;
  d.classList.add("js");

  var STILL = "radar:still";
  try {
    if (sessionStorage.getItem(STILL)) d.classList.add("still");
  } catch (e) {}
  document.addEventListener("click", function (event) {
    var t = event.target;
    if (!t || !t.closest || !t.closest("[data-still]")) return;
    var on = d.classList.toggle("still");
    try {
      if (on) sessionStorage.setItem(STILL, "1");
      else sessionStorage.removeItem(STILL);
    } catch (e) {}
  });

  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState === "hidden" ||
      (nav && nav.type === "back_forward") ||
      sessionStorage.getItem("radar:intro")
    )
      return;
    sessionStorage.setItem("radar:intro", "1");
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
