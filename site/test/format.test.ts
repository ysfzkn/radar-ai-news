import { describe, expect, it } from "vitest";
import { hostLabel, httpUrl, longDate, shortDate } from "../src/lib/format";

describe("dates", () => {
  it("formats 2026-11-20 as `20 Kasım 2026 Cuma` and `Friday, 20 November 2026`", () => {
    expect(longDate("2026-11-20", "tr")).toBe("20 Kasım 2026 Cuma");
    expect(longDate("2026-11-20", "en")).toBe("Friday, 20 November 2026");
  });

  it("formats short dates", () => {
    expect(shortDate("2026-11-20", "tr")).toBe("20 Kas");
    expect(shortDate("2026-11-20", "en")).toBe("20 Nov");
  });

  it("names a Sunday and a leap day correctly", () => {
    expect(longDate("2026-11-22", "en")).toBe("Sunday, 22 November 2026");
    expect(longDate("2028-02-29", "tr")).toBe("29 Şubat 2028 Salı");
  });
});

describe("hostLabel", () => {
  it("strips www and the path, and is empty for a non-URL", () => {
    expect(hostLabel("https://www.a2ui.org/x")).toBe("a2ui.org");
    expect(hostLabel("www.a2ui.org/x")).toBe("a2ui.org");
    expect(hostLabel("https://example.com:8080/a?b=1")).toBe("example.com");
    expect(hostLabel("not a url")).toBe("");
    expect(hostLabel("")).toBe("");
  });
});

describe("httpUrl", () => {
  it("returns null for javascript:, data:, a relative path and null", () => {
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,x")).toBeNull();
    expect(httpUrl("/relative/path")).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });

  it("returns an http(s) url unchanged", () => {
    expect(httpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(httpUrl("http://example.com")).toBe("http://example.com");
  });
});
