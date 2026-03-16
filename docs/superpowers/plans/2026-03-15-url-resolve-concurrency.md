# URL Resolve Concurrency Throttling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unbounded concurrent URL resolution with a sliding window pool + retry to eliminate timeouts in emails with many redirect URLs.

**Architecture:** Extract single-URL fetch into `fetchOne()` returning a discriminated union. Add `pooledResolve()` that manages a concurrency-limited sliding window via `Promise.race()`. Wrap in retry loop that re-attempts only timed-out URLs up to 3 total attempts.

**Tech Stack:** Node.js `fetch`, `AbortController`, `Promise.race()` — no new dependencies.

---

## File Map

- **Modify:** `packages/email-mcp/src/htmlToMarkdown.ts` — refactor `resolveUrls()` into `fetchOne()`, `pooledResolve()`, and retry orchestration
- **Modify:** `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts` — add concurrency/retry tests, update existing summary-counts test

## Chunk 1: Implementation

### Task 1: Add `fetchOne` function and `FetchResult` type

**Files:**
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts:166-230`
- Test: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write failing tests for `fetchOne` behavior**

These test through `resolveUrls` (since `fetchOne` is not exported). The existing tests at lines 138–175 already cover success, redirect, network error, and timeout. We need one new test: errors are NOT retried (they stay as original URL after a single attempt).

Add this test inside the `htmlToMarkdown` describe block, after the "keeps original URL on fetch error" test (line 175):

```typescript
it("does not retry permanent fetch errors", async () => {
  let callCount = 0;
  mockFetch.mockImplementation(async () => {
    callCount++;
    throw new TypeError("fetch failed");
  });

  await htmlToMarkdown('<a href="https://broken.example.com/1">Link</a>');
  // Should only be called once — permanent errors are not retried
  expect(callCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts -t "does not retry permanent fetch errors"`

Expected: PASS (current code doesn't retry anything, so `callCount` will be 1). This test documents the existing behavior we need to preserve.

- [ ] **Step 3: Extract `fetchOne` and `FetchResult` type from `resolveUrls`**

In `packages/email-mcp/src/htmlToMarkdown.ts`, add the type and function above the existing `resolveUrls`. Then refactor `resolveUrls` to use `fetchOne`.

Replace lines 166–230 with:

```typescript
type FetchResult =
  | { url: string; resolved: string; status: "ok" }
  | { url: string; resolved: string; status: "timeout" }
  | { url: string; resolved: string; status: "error"; error: string };

const POOL_SIZE = 10;
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT = 10000;

async function fetchOne(
  url: string,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (url !== res.url) {
      log(`HEAD ${url} → ${res.url} (${elapsed}ms)`);
    }
    return { url, resolved: res.url, status: "ok" };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (err instanceof Error && err.name === "AbortError") {
      log(`TIMEOUT ${url} after ${timeoutMs}ms (elapsed ${elapsed}ms, kept original)`);
      return { url, resolved: url, status: "timeout" };
    }
    const reason = err instanceof Error ? err.message : String(err);
    log(`ERROR ${url} ${reason} (${elapsed}ms, kept original)`);
    return { url, resolved: url, status: "error", error: reason };
  }
}

async function resolveUrls(urls: string[]): Promise<Map<string, string>> {
  const debug = process.env.DEBUG_URL_RESOLVE === "1";
  const defaultTimeout = DEFAULT_TIMEOUT;
  const timeoutMs = debug
    ? Number.parseInt(process.env.URL_RESOLVE_TIMEOUT || String(defaultTimeout), 10)
    : defaultTimeout;
  const logFile = process.env.URL_RESOLVE_LOG || "/tmp/url-resolve.log";
  const log = debug
    ? (msg: string) => {
        const line = `[url-resolve] ${new Date().toISOString()} ${msg}\n`;
        try {
          appendFileSync(logFile, line);
        } catch {
          process.stderr.write(line);
        }
      }
    : (_msg: string) => {};

  const resolved = new Map<string, string>();

  // Single pass — no pooling yet, just uses fetchOne
  const results = await Promise.allSettled(
    urls.map((url) => fetchOne(url, timeoutMs, log)),
  );

  let resolvedCount = 0;
  let timeoutCount = 0;
  let errorCount = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      const r = result.value;
      resolved.set(r.url, r.resolved);
      if (r.status === "ok") resolvedCount++;
      else if (r.status === "timeout") timeoutCount++;
      else errorCount++;
    }
  }

  if (debug) {
    log(
      `Summary: ${resolvedCount}/${urls.length} resolved, ${timeoutCount} timeout (${timeoutMs}ms), ${errorCount} errors`,
    );
  }

  return resolved;
}
```

Note: The closing `}` for `resolveUrls` is included above. The entire block from `type FetchResult` through the end of `resolveUrls` replaces lines 166–230.

- [ ] **Step 4: Run all existing tests to verify refactor is behavior-preserving**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: All tests PASS. The `fetchOne` extraction should not change any observable behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "refactor(email-mcp): extract fetchOne with FetchResult discriminated union"
```

