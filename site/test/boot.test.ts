import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// boot.js runs as it is, in a bare context that stands in for the browser: no DOM library, only
// the few things the file touches. Each case checks what the file decides, not what it contains.
const source = readFileSync(join(resolve(import.meta.dirname, ".."), "public", "boot.js"), "utf8");

interface Options {
  opening?: boolean;
  reduce?: boolean;
  hidden?: boolean;
  navType?: string;
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
  const attrs = new Map<string, string>(options.opening ? [["data-opening", ""]] : []);
  const store = new Map(Object.entries(options.stored ?? {}));
  const windowListeners: { type: string; fn: Listener; capture: boolean }[] = [];
  const documentListeners: { type: string; fn: Listener }[] = [];
  const timers: (() => void)[] = [];
  let now = 1000;
  const guard = <T>(fn: () => T): T => {
    if (options.storageThrows) throw new Error("SecurityError");
    return fn();
  };
  /** A pause button: `closest("[data-still]")` finds the button itself. */
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
    hasAttribute: (name: string) => attrs.has(name),
  };
  const context = {
    document: {
      documentElement,
      visibilityState: options.hidden ? "hidden" : "visible",
      querySelectorAll: (sel: string) => (sel === "[data-still]" ? buttons : []),
      addEventListener: (type: string, fn: Listener) => documentListeners.push({ type, fn }),
    },
    performance: { getEntriesByType: () => [{ type: options.navType ?? "navigate" }] },
    matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" && !!options.reduce }),
    sessionStorage: {
      getItem: (k: string) => guard(() => store.get(k) ?? null),
      setItem: (k: string, v: string) => guard(() => void store.set(k, v)),
      removeItem: (k: string) => guard(() => void store.delete(k)),
    },
    addEventListener: (type: string, fn: Listener, opts?: boolean | { capture?: boolean }) =>
      windowListeners.push({ type, fn, capture: opts === true || (typeof opts === "object" && !!opts.capture) }),
    setTimeout: (fn: () => void) => timers.push(fn),
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
    runTimers: () => timers.splice(0).forEach((fn) => fn()),
    advance: (ms: number) => void (now += ms),
  };
}

describe("boot.js: the opening", () => {
  it("marks every page as scripted, and opens only an edition page, once per session", () => {
    const plain = boot();
    expect([...plain.classes]).toEqual(["js"]);
    expect(plain.store.has("radar:intro")).toBe(false);

    const edition = boot({ opening: true });
    expect(edition.classes.has("js")).toBe(true);
    expect(edition.classes.has("intro")).toBe(true);
    expect(edition.store.get("radar:intro")).toBe("1");

    const again = boot({ opening: true, stored: { "radar:intro": "1" } });
    expect(again.classes.has("intro")).toBe(false);
  });

  it("skips it for reduced motion, a hidden tab, back/forward, and when storage fails", () => {
    for (const options of [{ reduce: true }, { hidden: true }, { navType: "back_forward" }, { storageThrows: true }]) {
      const page = boot({ opening: true, ...options });
      expect(page.classes.has("intro"), JSON.stringify(options)).toBe(false);
      expect(page.classes.has("js"), JSON.stringify(options)).toBe(true);
    }
  });

  it("ends it on its own after 1500 ms", () => {
    const page = boot({ opening: true });
    page.runTimers();
    expect(page.classes.has("intro")).toBe(false);
  });

  it("consumes the press that skips it, and the click that follows, so no link underneath is followed", () => {
    const page = boot({ opening: true });
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
    const page = boot({ opening: true });
    page.fire("touchstart");
    expect(page.classes.has("intro")).toBe(false);
    page.advance(1500);
    const click = page.fire("click");
    expect(click.prevented).toBe(false);
  });

  it("consumes the key that skips it, and leaves later keys alone", () => {
    const page = boot({ opening: true });
    const key = page.fire("keydown");
    expect(key.prevented && key.stopped).toBe(true);
    expect(page.classes.has("intro")).toBe(false);
    const next = page.fire("keydown");
    expect(next.prevented || next.stopped).toBe(false);
    // A key skip leaves no click to swallow.
    expect(page.fire("click").prevented).toBe(false);
  });

  it("does not touch presses on a page without the opening", () => {
    const page = boot();
    for (const type of ["pointerdown", "keydown", "click"]) {
      const e = page.fire(type);
      expect(e.prevented || e.stopped, type).toBe(false);
    }
  });
});

describe("boot.js: the reader's pause", () => {
  it("applies a remembered pause before the first paint", () => {
    expect(boot({ stored: { "radar:still": "1" } }).classes.has("still")).toBe(true);
    expect(boot().classes.has("still")).toBe(false);
    // Storage that throws leaves the motion on and the script running.
    const broken = boot({ storageThrows: true });
    expect(broken.classes.has("still")).toBe(false);
    expect(broken.classes.has("js")).toBe(true);
  });

  it("marks every pause button with the state once the page is parsed", () => {
    const page = boot({ stored: { "radar:still": "1" } });
    page.fire("DOMContentLoaded");
    for (const b of page.buttons) expect(b.attrs.get("aria-pressed")).toBe("true");
  });

  it("toggles the pause from either button, remembers it for the session, and updates both buttons", () => {
    const page = boot();
    page.fire("click", page.buttons[0]);
    expect(page.classes.has("still")).toBe(true);
    expect(page.store.get("radar:still")).toBe("1");
    for (const b of page.buttons) expect(b.attrs.get("aria-pressed")).toBe("true");
    page.fire("click", page.buttons[0]);
    expect(page.classes.has("still")).toBe(false);
    expect(page.store.has("radar:still")).toBe(false);
    for (const b of page.buttons) expect(b.attrs.get("aria-pressed")).toBe("false");
    // Any other click changes nothing.
    page.fire("click");
    expect(page.classes.has("still")).toBe(false);
  });

  it("still toggles when storage fails", () => {
    const page = boot({ storageThrows: true });
    page.fire("click", page.buttons[0]);
    expect(page.classes.has("still")).toBe(true);
  });

  it("keeps no storage but its two session keys", () => {
    expect(source).not.toMatch(/localStorage|cookie/);
    const keys = [...source.matchAll(/"(radar:[a-z]+)"/g)].map((m) => m[1]);
    expect([...new Set(keys)].sort()).toEqual(["radar:intro", "radar:still"]);
  });
});
