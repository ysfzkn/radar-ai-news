import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/lib/schema";
import { fold, readQuery, search, writeQuery, type SearchDoc, type SearchQuery } from "../src/lib/search";

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
