# Email-MCP URL Resolution & Tracking Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix click-tracker URL resolution (HEAD→GET) and replace hand-rolled tracking param stripping with `@backrunner/url-cleaner` (uBlock Origin/AdGuard filter lists).

**Architecture:** Two independent changes in `htmlToMarkdown.ts`: (1) switch `fetchOne` from HEAD to GET with abort-after-resolve, (2) replace `TRACKING_PARAMS` Set + `cleanUrl()` with a lazy-init `URLCleaner` singleton using `useDefaultLists: true` plus a supplemental param list. Export a `disposeUrlCleaner()` for shutdown cleanup in `main.ts`.

**Tech Stack:** TypeScript, `@backrunner/url-cleaner`, Vitest

---

### Task 1: Switch `fetchOne` from HEAD to GET

**Files:**
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts:180-211`

- [ ] **Step 1: Update test assertions for GET method**

In `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`, the mock fetch doesn't check method, so existing tests will pass with GET too. Add a test that explicitly verifies GET is used. Add this test inside the `describe("htmlToMarkdown", ...)` block, after the "handles emails with no links without errors" test (line 425):

```typescript
  it("uses GET method for URL resolution", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return { url: "https://resolved.example.com/page" };
    });

    await htmlToMarkdown('<a href="https://tracker.example.com/click">Link</a>');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts -t "uses GET method"`

Expected: FAIL — `fetchOne` currently passes `method: "HEAD"`, assertion expects `"GET"`.

- [ ] **Step 3: Update `fetchOne` to use GET**

In `packages/email-mcp/src/htmlToMarkdown.ts`, replace lines 188-199:

```typescript
// Old:
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
```

With:

```typescript
// New:
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    controller.abort();
    const elapsed = Date.now() - start;
    if (url !== res.url) {
      log(`RESOLVE ${url} → ${res.url} (${elapsed}ms)`);
    }
    return { url, resolved: res.url, status: "ok" };
```

Two changes: `"HEAD"` → `"GET"`, add `controller.abort()` after clearTimeout, log prefix `HEAD` → `RESOLVE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: ALL PASS. The new "uses GET method" test passes. The existing debug log test that checks for the log content needs updating — it currently expects `HEAD` in the log output (it doesn't — it checks for the URL and "ms)", so it should pass as-is).

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "fix(email-mcp): switch URL resolution from HEAD to GET

Klaviyo click trackers return 404 for HEAD but 302 for GET.
GET with abort-after-resolve has the same cost as HEAD but works
universally across click tracker services."
```

---

### Task 2: Install `@backrunner/url-cleaner` and write failing tests

**Files:**
- Modify: `packages/email-mcp/package.json`
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Install the dependency**

Run: `cd packages/email-mcp && npm install @backrunner/url-cleaner`

- [ ] **Step 2: Write failing tests for url-cleaner integration**

In `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`, the existing `cleanUrl` tests (lines 7-39) need to be replaced. Replace the entire `describe("cleanUrl", ...)` block with:

```typescript
describe("cleanUrl", () => {
  it("strips utm params", async () => {
    const url =
      "https://example.com/page?utm_source=email&utm_medium=newsletter&utm_campaign=spring&id=42";
    const result = await cleanUrl(url);
    expect(result).toBe("https://example.com/page?id=42");
  });

  it("strips Klaviyo _kx param", async () => {
    const url =
      "https://cdn.shopify.com/recipe.pdf?v=1773944942&_kx=BQ9YKnD8Hac1eUYa5CUsKsPXk0t1";
    const result = await cleanUrl(url);
    expect(result).toBe("https://cdn.shopify.com/recipe.pdf?v=1773944942");
  });

  it("strips Google Ads srsltid param", async () => {
    const url =
      "https://stealthhealthcontainers.com/?srsltid=AfmBOoqhC98&_kx=BQ9YKnD8Hac1";
    const result = await cleanUrl(url);
    expect(result).toBe("https://stealthhealthcontainers.com/");
  });

  it("strips supplemental params _ke and sc_cid", async () => {
    const url = "https://example.com/page?_ke=abc123&sc_cid=snap456&id=42";
    const result = await cleanUrl(url);
    expect(result).toBe("https://example.com/page?id=42");
  });

  it("strips fbclid and gclid", async () => {
    const url = "https://example.com/?fbclid=fb1&gclid=gc1&keep=yes";
    const result = await cleanUrl(url);
    expect(result).toBe("https://example.com/?keep=yes");
  });

  it("strips HubSpot and Marketo params", async () => {
    const url = "https://example.com/?_hsenc=hs1&_hsmi=hm1&mkt_tok=mt1&keep=yes";
    const result = await cleanUrl(url);
    expect(result).toBe("https://example.com/?keep=yes");
  });

  it("preserves functional params like Google Calendar", async () => {
    const url =
      "https://calendar.google.com/calendar/event?action=RESPOND&eid=abc123&rst=1&tok=xyz789&ctz=America%2FLos_Angeles&hl=en&es=0";
    const result = await cleanUrl(url);
    expect(result).toBe(url);
  });

  it("returns malformed URLs as-is", async () => {
    expect(await cleanUrl("not-a-url")).toBe("not-a-url");
    expect(await cleanUrl("")).toBe("");
  });

  it("handles URLs with no query params", async () => {
    const url = "https://example.com/page";
    const result = await cleanUrl(url);
    expect(result).toBe("https://example.com/page");
  });
});
```

Also update the import on line 5 — `cleanUrl` is now async:

```typescript
import { cleanUrl, disposeUrlCleaner, htmlToMarkdown } from "../htmlToMarkdown.js";
```

Add a global `afterAll` at the top level (after the `vi.stubGlobal` line, around line 47):

```typescript
afterAll(async () => {
  await disposeUrlCleaner();
});
```

And add `afterAll` to the vitest import on line 4:

```typescript
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: FAIL — `cleanUrl` is still synchronous and doesn't strip `_kx`, `srsltid`, etc. The import of `disposeUrlCleaner` will also fail since it doesn't exist yet.

---

### Task 3: Implement url-cleaner integration

**Files:**
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts:1-43,159-165`

- [ ] **Step 1: Replace imports, TRACKING_PARAMS, and cleanUrl**

In `packages/email-mcp/src/htmlToMarkdown.ts`, replace lines 1-43 (the imports, `TRACKING_PARAMS` Set, and `cleanUrl` function) with:

```typescript
import { appendFileSync } from "node:fs";
import URLCleaner from "@backrunner/url-cleaner";
import sanitize from "sanitize-html";
import TurndownService from "turndown";

// Supplemental tracking params not covered by uBlock/AdGuard lists
const SUPPLEMENTAL_TRACKING_PARAMS = ["_ke", "sc_cid"];

// Lazy-init singleton — constructed on first use, reused thereafter
let cleanerInstance: URLCleaner | null = null;

function getCleaner(): URLCleaner {
  if (!cleanerInstance) {
    cleanerInstance = new URLCleaner({ useDefaultLists: true });
  }
  return cleanerInstance;
}

export async function disposeUrlCleaner(): Promise<void> {
  if (cleanerInstance) {
    await cleanerInstance.dispose();
    cleanerInstance = null;
  }
}

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

export async function cleanUrl(urlStr: string): Promise<string> {
  try {
    new URL(urlStr);
  } catch {
    return urlStr;
  }
  const cleaner = getCleaner();
  const result = await cleaner.cleanURLWithResult(urlStr);
  return stripSupplementalParams(result.url);
}
```

- [ ] **Step 2: Update the tracking param strip step in `htmlToMarkdown`**

In `htmlToMarkdown`, replace the Step 5 block (lines 159-165 approximately — the "Strip tracking params from all URLs" section):

```typescript
  // Step 5: Strip tracking params from all URLs
  markdown = markdown.replace(/\(https?:\/\/[^)]+\)/g, (match) => {
    const url = match.slice(1, -1); // remove parens
    return `(${cleanUrl(url)})`;
  });
