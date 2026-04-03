# URL Resolution & Tracking Parameter Cleanup — Design Spec

**Date:** April 2, 2026
**Status:** Draft
**Scope:** `@miguelarios/email-mcp` — Fix click-tracker URL resolution, replace hand-rolled param stripping with community-maintained filter lists
**Changes:** 2 behavioral changes in `htmlToMarkdown.ts`, 1 new dependency, 1 lifecycle recommendation

---

## Problem

The `fetchOne()` function in `htmlToMarkdown.ts` uses `method: "HEAD"` to resolve redirect URLs. Klaviyo's click tracker (`ctrk.klclick.com`) returns **404 for HEAD but 302 for GET**, so all Klaviyo links fail to resolve and remain as opaque `klclick.com/l/...` URLs in the markdown output. This was confirmed live against the Stealth Health newsletter — all 10 URLs returned 404 on HEAD, resolved correctly on GET.

Separately, the hand-maintained `TRACKING_PARAMS` Set (27 params) misses common tracking parameters like `_kx` (Klaviyo), `srsltid` (Google Ads), and `_ke` (Klaviyo alt). Adding them one-by-one is unsustainable — the tracking ecosystem evolves faster than a static list can follow.

---

## Design Principles

**GET is the honest choice.** The MCP's purpose is to resolve links so agents can act on them — download PDFs, fetch page content. The click will happen anyway when the agent follows through. HEAD was a politeness optimization that breaks on the most common failure case (click trackers).

**Community-maintained > hand-maintained.** uBlock Origin and AdGuard filter lists are maintained by millions of users reporting tracking parameters. A library that consumes these lists will always have better coverage than a hand-curated Set.

**Privacy by default.** Resolved URLs contain subscriber identity tokens (`_kx`, `mc_eid`, `srsltid`) that tie back to the user's email address. Stripping these is a privacy requirement, not a nice-to-have.

---

## Changes Summary

| Change | Area | Type |
|--------|------|------|
| Switch `fetchOne` from HEAD to GET | URL resolution | Behavioral |
| Replace `TRACKING_PARAMS` + `cleanUrl` with `@backrunner/url-cleaner` | Param stripping | Dependency swap |
| Add supplemental param list for library gaps | Param stripping | Supplemental |
| Recommend `keep-alive` lifecycle in MCPorter | Deployment | Configuration |

---

## Change 1: Switch `fetchOne` from HEAD to GET

### Current State

`fetchOne()` uses `method: "HEAD"` with `redirect: "follow"`. Click trackers that don't implement HEAD (Klaviyo, some Mailchimp/SendGrid endpoints) return 404, so the URL is kept as the opaque tracking URL.

### New Behavior

Use `method: "GET"` with `redirect: "follow"`. After reading `res.url` (the final resolved URL), abort the request via the existing `AbortController` — `fetch()` with GET doesn't download the body unless you call `.text()`/`.json()`, so grabbing `res.url` and aborting is effectively the same cost as HEAD.

### Implementation

```typescript
// In fetchOne(), change:
const res = await fetch(url, {
  method: "GET",  // was "HEAD"
  redirect: "follow",
  signal: controller.signal,
});
const resolved = res.url;
controller.abort(); // don't download body
```

Update the log line from `HEAD ${url}` to `RESOLVE ${url}`.

### Why Not HEAD-then-GET Fallback?

- Doubles request count for the most common failure case (click trackers)
- Added code complexity for no benefit — GET works universally
- The "polite" argument for HEAD doesn't hold when the agent will follow the resolved URL anyway

---

## Change 2: Replace `cleanUrl` with `@backrunner/url-cleaner`

### Current State

A hand-maintained `TRACKING_PARAMS` Set (27 entries) and `cleanUrl()` function strip known tracking parameters from URLs. Coverage gaps include Klaviyo (`_kx`, `_ke`), Google Ads (`srsltid`), and Snapchat (`sc_cid`).

### New Behavior

Use `@backrunner/url-cleaner`, which loads uBlock Origin + AdGuard community-maintained filter lists. Supplement with a small local list for params the library misses.

### Library Evaluation

Two libraries were evaluated against real resolved Klaviyo URLs:

| Metric | `@protontech/tidy-url` | `@backrunner/url-cleaner` |
|--------|------------------------|---------------------------|
| Rule source | 84+ manually curated rules | uBlock Origin + AdGuard filter lists |
| Cold start (import + init + first clean) | ~35ms | ~381ms |
| 40 URLs (warm) | ~15ms | ~6ms |
| Klaviyo `_kx` | Miss | Hit |
| `srsltid` (Google Ads) | Miss | Hit |
| `mc_eid` (Mailchimp) | Hit | Hit |
| `fbclid` / `gclid` | Hit | Hit |
| `_hsenc` (HubSpot) | Hit | Hit |
| `mkt_tok` (Marketo) | Hit | Hit |
| `__s` (Drip) | Hit | Hit |
| Dependencies | 0 | 2 |

**Choice: `@backrunner/url-cleaner`** — better coverage on the params that matter most (Klaviyo, Google Ads), faster per-URL when warm. The cold start penalty is mitigated by keep-alive lifecycle (see Change 4).

### Verified Against Real Klaviyo Resolved URLs

- `cdn.shopify.com/...Chili_Cheese_Pasta.pdf?v=1773944942&_kx=...` → stripped `_kx`, kept `v=` 
- `stealthhealthcontainers.com/?srsltid=...&_kx=...` → stripped both
- `instagram.com/stealth_health_life/?_kx=...` → stripped `_kx`

### Supplemental Param List

Params missed by both libraries, maintained as a small local array:

