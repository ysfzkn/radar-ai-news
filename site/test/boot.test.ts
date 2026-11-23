import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// boot.js runs as it is, in a bare context that stands in for the browser: no DOM library, only
// the few things the file touches. Each case checks what the file decides, not what it contains.
const source = readFileSync(join(resolve(import.meta.dirname, ".."), "public", "boot.js"), "utf8");

interface Options {
  reduce?: boolean;
  hidden?: boolean;
  navType?: string;
  /** `document.referrer`; the site itself is https://radar.example. */
  referrer?: string;
  /** `location.hash`, for example "#mail-sent". */
  hash?: string;
  stored?: Record<string, string>;
  storageThrows?: boolean;
}

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  target: unknown;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function boot(options: Options = {}) {
  const classes = new Set<string>();
  const store = new Map(Object.entries(options.stored ?? {}));
  const windowListeners: { type: string; fn: Listener; capture: boolean }[] = [];
  const documentListeners: { type: string; fn: Listener }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let now = 1000;
  const guard = <T>(fn: () => T): T => {
    if (options.storageThrows) throw new Error("SecurityError");
    return fn();
  };
  /** A button marked as the old pause was: boot.js must no longer answer it. */
  const button = () => {
    const b = {
      attrs: new Map<string, string>(),
      setAttribute: (k: string, v: string) => void b.attrs.set(k, v),
      closest: (sel: string) => (sel === "[data-still]" ? b : null),
    };
    return b;
  };
  const buttons = [button(), button()];
  const plain = { closest: () => null };
  const documentElement = {
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
      toggle: (c: string) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
    },
  };
  const context = {
    document: {
      documentElement,
      visibilityState: options.hidden ? "hidden" : "visible",
      referrer: options.referrer ?? "",
      querySelectorAll: (sel: string) => (sel === "[data-still]" ? buttons : []),
      addEventListener: (type: string, fn: Listener) => documentListeners.push({ type, fn }),
    },
    location: { origin: "https://radar.example", hash: options.hash ?? "" },
    performance: { getEntriesByType: () => [{ type: options.navType ?? "navigate" }] },
    matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" && !!options.reduce }),
    sessionStorage: {
      getItem: (k: string) => guard(() => store.get(k) ?? null),
      setItem: (k: string, v: string) => guard(() => void store.set(k, v)),
      removeItem: (k: string) => guard(() => void store.delete(k)),
    },
    addEventListener: (type: string, fn: Listener, opts?: boolean | { capture?: boolean }) =>
      windowListeners.push({ type, fn, capture: opts === true || (typeof opts === "object" && !!opts.capture) }),
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    Date: { now: () => now },
  };
  runInNewContext(source, context);

  const event = (type: string, target: unknown = plain): FakeEvent => ({
    type,
    target,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  });
  /** Dispatches like a browser: the window's capture listeners first, then the document's. */
  const fire = (type: string, target?: unknown) => {
    const e = event(type, target);
    for (const l of windowListeners.filter((x) => x.type === type && x.capture)) l.fn(e);
    if (!e.stopped) for (const l of documentListeners.filter((x) => x.type === type)) l.fn(e);
    return e;
  };
  return {
    classes,
    store,
    buttons,
    windowListeners,
    fire,
    timers,
    runTimers: () => timers.splice(0).forEach((t) => t.fn()),
    advance: (ms: number) => void (now += ms),
  };
}

/** A page of this site, as the referrer of a move between its pages. */
const INSIDE = "https://radar.example/arsiv/";

