# URL Resolution Concurrency Throttling

**Status:** Implemented (email-mcp@0.4.0)

## Problem

`resolveUrls()` in `packages/email-mcp/src/htmlToMarkdown.ts` fires all URL HEAD requests simultaneously via `Promise.allSettled`. When an email contains many redirect URLs (e.g., 42 for NYT newsletters), network saturation and redirect-service throttling cause ~50% of requests to time out at 10s.

**Data point:** With 30 concurrent URLs, all resolve (4.5–9.5s each). With 42 concurrent, only 19 resolve and 23 time out.

## Solution

Replace the unbounded `Promise.allSettled` with a **sliding window concurrency pool** and **retry logic**.

## Design

### Sliding Window Pool

A hand-rolled concurrency pool manages in-flight requests:

- **Pool size:** 10 concurrent slots (`POOL_SIZE` constant)
- **Mechanism:** Maintain a set of in-flight promises. Await `Promise.race()` to detect when a slot frees up, then immediately start the next queued URL. This avoids idle time between batches.
- **Timeout:** 10s per URL (`DEFAULT_TIMEOUT` constant, unchanged — throttling alone should eliminate contention that caused timeouts)

### Retry Logic

After the initial pass through all URLs:

1. Collect URLs that **timed out only** (not permanent errors like DNS failure, connection refused, or HTTP errors — those are not retried)
2. Run timed-out URLs through the same pool again (same concurrency, same timeout)
3. Maximum 3 total attempts per URL (`MAX_ATTEMPTS` constant — initial pass counts as attempt 1, so at most 2 retry rounds)
4. After exhausting attempts, keep the original URL (existing fallback behavior)

### Constants

```typescript
const POOL_SIZE = 10;
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT = 10000;
```

### Code Structure

All changes are within `htmlToMarkdown.ts`. No new files or exports.

Note: `resolveUrls` is called with already-deduplicated URLs (via `new Set()` at the call site in `htmlToMarkdown`), so no deduplication is needed inside the pool.

**`fetchOne(url, timeoutMs, log)`** — Inner function handling a single URL fetch. Returns a discriminated result:

```typescript
type FetchResult =
  | { url: string; resolved: string; status: "ok" }
  | { url: string; resolved: string; status: "timeout" }
  | { url: string; resolved: string; status: "error"; error: string };
```

Uses `AbortController` with the given timeout, same as current implementation. On timeout/error, `resolved` is set to the original URL (fallback).

**`pooledResolve(urls, concurrency, fetchFn)`** — Unexported helper that implements the sliding window. Accepts a fetch function and returns an array of `FetchResult` in completion order (natural for sliding window, no re-sorting needed). Manages in-flight promises via `Promise.race()`, starting a new fetch each time one settles. Returns immediately if `urls` is empty.

**`resolveUrls(urls)`** — Orchestrates the retry loop:
1. Call `pooledResolve` with all URLs
2. Collect results where `status === "timeout"` (only timeouts are retried)
3. If timeouts remain and attempts < `MAX_ATTEMPTS`, re-run `pooledResolve` on timed-out URLs only
4. Build final `Map<string, string>` from accumulated results (later attempts overwrite earlier ones for the same URL)
5. Log summary with retry counts when debug enabled

### Debug Logging

Existing `DEBUG_URL_RESOLVE`, `URL_RESOLVE_LOG`, and `URL_RESOLVE_TIMEOUT` env vars continue to work as before. `URL_RESOLVE_TIMEOUT` applies per individual attempt — with `MAX_ATTEMPTS = 3` a single URL could block for up to 30s total across retries. Both failed and successful attempts are logged individually. Summary log updated to include retry information:

```
Summary: 40/42 resolved, 2 timeout (10000ms), 0 errors, 1 retry round
```

### Performance Estimate

With 42 URLs, pool size 10, and individual URLs taking 4.5–9.5s:
- ~4–5 waves of overlapping requests
- Estimated wall time: 30–45s for first pass
- Retry rounds add proportionally less time (fewer URLs)
- Tradeoff: slower total time, but resolves all/most URLs instead of losing half

### Testing

- Unit test: `pooledResolve` respects concurrency limit (mock fetch, track max concurrent calls via counter)
- Unit test: retry logic re-attempts timed-out URLs up to `MAX_ATTEMPTS`
- Unit test: permanent errors are not retried
- Unit test: successful URLs from first pass are not re-attempted
- Unit test: final map falls back to original URL after `MAX_ATTEMPTS` exhausted
- Unit test: empty URL list returns immediately
- Existing `htmlToMarkdown` tests continue to pass (they mock fetch); the "logs summary line with counts" test will need its mock adjusted since timed-out URLs will now be retried (additional `mockFetch` calls from retry rounds)
