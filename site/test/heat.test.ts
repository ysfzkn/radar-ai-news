import { describe, expect, it } from "vitest";
import { heatTarget } from "../src/lib/heat";

const key = (k: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

// The heat strip's days with an edition, oldest first (index 0) to newest (count - 1).
describe("heatTarget", () => {
  it("moves to the next newer day with Right or Down, and the next older with Left or Up", () => {
    expect(heatTarget(key("ArrowRight"), 1, 4)).toBe(2);
    expect(heatTarget(key("ArrowDown"), 1, 4)).toBe(2);
    expect(heatTarget(key("ArrowLeft"), 1, 4)).toBe(0);
    expect(heatTarget(key("ArrowUp"), 1, 4)).toBe(0);
  });

  it("stops at either end instead of wrapping round", () => {
    expect(heatTarget(key("ArrowRight"), 3, 4)).toBe(3);
    expect(heatTarget(key("ArrowLeft"), 0, 4)).toBe(0);
  });

  it("goes to the oldest with Home and the newest with End", () => {
    expect(heatTarget(key("Home"), 2, 4)).toBe(0);
    expect(heatTarget(key("End"), 0, 4)).toBe(3);
  });

  it("leaves every other key, and any press with Alt, Ctrl or Meta, to the browser", () => {
    for (const k of ["Tab", "Enter", " ", "a", "PageDown"]) expect(heatTarget(key(k), 1, 4), k).toBeNull();
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(heatTarget(key("ArrowLeft", { [mod]: true }), 1, 4), mod).toBeNull();
      expect(heatTarget(key("End", { [mod]: true }), 1, 4), mod).toBeNull();
    }
  });

  it("does nothing on an empty strip", () => {
    expect(heatTarget(key("ArrowRight"), 0, 0)).toBeNull();
  });
});