```typescript
const SUPPLEMENTAL_TRACKING_PARAMS = ["_ke", "sc_cid"];
```

Applied after `url-cleaner` runs, using the same URL SearchParams approach as the current `cleanUrl`.

### Implementation

```typescript
import { URLCleaner } from "@backrunner/url-cleaner";

// Lazy-init singleton — constructed on first call, reused thereafter
let cleanerInstance: URLCleaner | null = null;

function getCleaner(): URLCleaner {
  if (!cleanerInstance) {
    cleanerInstance = new URLCleaner();
  }
  return cleanerInstance;
}

// Supplemental params not covered by uBlock/AdGuard lists
const SUPPLEMENTAL_TRACKING_PARAMS = ["_ke", "sc_cid"];

function stripSupplementalParams(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    let removed = false;
    for (const key of SUPPLEMENTAL_TRACKING_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        removed = true;
      }
    }
    return removed ? url.toString() : urlStr;
  } catch {
    return urlStr;
  }
}
```

### Lifecycle

- `URLCleaner` instance is constructed once at module level (lazy-init on first call) and cached for reuse.
- `dispose()` must be called on process shutdown. Add to existing SIGINT/SIGTERM handlers in `main.ts`:

```typescript
// In main.ts shutdown handler
if (cleanerInstance) {
  cleanerInstance.dispose();
}
```

This requires exporting a `disposeUrlCleaner()` function from `htmlToMarkdown.ts` that `main.ts` can call.

---

## Change 3: Recommended MCPorter Lifecycle

### Problem

`url-cleaner` has a ~381ms cold start penalty from parsing filter lists. In MCPorter's default ephemeral mode, every tool call pays this cost.

### Recommendation

Set `"lifecycle": "keep-alive"` on email-mcp's MCPorter server entry:

```json
{
  "mcpServers": {
    "email-mcp": {
      "command": "npx",
      "args": ["-y", "@miguelarios/email-mcp"],
      "env": { "..." : "..." },
      "lifecycle": "keep-alive"
    }
  }
}
```

Alternative: env var `MCPORTER_KEEPALIVE=email-mcp`.

### Side Benefits

- IMAP connection pooling persists across calls
- The `URLCleaner` instance is constructed once and reused
- Any future in-memory caches survive between invocations

### Note

This is a deployment recommendation, not a code change. The MCP server works correctly in ephemeral mode — it just pays the cold start cost each time.

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/email-mcp/src/htmlToMarkdown.ts` | Replace `TRACKING_PARAMS` Set + `cleanUrl()` with `url-cleaner` + supplemental list; change `fetchOne` from HEAD to GET; export `disposeUrlCleaner()` |
| `packages/email-mcp/src/main.ts` | Call `disposeUrlCleaner()` in shutdown handler |
| `packages/email-mcp/package.json` | Add `@backrunner/url-cleaner` dependency |
| `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts` | Update tests for GET method, new cleaner behavior, supplemental params |

---

## Dependencies

- **Add:** `@backrunner/url-cleaner`
- **Remove:** Nothing — but the `TRACKING_PARAMS` Set and `cleanUrl()` function are replaced inline

---

## Privacy Considerations

Resolved URLs contain subscriber identity tokens that tie back to the user's email address:

| Token | Source | Handled By |
|-------|--------|------------|
| `_kx` | Klaviyo subscriber ID | `url-cleaner` |
| `srsltid` | Google Ads click ID | `url-cleaner` |
| `mc_eid` | Mailchimp subscriber ID | `url-cleaner` |
| `_ke` | Klaviyo alt token | Supplemental list |
| `sc_cid` | Snapchat click ID | Supplemental list |
| `fbclid` / `gclid` | Facebook / Google click IDs | `url-cleaner` |
| `_hsenc` | HubSpot tracking | `url-cleaner` |
| `mkt_tok` | Marketo token | `url-cleaner` |

When using GET to resolve, the tracking service sees: home server IP + subscriber token + timestamp + all "clicked" links. The burst pattern (30 URLs within 200ms) signals automated processing.

**Mitigations:**
1. `url-cleaner` strips most subscriber tokens via uBlock/AdGuard lists
2. Supplemental list catches gaps (`_ke`, `sc_cid`)
3. Future consideration: route URL resolution through Tailscale exit node or HTTP proxy to mask home IP

---

## Testing Strategy

### Unit Tests — `fetchOne` GET Behavior

- Mock `fetch` to verify `method: "GET"` is used instead of `"HEAD"`
- Verify `controller.abort()` is called after reading `res.url`
- Existing timeout and error handling tests remain valid (behavior unchanged)

### Unit Tests — `url-cleaner` Integration

- Test that known tracking params (`_kx`, `srsltid`, `mc_eid`, `fbclid`, `gclid`, `_hsenc`, `mkt_tok`, `__s`) are stripped
- Test that supplemental params (`_ke`, `sc_cid`) are stripped
- Test that non-tracking params are preserved (e.g., `v=` on Shopify CDN URLs, `p=` on product pages)
- Test `disposeUrlCleaner()` can be called safely (including when no instance exists)

### Integration Consideration

The `url-cleaner` library loads external filter lists at init time. Tests should mock or pre-initialize the cleaner to avoid network dependency in CI.

---

## Deferred

- **HTTP proxy for URL resolution** — routing through a Tailscale exit node or HTTP proxy to mask home IP. Worth considering but separate scope.
- **HEAD-then-GET fallback** — evaluated and rejected (see Change 1 rationale).
- **`@protontech/tidy-url`** — evaluated and rejected due to missing Klaviyo/Google Ads coverage.
