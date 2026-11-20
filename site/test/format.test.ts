import { describe, expect, it } from "vitest";
import {
  dayMonth,
  hostLabel,
  httpUrl,
  longDate,
  shortDate,
  weekdayName,
  weekHeading,
  yearOf,
} from "../src/lib/format";

describe("dates", () => {
  it("formats 2026-11-20 as `20 Kasım 2026 Cuma` and `Friday, 20 November 2026`", () => {
    expect(longDate("2026-11-20", "tr")).toBe("20 Kasım 2026 Cuma");
    expect(longDate("2026-11-20", "en")).toBe("Friday, 20 November 2026");
  });

  it("formats short dates", () => {
    expect(shortDate("2026-11-20", "tr")).toBe("20 Kas");
    expect(shortDate("2026-11-20", "en")).toBe("20 Nov");
  });

  it("splits a date into day and month, weekday and year for the edition masthead", () => {
    expect(dayMonth("2026-11-20", "tr")).toBe("20 Kasım");
    expect(dayMonth("2026-11-20", "en")).toBe("20 November");
    expect(weekdayName("2026-11-20", "tr")).toBe("Cuma");
    expect(weekdayName("2026-09-30", "en")).toBe("Wednesday");
    expect(yearOf("2026-11-20")).toBe("2026");
  });

  it("names a Sunday and a leap day correctly", () => {
    expect(longDate("2026-11-22", "en")).toBe("Sunday, 22 November 2026");
    expect(longDate("2028-02-29", "tr")).toBe("29 Şubat 2028 Salı");
  });
});

describe("weekHeading", () => {
  it("names a week inside one month as `47. hafta · 16–22 Kasım 2026` and `Week 47 · 16–22 November 2026`", () => {
    expect(weekHeading("2026-W47", "2026-11-16", "2026-11-22", "tr")).toBe("47. hafta · 16–22 Kasım 2026");
    expect(weekHeading("2026-W47", "2026-11-16", "2026-11-22", "en")).toBe(
      "Week 47 · 16–22 November 2026",
    );
  });

  it("writes both ends in full when the week spans two months or two years", () => {
    expect(weekHeading("2026-W49", "2026-11-30", "2026-12-06", "tr")).toBe(
      "49. hafta · 30 Kasım 2026 – 6 Aralık 2026",
    );
    expect(weekHeading("2026-W53", "2026-12-28", "2027-01-03", "tr")).toBe(
      "53. hafta · 28 Aralık 2026 – 3 Ocak 2027",
    );
    expect(weekHeading("2026-W53", "2026-12-28", "2027-01-03", "en")).toBe(
      "Week 53 · 28 December 2026 – 3 January 2027",
    );
  });

  it("drops the leading zero of a single-digit week", () => {
    expect(weekHeading("2027-W05", "2027-02-01", "2027-02-07", "en")).toBe("Week 5 · 1–7 February 2027");
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
