import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/lib/schema";
import type { Category } from "../src/lib/schema";
import {
  arrowStep,
  categoryOf,
  fill,
  fold,
  highlight,
  readQuery,
  safeHref,
  search,
  writeQuery,
  type SearchDoc,
  type SearchQuery,
} from "../src/lib/search";

const doc = (over: Partial<SearchDoc>): SearchDoc => ({
  u: "/2026-11-20/#s-00000000",
  d: "2026-11-20",
  c: "model",
  n: 1,
  t: "Title",
  s: "Summary",
  ...over,
});

const none: SearchQuery = { q: "", category: null, month: null, minEcho: 0 };

describe("fold", () => {
  it("makes ISTANBUL, istanbul, İstanbul and ıstanbul the same", () => {
    for (const word of ["ISTANBUL", "istanbul", "İstanbul", "ıstanbul", "İSTANBUL"]) {
      expect(fold(word), word).toBe("istanbul");
    }
  });

  it("maps the Turkish letters and circumflexed vowels to plain ones", () => {
    expect(fold("şifre")).toBe("sifre");
    expect(fold("ŞİFRE")).toBe("sifre");
    expect(fold("ğüöçıâîû")).toBe("guociaiu");
    expect(fold("Kâğıt")).toBe("kagit");
  });

  it("strips other combining marks", () => {
    expect(fold("café")).toBe("cafe");
    expect(fold("e\u0301")).toBe("e");
  });
});

describe("search", () => {
  const docs = [
    doc({ u: "a", d: "2026-11-18", t: "Bir şifre sızıntısı", s: "İstanbul merkezli" }),
    doc({ u: "b", d: "2026-11-19", t: "Başka", s: "şifre ve İSTANBUL" }),
    doc({ u: "c", d: "2026-10-02", c: "security", n: 5, t: "ŞİFRE kasası", s: "ıstanbul" }),
    doc({ u: "d", d: "2026-11-20", t: "Alakasız", s: "Hiçbiri" }),
  ];

  it("returns nothing for an empty query with no filter", () => {
    expect(search(docs, none)).toEqual([]);
    expect(search(docs, { ...none, q: "   " })).toEqual([]);
  });

  it("finds the same stories for every spelling of a word", () => {
    const spellings = ["ISTANBUL", "istanbul", "İstanbul", "ıstanbul"].map((q) =>
      search(docs, { ...none, q }).map((d) => d.u),
    );
    for (const found of spellings) expect(found).toEqual(spellings[0]);
    expect(spellings[0].sort()).toEqual(["a", "b", "c"]);
    expect(search(docs, { ...none, q: "sifre" }).map((d) => d.u)).toHaveLength(3);
  });

  it("needs every term, in the title or the summary", () => {
    expect(search(docs, { ...none, q: "sifre istanbul" }).map((d) => d.u).sort()).toEqual(["a", "b", "c"]);
    expect(search(docs, { ...none, q: "sifre hiçbiri" })).toEqual([]);
  });

  it("puts title hits before summary-only hits, then newest first", () => {
    expect(search(docs, { ...none, q: "sifre" }).map((d) => d.u)).toEqual(["a", "c", "b"]);
    expect(search(docs, { ...none, category: "model" }).map((d) => d.u)).toEqual(["d", "b", "a"]);
  });

  it("ANDs the filters with the text", () => {
    expect(search(docs, { ...none, q: "sifre", category: "security" }).map((d) => d.u)).toEqual(["c"]);
    expect(search(docs, { ...none, q: "sifre", month: "2026-11" }).map((d) => d.u)).toEqual(["a", "b"]);
    expect(search(docs, { ...none, q: "sifre", minEcho: 3 }).map((d) => d.u)).toEqual(["c"]);
    expect(search(docs, { ...none, month: "2026-10" }).map((d) => d.u)).toEqual(["c"]);
  });
});

describe("readQuery and writeQuery", () => {
  it("round-trips in both languages with each language's parameter names", () => {
    const query: SearchQuery = { q: "şifre sızıntı", category: "security", month: "2026-11", minEcho: 3 };
    const tr = writeQuery(query, "tr");
    expect(tr).toBe("?q=%C5%9Fifre+s%C4%B1z%C4%B1nt%C4%B1&konu=security&ay=2026-11&yanki=3");
    expect(readQuery(new URLSearchParams(tr), "tr")).toEqual(query);
    const en = writeQuery(query, "en");
    expect(en).toContain("topic=security&month=2026-11&echo=3");
    expect(readQuery(new URLSearchParams(en), "en")).toEqual(query);
  });

  it("writes an empty string for an empty state", () => {
    expect(writeQuery(none, "tr")).toBe("");
    expect(writeQuery({ ...none, q: "  " }, "en")).toBe("");
  });

  it("ignores unknown values and the other language's names", () => {
    const params = new URLSearchParams("konu=weather&ay=2026-13&yanki=9&q=x");
    expect(readQuery(params, "tr")).toEqual({ q: "x", category: null, month: null, minEcho: 0 });
    expect(readQuery(new URLSearchParams("topic=model"), "tr").category).toBeNull();
    expect(readQuery(new URLSearchParams("ay=abc&yanki=0"), "tr")).toEqual(none);
  });

  it("knows the same categories as the schema", () => {
    for (const category of CATEGORIES) {
      expect(readQuery(new URLSearchParams(`topic=${category}`), "en").category).toBe(category);
    }
  });
});