### Task 2: Add `pooledResolve` sliding window

**Files:**
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts`
- Test: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write failing test for concurrency limit**

Add inside the `htmlToMarkdown` describe block:

```typescript
it("limits concurrent URL fetches to pool size", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;

  mockFetch.mockImplementation(async (url: string) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    // Simulate async work so concurrency is observable
    await new Promise((r) => setTimeout(r, 10));
    concurrent--;
    return { url };
  });

  // Create 25 unique URLs — more than POOL_SIZE (10)
  const links = Array.from(
    { length: 25 },
    (_, i) => `<a href="https://example.com/${i}">Link ${i}</a>`,
  ).join(" ");

  await htmlToMarkdown(links);

  expect(maxConcurrent).toBeLessThanOrEqual(10);
  expect(maxConcurrent).toBeGreaterThan(1); // sanity: not accidentally serialized
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts -t "limits concurrent URL fetches"`

Expected: FAIL — `maxConcurrent` will be 25 since current code fires all at once.

- [ ] **Step 3: Implement `pooledResolve`**

Add this function in `packages/email-mcp/src/htmlToMarkdown.ts` between `fetchOne` and `resolveUrls`:

```typescript
async function pooledResolve(
  urls: string[],
  concurrency: number,
  fetchFn: (url: string) => Promise<FetchResult>,
): Promise<FetchResult[]> {
  if (urls.length === 0) return [];

  const results: FetchResult[] = [];
  const queue = [...urls];
  const inFlight = new Map<Promise<FetchResult>, number>();

  function startNext(): void {
    if (queue.length === 0) return;
    const url = queue.shift()!;
    const promise = fetchFn(url)
      .then((result) => {
        inFlight.delete(promise);
        results.push(result);
        return result;
      })
      .catch((err) => {
        // Safety net — fetchOne should never reject, but guard against it
        inFlight.delete(promise);
        const fallback: FetchResult = { url, resolved: url, status: "error", error: String(err) };
        results.push(fallback);
        return fallback;
      });
    inFlight.set(promise, 1);
  }

  // Fill initial slots
  const initialBatch = Math.min(concurrency, queue.length);
  for (let i = 0; i < initialBatch; i++) {
    startNext();
  }

  // Process remaining URLs as slots free up
  while (inFlight.size > 0) {
    await Promise.race([...inFlight.keys()]);
    // Slot freed — fill it
    while (inFlight.size < concurrency && queue.length > 0) {
      startNext();
    }
  }

  return results;
}
```

Then update `resolveUrls` to use `pooledResolve` instead of `Promise.allSettled`:

Replace the `// Single pass` section in `resolveUrls` with:

```typescript
  const results = await pooledResolve(
    urls,
    POOL_SIZE,
    (url) => fetchOne(url, timeoutMs, log),
  );

  let resolvedCount = 0;
  let timeoutCount = 0;
  let errorCount = 0;

  for (const r of results) {
    resolved.set(r.url, r.resolved);
    if (r.status === "ok") resolvedCount++;
    else if (r.status === "timeout") timeoutCount++;
    else errorCount++;
  }
```

- [ ] **Step 4: Add empty URL list test**

```typescript
it("handles emails with no links without errors", async () => {
  mockFetch.mockImplementation(async (url: string) => ({ url }));
  const result = await htmlToMarkdown("<p>No links here</p>");
  expect(result).toContain("No links here");
  expect(mockFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run tests to verify concurrency limit and all existing tests pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: All tests PASS including the new concurrency and empty-list tests.

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "feat(email-mcp): add pooledResolve sliding window concurrency pool"
```

### Task 3: Add retry logic for timed-out URLs

