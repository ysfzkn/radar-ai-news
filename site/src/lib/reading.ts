// Pure helpers for scripts/reading.ts: no DOM.

/** Words after this many ink in together, so a long line takes no longer than a short one. */
export const INK_STEPS = 28;

/** One piece of a line: a word (with its step in the ink-in) or the space after it. */
export interface InkToken {
  text: string;
  word: boolean;
  /** 0 for the first word, counting up to INK_STEPS - 1; 0 for a space. */
  step: number;
}

/** A line cut into words and spaces; joined, the pieces give the line back unchanged. */
export function inkTokens(text: string): InkToken[] {
  let i = 0;
  return (text.match(/\s+|\S+/g) ?? []).map((piece) => {
    const word = /\S/.test(piece);
    return { text: piece, word, step: word ? Math.min(i++, INK_STEPS - 1) : 0 };
  });
}