// Carried over from the review of Tasks 1 and 2.
describe("readQuery against the controls the page offers", () => {
  it("ignores a month the select does not offer and an echo value other than 3", () => {
    const months = ["2026-11", "2026-10"];
    expect(readQuery(new URLSearchParams("ay=2026-11"), "tr", months).month).toBe("2026-11");
    expect(readQuery(new URLSearchParams("ay=2026-09"), "tr", months).month).toBeNull();
    expect(readQuery(new URLSearchParams("month=2025-01"), "en", months).month).toBeNull();
    expect(readQuery(new URLSearchParams("yanki=3"), "tr", months).minEcho).toBe(3);
    for (const value of ["1", "2", "4", "5", "03", "3.0"]) {
      expect(readQuery(new URLSearchParams(`yanki=${value}`), "tr", months).minEcho, value).toBe(0);
    }
  });
});

describe("safeHref", () => {
  it("links only same-site paths: a slash followed by anything but a slash or a backslash", () => {
    expect(safeHref("/2026-11-20/#s-1a2b3c4d")).toBe("/2026-11-20/#s-1a2b3c4d");
    expect(safeHref("/en/2026-11-20/#s-1")).toBe("/en/2026-11-20/#s-1");
    for (const bad of ["//evil.example", "/\\evil.example", "/\\/x", "https://evil.example/", "javascript:alert(1)", "", "/", "x/y", " /a"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("arrowStep", () => {
  const key = (k: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });
  it("moves by one for the arrow keys", () => {
    expect(arrowStep(key("ArrowRight"))).toBe(1);
    expect(arrowStep(key("ArrowDown"))).toBe(1);
    expect(arrowStep(key("ArrowLeft"))).toBe(-1);
    expect(arrowStep(key("ArrowUp"))).toBe(-1);
    expect(arrowStep(key("a"))).toBe(0);
  });
  it("ignores a press with Alt, Ctrl or Meta held", () => {
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(arrowStep(key("ArrowLeft", { [mod]: true })), mod).toBe(0);
      expect(arrowStep(key("ArrowRight", { [mod]: true })), mod).toBe(0);
    }
  });
});

describe("categoryOf", () => {
  it("passes a known category and refuses anything else", () => {
    for (const category of CATEGORIES) expect(categoryOf(category)).toBe(category);
    for (const bad of ["weather", "model x", "model\"", "", "__proto__", "constructor", 3, null, undefined]) {
      expect(categoryOf(bad), String(bad)).toBeNull();
    }
  });
});

describe("fill", () => {
  it("puts the number where {n} stands", () => {
    expect(fill("{n} kaynak", 7)).toBe("7 kaynak");
    expect(fill("İlk {n} sonuç gösteriliyor.", 100)).toBe("İlk 100 sonuç gösteriliyor.");
    expect(fill("no number", 2)).toBe("no number");
  });
});

describe("search by the category's name", () => {
  const names = { security: "Güvenlik", model: "Model" } as Partial<Record<Category, string>>;
  const docs = [
    doc({ u: "m", d: "2026-11-20", c: "model", t: "Güvenlik açığı kapandı", s: "x" }),
    doc({ u: "s1", d: "2026-11-19", c: "security", t: "Bir sızıntı", s: "y" }),
    doc({ u: "s2", d: "2026-11-18", c: "security", t: "Başka", s: "z" }),
  ];
  it("finds stories of a category by its name in the current language, title hits first", () => {
    expect(search(docs, { ...none, q: "güvenlik" }, names).map((d) => d.u)).toEqual(["m", "s1", "s2"]);
    expect(search(docs, { ...none, q: "GUVENLIK" }, names).map((d) => d.u)).toEqual(["m", "s1", "s2"]);
    expect(search(docs, { ...none, q: "güvenlik sızıntı" }, names).map((d) => d.u)).toEqual(["s1"]);
    // Without names the category is not searched.
    expect(search(docs, { ...none, q: "güvenlik" }).map((d) => d.u)).toEqual(["m"]);
  });
});

describe("highlight", () => {
  const join = (parts: { text: string; hit: boolean }[]) => parts.map((p) => p.text).join("");
  it("keeps the text identical and marks every folded match", () => {
    const text = "İstanbul'da şifre: ISTANBUL ve ıstanbul";
    const parts = highlight(text, "istanbul sifre");
    expect(join(parts)).toBe(text);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["İstanbul", "şifre", "ISTANBUL", "ıstanbul"]);
  });
  it("merges overlapping matches and copes with markup in the text", () => {
    const text = "<script>alert(1)</script> café";
    const parts = highlight(text, "scri cript cafe");
    expect(join(parts)).toBe(text);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["script", "script", "café"]);
  });
  it("returns the text as one plain part when nothing matches or the query is empty", () => {
    expect(highlight("Başlık", "")).toEqual([{ text: "Başlık", hit: false }]);
    expect(highlight("Başlık", "yok")).toEqual([{ text: "Başlık", hit: false }]);
    expect(highlight("", "x")).toEqual([]);
  });
});
