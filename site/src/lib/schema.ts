import { z } from "zod";

export const CATEGORIES = [
  "protocol",
  "model",
  "framework",
  "tooling",
  "research",
  "security",
  "industry",
  "policy",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Lang = "tr" | "en";

export interface StoryText {
  title: string;
  summary: string;
  dev_line: string;
}

export interface Source {
  name: string;
  url: string;
}

export interface PublicStory {
  uid: string;
  category: Category;
  publish_mode: "auto" | "human";
  edited: boolean;
  source_count: number;
  source_url: string;
  sources: Source[];
  try_url: string | null;
  created_at: string;
  published_at: string;
  texts: Partial<Record<Lang, StoryText>>;
}

/** A URL that may end up in an href: absolute and http(s) only. */
const httpUrl = z.string().refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "must be an http(s) URL");

const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a timestamp");

const nonEmpty = z.string().min(1);

const storyText = z.strictObject({
  title: nonEmpty,
  summary: nonEmpty,
  dev_line: nonEmpty,
});

const story = z.strictObject({
  uid: z.string().regex(/^[0-9a-f]{32}$/),
  category: z.enum(CATEGORIES),
  publish_mode: z.enum(["auto", "human"]),
  edited: z.boolean(),
  source_count: z.number().int().positive(),
  source_url: httpUrl,
  sources: z.array(z.strictObject({ name: nonEmpty, url: httpUrl })),
  try_url: httpUrl.nullable(),
  created_at: timestamp,
  published_at: timestamp,
  texts: z
    .strictObject({ tr: storyText.optional(), en: storyText.optional() })
    .refine((texts) => texts.tr !== undefined || texts.en !== undefined, "needs tr or en"),
});

const stories = z.array(story).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((item, index) => {
    if (seen.has(item.uid)) {
      ctx.addIssue({ code: "custom", message: "duplicate uid", path: [index, "uid"] });
    }
    seen.add(item.uid);
  });
});

/** Validates the public read contract; throws on anything outside it. */
export function parseStories(input: unknown): PublicStory[] {
  return stories.parse(input) as PublicStory[];
}
