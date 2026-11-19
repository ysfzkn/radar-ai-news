# Sources

Radar reads the sources listed in [`sources.yaml`](../sources.yaml). That file is the whole registry: adding, removing or re-tiering a source never needs a code change.

## Tiers

Every source belongs to one of four tiers. The tier says what the source is trusted for.

| Tier | Name | What it is for |
| --- | --- | --- |
| 1 | **Primary** | The original announcement: vendor blogs, research labs, and GitHub release feeds of the projects themselves. A story needs one of these to run on its own. |
| 2 | **Community signal** | Hacker News, Reddit and similar. These tell us what developers are talking about. They are a signal that something matters, never the story's text. |
| 3 | **Expert commentary** | Individual practitioners and specialist newsletters. Useful for context, and for catching what the primary feeds missed. |
| 4 | **Türkiye** | Turkish-language outlets. They keep the Turkish edition grounded in what local developers are reading, and are marked `lang: tr`. |

## Rules

1. **A primary source is required.** Community buzz is not a story. If a candidate has no primary source, a human decides whether it runs.
2. **Summarizers are cross-checks only.** Newsletters and commentary are used to check what Radar missed. Their text is never rewritten or republished.
3. **The registry is a file.** Everything about where Radar reads from is in `sources.yaml`, in version control, open to review.

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique, stable, lower-case identifier. Duplicates are rejected. |
| `name` | yes | Display name. |
| `tier` | yes | One of `primary`, `community`, `commentary`, `turkey`. |
| `kind` | yes | `feed` (RSS or Atom) or `hn` (Hacker News Algolia search API). |
| `url` | yes | An `http://` or `https://` URL. |
| `weight` | no | Ranking multiplier. Default `1.0`. |
| `lang` | no | `en` (default) or `tr`. |
| `enabled` | no | Set to `false` to keep an entry on file without fetching it. Default `true`. |

```yaml
- id: github-blog
  name: GitHub Blog
  tier: primary
  kind: feed
  url: https://github.blog/feed/
```

## Suggest a source

Open a **Source suggestion** issue, or send a pull request that edits `sources.yaml`. Turkish sources are especially welcome.