describe("boot.js: the opening", () => {
  it("marks every page as scripted, and opens on every entry to the site, storing nothing", () => {
    for (const options of [
      {},
      { referrer: "https://elsewhere.example/a" },
      // A look-alike host is not this site.
      { referrer: "https://radar.example.evil.test/" },
      // A reload plays it again, though the page keeps its first referrer.
      { navType: "reload", referrer: INSIDE },
      { storageThrows: true },
    ]) {
      const page = boot(options);
      expect(page.classes.has("js"), JSON.stringify(options)).toBe(true);
      expect(page.classes.has("intro"), JSON.stringify(options)).toBe(true);
      expect(page.store.size, JSON.stringify(options)).toBe(0);
    }
  });

  it("skips it between pages of the site, for reduced motion, a hidden tab and back/forward", () => {
    for (const options of [{ referrer: INSIDE }, { reduce: true }, { hidden: true }, { navType: "back_forward" }]) {
      const page = boot(options);
      expect(page.classes.has("intro"), JSON.stringify(options)).toBe(false);
      expect(page.classes.has("js"), JSON.stringify(options)).toBe(true);
    }
  });

  it("skips it for a reader the newsletter's form sent back with its answer, and only for them", () => {
    for (const hash of ["#mail-sent", "#mail-invalid", "#mail-error"]) {
      // The Worker's redirect carries no referrer, so without the hash this would be an entry.
      expect(boot({ hash }).classes.has("intro"), hash).toBe(false);
      expect(boot({ hash }).classes.has("js"), hash).toBe(true);
    }
    for (const hash of ["", "#s-0123abcd", "#email", "#x-mail-sent"]) {
      expect(boot({ hash }).classes.has("intro"), hash).toBe(true);
    }
  });

  it("ends it on its own at the hard cap of 3500 ms, whatever the loader does", () => {
    const page = boot();
    expect(page.timers.map((t) => t.ms)).toEqual([3500]);
    page.runTimers();
    expect(page.classes.has("intro")).toBe(false);
  });

  it("consumes the press that skips it, and the click that follows, so no link underneath is followed", () => {
    const page = boot();
    // The listeners sit in the capture phase, ahead of anything on the page.
    for (const type of ["pointerdown", "touchstart", "keydown", "click"]) {
      expect(page.windowListeners.some((l) => l.type === type && l.capture), type).toBe(true);
    }
    const down = page.fire("pointerdown");
    expect(down.prevented && down.stopped).toBe(true);
    expect(page.classes.has("intro")).toBe(false);
    const click = page.fire("click");
    expect(click.prevented && click.stopped).toBe(true);
    // Only that one click: the next is the reader's own.
    const later = page.fire("click");
    expect(later.prevented || later.stopped).toBe(false);
  });

  it("forgets the swallowed click after a moment when none comes (a tap whose click was cancelled)", () => {
    const page = boot();
    page.fire("touchstart");
    expect(page.classes.has("intro")).toBe(false);
    page.advance(1500);
    const click = page.fire("click");
    expect(click.prevented).toBe(false);
  });

  it("consumes the key that skips it, and leaves later keys alone", () => {
    const page = boot();
    const key = page.fire("keydown");
    expect(key.prevented && key.stopped).toBe(true);
    expect(page.classes.has("intro")).toBe(false);
    const next = page.fire("keydown");
    expect(next.prevented || next.stopped).toBe(false);
    // A key skip leaves no click to swallow.
    expect(page.fire("click").prevented).toBe(false);
  });

  it("does not touch presses on a page that did not open", () => {
    const page = boot({ referrer: INSIDE });
    for (const type of ["pointerdown", "keydown", "click"]) {
      const e = page.fire(type);
      expect(e.prevented || e.stopped, type).toBe(false);
    }
  });
});

describe("boot.js: storage", () => {
  it("touches no storage at all: there is no pause to remember", () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|cookie|radar:/);
    expect(source).not.toMatch(/still/);
    const page = boot({ stored: { "radar:still": "1" }, referrer: INSIDE });
    expect(page.classes.has("still")).toBe(false);
    page.fire("click", page.buttons[0]);
    expect(page.classes.has("still")).toBe(false);
    expect([...page.store.keys()]).toEqual(["radar:still"]);
  });
});
