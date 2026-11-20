// Runs first, in <head>, before anything is painted. It marks the page as scripted and decides
// whether this view opens with the sweep (an edition page, once per browser session, never for a
// reader who asked for less motion, on back/forward or in a hidden tab). The opening is the class
// `intro` on <html>; anything that removes it ends the opening at once.
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (
      !d.hasAttribute("data-opening") ||
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
  function end() {
    d.classList.remove("intro");
  }
  addEventListener("pointerdown", end, true);
  addEventListener("keydown", end, true);
  addEventListener("visibilitychange", end);
  setTimeout(end, 1500);
})();