**Files:**
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts`
- Test: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write failing test for retry behavior**

Add inside the `htmlToMarkdown` describe block:

```typescript
it("retries timed-out URLs up to MAX_ATTEMPTS", async () => {
  const attempts = new Map<string, number>();

  mockFetch.mockImplementation(async (url: string) => {
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    if (url.includes("flaky") && count < 3) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return { url: url.includes("flaky") ? "https://resolved.example.com" : url };
  });

  const result = await htmlToMarkdown(
    '<a href="https://flaky.example.com/1">Flaky</a> <a href="https://ok.example.com/2">OK</a>',
  );

  // Flaky URL should have been attempted 3 times and eventually resolved
  expect(attempts.get("https://flaky.example.com/1")).toBe(3);
  // OK URL should only be attempted once
  expect(attempts.get("https://ok.example.com/2")).toBe(1);
  // Final result should contain the resolved URL
  expect(result).toContain("https://resolved.example.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts -t "retries timed-out URLs"`

Expected: FAIL — current code doesn't retry, so `attempts.get("flaky")` will be 1.

- [ ] **Step 3: Write failing test for max attempts exhaustion**

```typescript
it("keeps original URL after MAX_ATTEMPTS exhausted", async () => {
  mockFetch.mockImplementation(async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  });

  const result = await htmlToMarkdown(
    '<a href="https://always-slow.example.com/1">Link</a>',
  );

  // After 3 failed attempts, keeps original URL
  expect(result).toContain("https://always-slow.example.com/1");
  // Total attempts should be MAX_ATTEMPTS = 3
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts -t "keeps original URL after MAX_ATTEMPTS"`

Expected: FAIL — `mockFetch` will be called once, not 3 times.

- [ ] **Step 5: Implement retry loop in `resolveUrls`**

Replace the body of `resolveUrls` (after the `log` declaration) with:

```typescript
  const resolved = new Map<string, string>();
  let remaining = [...urls];
  let totalResolved = 0;
  let totalErrors = 0;
  let retryRounds = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    if (attempt > 0) retryRounds++;

    const results = await pooledResolve(
      remaining,
      POOL_SIZE,
      (url) => fetchOne(url, timeoutMs, log),
    );

    const timedOut: string[] = [];
    for (const r of results) {
      if (r.status === "ok") {
        resolved.set(r.url, r.resolved);
        totalResolved++;
      } else if (r.status === "timeout") {
        timedOut.push(r.url);
        // Set fallback now — will be overwritten if a later attempt succeeds
        resolved.set(r.url, r.resolved);
      } else {
        // Permanent error — don't retry
        resolved.set(r.url, r.resolved);
        totalErrors++;
      }
    }

    remaining = timedOut;
  }

  // remaining.length = URLs still timed out after all attempts
  if (debug) {
    const retryInfo = retryRounds > 0 ? `, ${retryRounds} retry round${retryRounds > 1 ? "s" : ""}` : "";
    log(
      `Summary: ${totalResolved}/${urls.length} resolved, ${remaining.length} timeout (${timeoutMs}ms), ${totalErrors} errors${retryInfo}`,
    );
  }

  return resolved;
}
```

Note: `remaining.length` after the loop gives the count of unique URLs that timed out on all attempts. The summary reports URL counts, not event counts.

- [ ] **Step 6: Run all tests**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "feat(email-mcp): add retry logic for timed-out URL resolution"
```

### Task 4: Update existing summary-counts test

**Files:**
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts:271-289`

- [ ] **Step 1: Update the "logs summary line with counts" test**

The existing test at line 271 uses `callCount` to make the second URL timeout. With retry logic, that second URL will now be retried (up to 3 attempts). Update the mock to account for retries.

Replace lines 271-289 with:

```typescript
    it("logs summary line with counts", async () => {
      vi.stubEnv("DEBUG_URL_RESOLVE", "1");
      const urlAttempts = new Map<string, number>();
      mockFetch.mockImplementation(async (url: string) => {
        const count = (urlAttempts.get(url) || 0) + 1;
        urlAttempts.set(url, count);
        if (url.includes("b.example.com")) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return { url: "https://resolved.example.com" };
      });

      await htmlToMarkdown(
        '<a href="https://a.example.com/1">A</a> <a href="https://b.example.com/2">B</a>',
      );
      const output = readLog();
      expect(output).toContain("Summary:");
      expect(output).toMatch(/1.*resolved/);
      // b.example.com always times out, so retry count = MAX_ATTEMPTS
      expect(urlAttempts.get("https://b.example.com/2")).toBe(3);
    });
```

- [ ] **Step 2: Run tests to verify**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "test(email-mcp): update summary-counts test for retry behavior"
```

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/email-mcp && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: No errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: No errors.

- [ ] **Step 4: Commit any lint/type fixes if needed, then verify clean**

Run: `cd packages/email-mcp && npx vitest run && npm run typecheck && npm run lint`

Expected: All pass.
