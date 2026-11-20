import { describe, expect, it } from "vitest";
import { INK_STEPS, inkTokens } from "../src/lib/reading";

describe("inkTokens", () => {
  it("cuts a line into words and the space between them, and gives the text back unchanged", () => {
    for (const text of [
      "Geliştiriciler için ilk kez yerel bir model.",
      "  leading and trailing  ",
      "<script>alert(1)</script> & \"quotes\"",
      "tek",
      "",
      "a b\tc\nd",
    ]) {
      const tokens = inkTokens(text);
      expect(tokens.map((t) => t.text).join(""), JSON.stringify(text)).toBe(text);
      for (const token of tokens) expect(token.word).toBe(/\S/.test(token.text));
    }
  });

  it("numbers the words in order and stops counting at the last step", () => {
    const words = inkTokens(Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ")).filter((t) => t.word);
    expect(words).toHaveLength(50);
    expect(words.slice(0, 3).map((t) => t.step)).toEqual([0, 1, 2]);
    expect(Math.max(...words.map((t) => t.step))).toBe(INK_STEPS - 1);
    expect(words.at(-1)!.step).toBe(INK_STEPS - 1);
  });
});