```

With the async version:

```typescript
  // Step 5: Strip tracking params from all URLs
  const paramPattern = /\(https?:\/\/[^)]+\)/g;
  const paramMatches = [...markdown.matchAll(paramPattern)];
  if (paramMatches.length > 0) {
    const urls = [...new Set(paramMatches.map((m) => m[0].slice(1, -1)))];
    const cleaned = await Promise.all(urls.map((u) => cleanUrl(u)));
    const urlMap = new Map(urls.map((u, i) => [u, cleaned[i]]));
    for (const [original, clean] of urlMap) {
      if (original !== clean) {
        markdown = markdown.replaceAll(original, clean);
      }
    }
  }
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts`

Expected: ALL PASS — `cleanUrl` now uses url-cleaner for main params and supplemental list for `_ke`/`sc_cid`.

Note: Some tests may need tolerance for url-cleaner's behavior. If the library reorders or normalizes query params differently than the old `cleanUrl`, adjust expected values accordingly. The key assertions are: tracking params are removed, functional params are preserved.

- [ ] **Step 4: Run full test suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts packages/email-mcp/package.json package-lock.json
git commit -m "feat(email-mcp): replace hand-rolled tracking param strip with url-cleaner

Use @backrunner/url-cleaner (uBlock Origin + AdGuard filter lists) for
tracking parameter removal. Covers Klaviyo _kx, Google Ads srsltid,
and hundreds of other params the hand-maintained list missed.
Supplemental list handles _ke and sc_cid gaps."
```

---

### Task 4: Wire up `disposeUrlCleaner` in shutdown handler

**Files:**
- Modify: `packages/email-mcp/src/main.ts:1,28-30`

- [ ] **Step 1: Add import and update shutdown handler**

In `packages/email-mcp/src/main.ts`, add the import on line 1 (after the existing imports):

```typescript
import { disposeUrlCleaner } from "./htmlToMarkdown.js";
```

Replace the `handleShutdown` function (lines 28-30):

```typescript
  const handleShutdown = async () => {
    process.exit(0);
  };
```

With:

```typescript
  const handleShutdown = async () => {
    await disposeUrlCleaner();
    process.exit(0);
  };
```

- [ ] **Step 2: Run full test suite**

Run: `npm test && npm run typecheck && npm run lint`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/main.ts
git commit -m "chore(email-mcp): dispose url-cleaner on shutdown

Call disposeUrlCleaner() in SIGINT/SIGTERM handler to release
uBlock filter engine resources cleanly."
```
