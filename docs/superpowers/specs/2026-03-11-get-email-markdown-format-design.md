# get_email Markdown Format — Design Spec

**Status:** Implemented (email-mcp@0.3.0)

## Problem

The `get_email` tool returns both `textBody` and `htmlBody`, consuming excessive tokens. A real-world NYT Cooking newsletter produces ~47K tokens. The `htmlBody` alone is 65KB of template HTML where 75.8% of the converted output is bloated redirect/tracking URLs (up to 597 chars each).

## Goal

Add a `format` parameter to `get_email` that defaults to `"markdown"`, converting HTML email bodies into clean, token-efficient markdown. Target: **~85% reduction** in output size.

## Pipeline

```
Raw HTML
  → sanitize-html (allowlist tags, strip hidden elements + tracking pixels)
  → turndown (HTML → markdown)
  → replace images with [Image: alt] (or remove if no alt)
  → resolve redirect URLs (concurrent HEAD requests, redirect: follow, 5s timeout)
  → strip tracking params from all URLs
  → collapse excessive whitespace
  → clean markdown string
```

### Pipeline Details

**Step 1 — Sanitize (`sanitize-html`)**

Allowed tags: `p`, `br`, `b`, `i`, `em`, `strong`, `a`, `ul`, `ol`, `li`, `h1`–`h6`, `table`, `tr`, `td`, `th`, `thead`, `tbody`, `blockquote`, `pre`, `code`, `hr`, `span`, `div`, `img`.

Allowed attributes: `href` on `<a>`, `src`/`alt`/`width`/`height`/`style` on `<img>` (needed for filtering, not output).

Strip rules:
- `<style>`, `<script>`, MSO conditionals — not in allowlist, removed automatically.
- Tracking pixels: `<img>` with `width <= 1` or `height <= 1` (via `exclusiveFilter`).
- Hidden elements: implemented via `exclusiveFilter` — remove any element whose `style` attribute contains `display:none` or `display: none` combined with at least one of: `height:0`/`height: 0`, `max-height:0`/`max-height: 0`, `overflow:hidden`/`overflow: hidden`, or `opacity:0`/`opacity: 0`. This catches Google Calendar hidden preview spans (`font-size:1px` + `height:0` combos) and similar patterns from other email services.

**Step 2 — Convert to markdown (`turndown`)**

Config: `headingStyle: "atx"`, `bulletListMarker: "-"`.

**Step 3 — Replace images**

Regex replace `![alt](url)` with `[Image: alt]`. Remove `![](url)` (no alt text) entirely. Rationale: AI agents consuming emails cannot render images; the alt text provides sufficient context without burning tokens on CDN URLs.

**Step 4 — Resolve redirect URLs**

Extract all URLs from the markdown output. Fire concurrent `fetch(url, { method: "HEAD", redirect: "follow" })` requests with 5s timeout per URL. Replace original URLs with the final resolved `res.url`. On error or timeout, keep the original URL.

No batching — experiments showed 36 concurrent requests complete in ~2s with no rate limiting from SparkPost/newsletter services. All URLs are followed regardless of domain (no heuristic needed to detect redirects).

Requires Node 18+ for global `fetch` (the project already targets modern Node via ES modules and TypeScript 5.x).

**Step 5 — Strip tracking params**

On all URLs (resolved or original), remove known tracking params using the `URL` API:

