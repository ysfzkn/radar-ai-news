// The scope's two behaviours that need a script; without it the instrument still works (links,
// sweep and readout are markup and CSS).
// 1. A pointer tilt of at most 6°, eased, for a fine pointer only and never under reduced motion,
//    passed to the stylesheet as --tilt-x / --tilt-y.
// 2. A blip turns hollow (`is-read`) once its story has been on screen for 2 s.
// It also stops the sweep while the scope is out of view.

const MAX_TILT = 6;
const READ_AFTER = 2000;

function tilt(scope: HTMLElement, dish: HTMLElement): void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(pointer: fine)");
  let x = 0;
  let y = 0;
  let goalX = 0;
  let goalY = 0;
  let frame = 0;

  const step = () => {
    x += (goalX - x) * 0.14;
    y += (goalY - y) * 0.14;
    const settled = Math.abs(goalX - x) < 0.02 && Math.abs(goalY - y) < 0.02;
    if (settled) {
      x = goalX;
      y = goalY;
    }
    dish.style.setProperty("--tilt-x", `${x.toFixed(2)}deg`);
    dish.style.setProperty("--tilt-y", `${y.toFixed(2)}deg`);
    frame = settled ? 0 : requestAnimationFrame(step);
  };
  const aim = (gx: number, gy: number) => {
    goalX = gx;
    goalY = gy;
    if (!frame) frame = requestAnimationFrame(step);
  };
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));

  scope.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !fine.matches || reduce.matches) return;
    const box = dish.getBoundingClientRect();
    const nx = clamp(((event.clientX - box.left) / box.width) * 2 - 1);
    const ny = clamp(((event.clientY - box.top) / box.height) * 2 - 1);
    // The side under the pointer dips away, as if pressed.
    aim(-ny * MAX_TILT, nx * MAX_TILT);
  });
  scope.addEventListener("pointerleave", () => aim(0, 0));
  reduce.addEventListener("change", () => aim(0, 0));
}

function reading(scope: HTMLElement): void {
  const blips = new Map<string, Element>();
  for (const blip of scope.querySelectorAll(".blip")) {
    const id = (blip.getAttribute("href") ?? "").slice(1);
    if (id) blips.set(id, blip);
  }
  const timers = new Map<Element, number>();
  // "On screen": crossing the middle half of the window, so a story only scrolled past does not count.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const story = entry.target;
        if (entry.isIntersecting && !timers.has(story)) {
          timers.set(
            story,
            window.setTimeout(() => {
              blips.get(story.id)?.classList.add("is-read");
              observer.unobserve(story);
              timers.delete(story);
            }, READ_AFTER),
          );
        } else if (!entry.isIntersecting && timers.has(story)) {
          clearTimeout(timers.get(story));
          timers.delete(story);
        }
      }
    },
    { rootMargin: "-25% 0px -25% 0px" },
  );
  for (const id of blips.keys()) {
    const story = document.getElementById(id);
    if (story) observer.observe(story);
  }
}

function idle(scope: HTMLElement): void {
  new IntersectionObserver(([entry]) => scope.classList.toggle("is-away", !entry.isIntersecting)).observe(scope);
}

// Its own failure stays its own: the opening and the reading details in the same bundle go on.
try {
  const scope = document.querySelector<HTMLElement>(".scope");
  const dish = scope?.querySelector<HTMLElement>("[data-scope-dish]");
  if (scope && dish && "IntersectionObserver" in window) {
    tilt(scope, dish);
    reading(scope);
    idle(scope);
  }
  // The home page's introduction: the same tilt, on its little radar table.
  const stage = document.querySelector<HTMLElement>(".pitch-stage");
  const rig = stage?.querySelector<HTMLElement>(".pitch-rig");
  if (stage && rig) tilt(stage, rig);
} catch {
  // The scope is still its markup and stylesheet: links, rings and readout.
}
