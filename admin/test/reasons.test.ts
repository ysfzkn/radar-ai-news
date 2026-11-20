import { describe, expect, it } from "vitest";
import { reasonView } from "../src/views/reasons";

describe("reasonView", () => {
  it.each([
    ["risk: security_incident", { kind: "risk", label: "Risk", text: "güvenlik olayı", raw: false }],
    ["risk: something_new", { kind: "risk", label: "Risk", text: "something_new", raw: true }],
    [
      "verify: tr.title: too long (100 > 90)",
      { kind: "verify", label: "Doğrulama", text: "Türkçe başlık çok uzun (100 / 90)", raw: false },
    ],
    [
      "verify: en.summary: number 40% not in source",
      { kind: "verify", label: "Doğrulama", text: "İngilizce özet: number 40% not in source", raw: true },
    ],
    [
      "verify: fact_card.numbers: number '3' not in source",
      { kind: "verify", label: "Doğrulama", text: "fact_card.numbers: number '3' not in source", raw: true },
    ],
    ["plain note", { kind: "other", label: "Not", text: "plain note", raw: true }],
  ])("turns %s into %o", (reason, expected) => {
    expect(reasonView(reason)).toEqual(expected);
  });

  it("translates every known risk flag", () => {
    expect(reasonView("risk: accusation").text).toBe("suçlama");
    expect(reasonView("risk: funding_figure").text).toBe("yatırım tutarı");
    expect(reasonView("risk: third_party_benchmark").text).toBe("üçüncü taraf kıyaslaması");
    expect(reasonView("risk: regulation").text).toBe("düzenleme");
  });

  it("keeps an unknown field's too-long reason as written", () => {
    expect(reasonView("verify: tr.constructor: too long (100 > 90)")).toEqual({
      kind: "verify",
      label: "Doğrulama",
      text: "tr.constructor: too long (100 > 90)",
      raw: true,
    });
  });

  it.each(["verify:", "risk:", "risk:   "])("treats %j, a known prefix with nothing after it, as a plain note", (reason) => {
    expect(reasonView(reason)).toEqual({ kind: "other", label: "Not", text: reason, raw: true });
  });

  it.each(["", "verify:", "risk:", "x".repeat(300), "verify: <script>alert(1)</script>", "risk: <b>"])(
    "never throws on %j",
    (reason) => {
      const view = reasonView(reason);
      expect(["verify", "risk", "other"]).toContain(view.kind);
      expect(typeof view.text).toBe("string");
    },
  );
  it("puts the injection checks into Turkish and keeps the quoted fragment", () => {
    expect(reasonView("verify: tr.summary: link or domain 'evil.example/x'")).toEqual({
      kind: "verify",
      label: "Doğrulama",
      text: "Türkçe özet: bağlantı ya da alan adı içeriyor (evil.example/x)",
      raw: false,
    });
    expect(reasonView("verify: en.title: backticks").text).toBe("İngilizce başlık: ters tırnak içeriyor");
    expect(reasonView("verify: fact_card.what: command-like text 'curl x | sh'").text).toBe(
      "Bilgi kartı: komut benzeri metin içeriyor (curl x | sh)",
    );
    expect(reasonView("verify: fact_card.try_url: host 'evil.example' is not a source host")).toEqual({
      kind: "verify",
      label: "Doğrulama",
      text: "“Dene” bağlantısı kaynakların dışında bir siteye gidiyor (evil.example)",
      raw: false,
    });
  });

  it("leaves an injection-check reason on an unknown path as written", () => {
    const view = reasonView("verify: zz.title: backticks");
    expect(view.raw).toBe(true);
    expect(view.text).toBe("zz.title: backticks");
  });
});