`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `campaign_id`, `emc`, `instance_id`, `nl`, `regi_id`, `segment_id`, `user_id`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `__s`, `_hsenc`, `_hsmi`, `mkt_tok`.

All other params are preserved (functional params like Google Calendar's `action`, `eid`, `tok`, `rst`).

Malformed URLs are returned as-is.

**Step 6 — Post-process**

Collapse 3+ consecutive newlines to 2. Trim leading/trailing whitespace.

## Schema Change

Add `format` property to `get_email` tool input:

```typescript
format: {
  type: "string",
  enum: ["markdown", "html", "text"],
  description:
    "Body format to return. 'markdown' (default) converts HTML to clean markdown for token efficiency. 'html' returns raw HTML. 'text' returns plain text only.",
}
```

Update tool description:
```
"Fetch a full email by UID including headers, body, and attachment metadata. Returns body as markdown by default for token efficiency. Use format='html' or format='text' for raw content."
```

## Handler Logic

```typescript
case "get_email": {
  const uid = args.uid as number;
  const format = (args.format as string) || "markdown";
  const email = await imapService.fetchEmail(folder, uid);

  if (format === "markdown") {
    try {
      if (email.htmlBody) {
        email.markdownBody = await htmlToMarkdown(email.htmlBody);
      } else if (email.textBody) {
        email.markdownBody = email.textBody;
      }
      delete email.htmlBody;
      delete email.textBody;
    } catch {
      // Conversion failed — fall back to returning raw bodies unchanged
    }
  } else if (format === "text") {
    delete email.htmlBody;
  } else if (format === "html") {
    delete email.textBody;
  }

  return ok(JSON.stringify(email, null, 2));
}
```

### Output fields by format

| `format` | Body fields returned |
|----------|---------------------|
| `"markdown"` (default) | `markdownBody` only (new field) |
| `"text"` | `textBody` only (existing field) |
| `"html"` | `htmlBody` only (existing field) |

When `format: "markdown"` and the email has neither `htmlBody` nor `textBody`, no body field is returned. If the markdown conversion throws, the handler falls back to returning raw `htmlBody`/`textBody` unchanged.

## Interface Change

Add to `EmailFull` in `ImapService.ts`:

```typescript
markdownBody?: string;
```

## Module

**`packages/email-mcp/src/htmlToMarkdown.ts`**

Exports a single async function:

```typescript
export async function htmlToMarkdown(html: string): Promise<string>
```

Also exports `cleanUrl(url: string): string` for direct testing.

## Dependencies

Add to `packages/email-mcp`:

| Package | Type | Purpose |
|---------|------|---------|
| `sanitize-html` | production | HTML sanitization with allowlist |
| `@types/sanitize-html` | dev | Types |
| `turndown` | production | HTML-to-markdown conversion |
| `@types/turndown` | dev | Types |

## Test Plan

### `src/__tests__/htmlToMarkdown.test.ts` (new)

Mock `global.fetch` to avoid real network calls.

1. Basic HTML conversion — `<p>Hello <strong>world</strong></p>` → `Hello **world**`
2. Strips `<style>` and `<script>` tags
3. Removes tracking pixels — `<img width="1" height="1" src="...">` produces no output
4. Removes hidden preview text — `<div style="display:none;max-height:0;overflow:hidden">...</div>` removed
5. Removes Google Calendar hidden spans — `<span style="display:none;font-size:1px;height:0;max-height:0;overflow:hidden">...</span>` removed
6. Replaces images with `[Image: alt]`
7. Removes images with no alt text entirely
8. Resolves redirect URLs — mock fetch returning different `res.url`, verify replacement
9. Falls back to original URL on fetch error/timeout
10. Strips tracking params from resolved URLs (`utm_*`, `campaign_id`, etc.)
11. Preserves functional URL params (`action`, `eid`, `tok`, `rst`)
12. Collapses 3+ blank lines to 2
13. Headings, lists, links convert correctly
14. `cleanUrl` unit tests — each tracking param family stripped, non-tracking preserved, malformed URLs returned as-is
15. Integration test with `docs/nyt-example.html` fixture — copy into `src/__tests__/__fixtures__/nyt-example.html`, load with `path.resolve(__dirname, "__fixtures__/nyt-example.html")`, mock fetch, verify output is clean and dramatically smaller

### `src/__tests__/emailTools.test.ts` (updates)

1. `get_email` schema includes `format` property with correct enum values
2. Default format (no `format` arg) returns `markdownBody`, no `htmlBody`/`textBody`
3. `format: "html"` returns `htmlBody`, no `textBody`
4. `format: "text"` returns `textBody`, no `htmlBody`
5. Text-only email with `format: "markdown"` returns `textBody` as `markdownBody`
6. Conversion failure falls back to raw bodies unchanged

## Files Changed

| File | Action |
|------|--------|
| `packages/email-mcp/package.json` | Add 4 dependencies |
| `packages/email-mcp/src/htmlToMarkdown.ts` | New — pipeline module |
| `packages/email-mcp/src/services/ImapService.ts` | Add `markdownBody?` to `EmailFull` |
| `packages/email-mcp/src/tools/emailTools.ts` | Update schema, description, handler |
| `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts` | New — unit + integration tests |
| `packages/email-mcp/src/__tests__/emailTools.test.ts` | Add format parameter tests |
| `docs/nyt-example.html` | Source fixture (already exists) |
| `packages/email-mcp/src/__tests__/__fixtures__/nyt-example.html` | Test fixture (copy from docs/) |

## Experimental Data

Tested against a real NYT Cooking newsletter email (65KB HTML, 47K tokens):

- Raw Turndown alone: 42% size reduction (still 37KB, 75.8% of which is URLs)
- Redirect resolution (all concurrent, no batching): 72.5% URL size reduction, ~2s latency for 36 URLs
- Full pipeline estimate: 65KB → ~8-9KB (~85% reduction)
- No rate limiting observed from SparkPost at any concurrency level tested (10, 20, 36)

Also tested against a Google Calendar invitation email (12KB HTML):
- Expected ~20x token reduction
- Functional Google Calendar params (`action`, `eid`, `tok`, `rst`) preserved correctly
