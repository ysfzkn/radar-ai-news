import { z } from "zod";

export const INGEST_LIMITS = { title: 300, summary: 1000, dev_line: 600 } as const;
export const PUBLISH_LIMITS = { title: 90, summary: 320, dev_line: 200 } as const;
export const MAX_BODY_BYTES = 256 * 1024;
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
export const RISK_FLAGS = [
  "security_incident",
  "accusation",
  "funding_figure",
  "third_party_benchmark",
  "regulation",
] as const;

export type Status = "review" | "published" | "rejected" | "expired";
export type Lang = "tr" | "en";

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const url = z
  .string()
  .max(2000)
  .refine(isHttpUrl, { message: "must be an http(s) URL" });

const shortList = z.array(z.string().max(200)).max(30);
const score05 = z.number().int().min(0).max(5);

// Parsed with the clock at validation time, which is what "not in the future" means.
const createdAt = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms > Date.now() + MAX_FUTURE_MS) {
    ctx.addIssue({ code: "custom", message: "invalid or too far in the future" });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

const text = z.strictObject({
  title: z.string().min(1).max(INGEST_LIMITS.title),
  summary: z.string().min(1).max(INGEST_LIMITS.summary),
  dev_line: z.string().min(1).max(INGEST_LIMITS.dev_line),
});

const story = z.strictObject({
  uid: z.string().regex(/^[0-9a-f]{32}$/),
  category: z.enum(CATEGORIES),
  status: z.enum(["review", "published"]),
  reasons: z.array(z.string().max(300)).max(20),
  score: z.strictObject({
    relevance: score05,
    novelty: score05,
    usefulness: score05,
    total: z.number().min(0).max(5),
    risk_flags: z.array(z.enum(RISK_FLAGS)),
  }),
  fact_card: z.strictObject({
    what: z.string().max(1000),
    who: shortList,
    numbers: shortList,
    versions: shortList,
    try_url: url.nullable(),
  }),
  source_url: url,
  source_count: z.number().int().min(0),
  sources: z
    .array(z.strictObject({ name: z.string().max(100), url, tier: z.number().int().min(1).max(4) }))
    .min(1)
    .max(30),
  created_at: createdAt,
  texts: z.strictObject({ tr: text, en: text }),
});

export const ingestRequest = z.strictObject({
  version: z.literal(1),
  stories: z.array(story).min(1).max(20),
});

export type IngestRequest = z.output<typeof ingestRequest>;
export type IngestStory = IngestRequest["stories"][number];
