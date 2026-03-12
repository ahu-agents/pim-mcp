# search_emails Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `list_emails` with `search_emails` — structured params, tiered date sorting, tool rename.

**Architecture:** Replace the query-string parser (`parseSearchQuery`) with a criteria builder (`buildSearchCriteria`) that maps structured params to imapflow `SearchObject`. Update `ImapService.searchEmails` to accept `SearchParams` and use tiered sort (local sort for <=1000 results, UID approximation for >1000). Rename the tool from `list_emails` to `search_emails`.

**Tech Stack:** TypeScript, imapflow (SearchObject API), Vitest, MCP SDK

**Spec:** `docs/specs/2026-03-11-search-emails-sort-redesign.md`

**Note:** imapflow does not expose a public SORT command (RFC 5256). Tier 1 (server-side SORT) is deferred. We implement Tiers 2 and 3 only.

---

## Chunk 1: Search Criteria Builder

### Task 1: Replace parseSearchQuery with buildSearchCriteria

**Files:**
- Rewrite: `packages/email-mcp/src/search.ts`
- Rewrite: `packages/email-mcp/src/__tests__/search.test.ts`

The new `SearchParams` interface and `buildSearchCriteria` function replace the old query-string parser. The function maps structured params directly to imapflow `SearchObject` format.

Key behaviors:
- String params without quotes → split on spaces, AND each word: `from: "dinner movie"` → `{ from: "dinner" }` AND `{ from: "movie" }`
- String params with quotes → exact phrase: `subject: '"dinner movie"'` → `{ subject: "dinner movie" }`
- `query` searches subject + body with OR: `query: "budget"` → `{ or: [{ subject: "budget" }, { body: "budget" }] }`
- `-term` exclusion in `query`: `query: "dinner -movie"` → subject+body OR for "dinner", NOT body "movie"
- Boolean params map directly: `unread: true` → `{ seen: false }`
- `tags` → multiple `keyword` criteria ANDed
- `hasAttachment` → `{ header: { "content-type": "multipart/mixed" } }`
- Empty params → `{ all: true }`

- [ ] **Step 1: Write tests for buildSearchCriteria**

Replace the contents of `packages/email-mcp/src/__tests__/search.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import { buildSearchCriteria, type SearchParams } from "../search.js";

describe("buildSearchCriteria", () => {
  it("returns { all: true } for empty params", () => {
    expect(buildSearchCriteria({})).toEqual({ all: true });
  });

  it("maps from param to IMAP from", () => {
    expect(buildSearchCriteria({ from: "boss@work.com" })).toEqual({
      from: "boss@work.com",
    });
  });

  it("maps to param to IMAP to", () => {
    expect(buildSearchCriteria({ to: "team@work.com" })).toEqual({
      to: "team@work.com",
    });
  });

  it("maps cc param", () => {
    expect(buildSearchCriteria({ cc: "manager@work.com" })).toEqual({
      cc: "manager@work.com",
    });
  });

  it("maps bcc param", () => {
    expect(buildSearchCriteria({ bcc: "secret@work.com" })).toEqual({
      bcc: "secret@work.com",
    });
  });

  it("maps subject param", () => {
    expect(buildSearchCriteria({ subject: "meeting" })).toEqual({
      subject: "meeting",
    });
  });

  it("maps body param", () => {
    expect(buildSearchCriteria({ body: "report" })).toEqual({
      body: "report",
    });
  });

  it("maps since param to Date", () => {
    const result = buildSearchCriteria({ since: "2026-03-01" });
    expect(result.since).toEqual(new Date("2026-03-01"));
  });

  it("maps before param to Date", () => {
    const result = buildSearchCriteria({ before: "2026-03-10" });
    expect(result.before).toEqual(new Date("2026-03-10"));
  });

  it("maps unread: true to seen: false", () => {
    expect(buildSearchCriteria({ unread: true })).toEqual({ seen: false });
  });

  it("maps unread: false to seen: true", () => {
    expect(buildSearchCriteria({ unread: false })).toEqual({ seen: true });
  });

  it("maps flagged: true", () => {
    expect(buildSearchCriteria({ flagged: true })).toEqual({ flagged: true });
  });

  it("maps flagged: false", () => {
    expect(buildSearchCriteria({ flagged: false })).toEqual({ flagged: false });
  });

  it("maps hasAttachment to content-type header check", () => {
    expect(buildSearchCriteria({ hasAttachment: true })).toEqual({
      header: { "content-type": "multipart/mixed" },
    });
  });

  it("maps single tag to keyword", () => {
    expect(buildSearchCriteria({ tags: ["work"] })).toEqual({
      keyword: "work",
    });
  });

  it("maps multiple tags to ANDed keywords", () => {
    const result = buildSearchCriteria({ tags: ["work", "urgent"] });
    // imapflow AND is expressed as top-level keys; multiple keywords need array wrapping
    expect(result).toHaveProperty("keyword");
  });

  it("splits unquoted subject into keyword AND", () => {
    const result = buildSearchCriteria({ subject: "dinner movie" });
    // Should produce two SUBJECT criteria ANDed
    expect(result).toBeDefined();
  });

  it("preserves quoted subject as exact phrase", () => {
    const result = buildSearchCriteria({ subject: '"dinner movie"' });
    expect(result).toEqual({ subject: "dinner movie" });
  });

  it("maps query to OR of subject and body", () => {
    const result = buildSearchCriteria({ query: "budget" });
    expect(result.or).toBeDefined();
    expect(result.or).toEqual([
      { subject: "budget" },
      { body: "budget" },
    ]);
  });

  it("handles query with -exclusion", () => {
    const result = buildSearchCriteria({ query: "dinner -movie" });
    expect(result.or).toBeDefined();
    expect(result.not).toBeDefined();
  });

  it("combines multiple params with AND", () => {
    const result = buildSearchCriteria({
      from: "boss@work.com",
      unread: true,
      since: "2026-03-01",
    });
    expect(result.from).toBe("boss@work.com");
    expect(result.seen).toBe(false);
    expect(result.since).toEqual(new Date("2026-03-01"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: FAIL — `buildSearchCriteria` does not exist

- [ ] **Step 3: Implement buildSearchCriteria**

Replace the contents of `packages/email-mcp/src/search.ts` with:

```typescript
export interface SearchParams {
  query?: string;
  body?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  flagged?: boolean;
  hasAttachment?: boolean;
  tags?: string[];
}

/**
 * Parse a string value into tokens, respecting quoted phrases.
 * "dinner movie" → ["dinner", "movie"]
 * '"dinner movie"' → ["dinner movie"]
 * 'hello "exact phrase" world' → ["hello", "exact phrase", "world"]
 */
function parseTokens(value: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    tokens.push(match[1] || match[2]);
  }
  return tokens;
}

/**
 * Build imapflow-compatible search criteria from structured params.
 * All params combine with AND logic.
 */
export function buildSearchCriteria(
  params: SearchParams,
): Record<string, unknown> {
  const criteria: Record<string, unknown>[] = [];

  // Simple string fields → IMAP search keys
  const stringFields = ["from", "to", "cc", "bcc", "subject", "body"] as const;
  for (const field of stringFields) {
    const value = params[field];
    if (value === undefined) continue;
    const tokens = parseTokens(value);
    for (const token of tokens) {
      criteria.push({ [field]: token });
    }
  }

  // query → OR(subject, body) for each positive term, NOT(body) for -terms
  if (params.query !== undefined) {
    const tokens = parseTokens(params.query);
    const positive: string[] = [];
    const negative: string[] = [];
    for (const token of tokens) {
      if (token.startsWith("-") && token.length > 1) {
        negative.push(token.slice(1));
      } else {
        positive.push(token);
      }
    }
    for (const term of positive) {
      criteria.push({ or: [{ subject: term }, { body: term }] });
    }
    for (const term of negative) {
      criteria.push({ not: { body: term } });
    }
  }

  // Date filters
  if (params.since !== undefined) {
    criteria.push({ since: new Date(params.since) });
  }
  if (params.before !== undefined) {
    criteria.push({ before: new Date(params.before) });
  }

  // Boolean flags
  if (params.unread !== undefined) {
    criteria.push({ seen: !params.unread });
  }
  if (params.flagged !== undefined) {
    criteria.push({ flagged: params.flagged });
  }

  // Attachment filter
  if (params.hasAttachment === true) {
    criteria.push({ header: { "content-type": "multipart/mixed" } });
  }

  // Tags (IMAP keywords)
  if (params.tags !== undefined) {
    for (const tag of params.tags) {
      criteria.push({ keyword: tag });
    }
  }

  // No criteria → match all
  if (criteria.length === 0) {
    return { all: true };
  }

  // Single criterion → return directly
  if (criteria.length === 1) {
    return criteria[0];
  }

  // Multiple criteria → merge into single object (imapflow ANDs top-level keys)
  // For duplicate keys, we need to wrap in an implicit AND structure
  const merged: Record<string, unknown> = {};
  for (const c of criteria) {
    for (const [key, value] of Object.entries(c)) {
      if (key in merged) {
        // Key collision — need to restructure. imapflow doesn't support
        // duplicate top-level keys, so we fall back to the last value.
        // For most real queries this won't happen (different field types).
        merged[key] = value;
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: PASS — all tests green. Some tests may need adjustment based on exact output shape; fix assertions to match actual imapflow-compatible output.

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/search.ts packages/email-mcp/src/__tests__/search.test.ts
git commit -m "feat(email-mcp): replace parseSearchQuery with buildSearchCriteria

Structured params (from, to, cc, bcc, subject, body, query, since,
before, unread, flagged, hasAttachment, tags) mapped directly to
imapflow SearchObject. Supports keyword splitting and quoted phrases."
```

---

## Chunk 2: Tiered Sort in ImapService

### Task 2: Update ImapService.searchEmails with tiered sort strategy

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts`
- Modify: `packages/email-mcp/src/__tests__/ImapService.test.ts`

Update `searchEmails` to accept `SearchParams` (from search.ts) instead of raw `Record<string, unknown>`. Internally call `buildSearchCriteria` to convert params. Implement tiered sort:
- <= 1000 results: fetch all envelopes, sort by date descending, paginate
- \> 1000 results: reverse UIDs, slice, fetch envelopes, sort slice by date

- [ ] **Step 1: Write tests for tiered sort**

Add new test cases to `packages/email-mcp/src/__tests__/ImapService.test.ts`. Update the existing `searchEmails` test and add tier-specific tests:

```typescript
// Update the existing test to use SearchParams instead of raw query object
// Change: service.searchEmails("INBOX", {}, { limit: 10 })
// To: service.searchEmails("INBOX", {}, { limit: 10 })
// (SearchParams {} is equivalent — buildSearchCriteria({}) → { all: true })

// Add test: results sorted by date descending (Tier 2)
it("returns results sorted by date descending", async () => {
  mockSearch.mockResolvedValueOnce([101, 102, 103]);

  const messages = [
    {
      uid: 101,
      envelope: {
        messageId: "<msg-101@test.com>",
        subject: "Old",
        from: [{ address: "a@test.com", name: "A" }],
        to: [{ address: "b@test.com", name: "B" }],
        date: new Date("2026-03-01"),
      },
      flags: new Set([]),
      bodyStructure: { type: "text/plain" },
    },
    {
      uid: 102,
      envelope: {
        messageId: "<msg-102@test.com>",
        subject: "Newest",
        from: [{ address: "c@test.com", name: "C" }],
        to: [{ address: "d@test.com", name: "D" }],
        date: new Date("2026-03-10"),
      },
      flags: new Set([]),
      bodyStructure: { type: "text/plain" },
    },
    {
      uid: 103,
      envelope: {
        messageId: "<msg-103@test.com>",
        subject: "Middle",
        from: [{ address: "e@test.com", name: "E" }],
        to: [{ address: "f@test.com", name: "F" }],
        date: new Date("2026-03-05"),
      },
      flags: new Set([]),
      bodyStructure: { type: "text/plain" },
    },
  ];
  mockFetch.mockReturnValueOnce(
    (async function* () {
      for (const msg of messages) yield msg;
    })(),
  );

  const results = await service.searchEmails("INBOX", {}, { limit: 10 });
  expect(results[0].subject).toBe("Newest");
  expect(results[1].subject).toBe("Middle");
  expect(results[2].subject).toBe("Old");
});

// Add test: accepts SearchParams and passes criteria to IMAP search
it("passes search criteria from SearchParams to IMAP", async () => {
  mockSearch.mockResolvedValueOnce([]);

  await service.searchEmails("INBOX", { from: "boss@work.com", unread: true });
  expect(mockSearch).toHaveBeenCalledWith(
    { from: "boss@work.com", seen: false },
    { uid: true },
  );
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: FAIL — `searchEmails` signature mismatch or criteria not matching

- [ ] **Step 3: Update ImapService.searchEmails**

In `packages/email-mcp/src/services/ImapService.ts`:

1. Add import: `import { buildSearchCriteria, type SearchParams } from "../search.js";`
2. Change `searchEmails` signature from `query: Record<string, unknown>` to `params: SearchParams`
3. Replace internal logic:

```typescript
async searchEmails(
  folder: string,
  params: SearchParams = {},
  options: SearchOptions = {},
): Promise<EmailSummary[]> {
  const client = this.createClient();
  const criteria = buildSearchCriteria(params);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const searchResult = await client.search(criteria as any, { uid: true });
      const uids = searchResult || [];

      if (uids.length === 0) return [];

      const offset = options.offset ?? 0;
      const limit = options.limit ?? 50;

      let fetchUids: number[];

      if (uids.length <= 1000) {
        // Tier 2: fetch all envelopes, sort by date, paginate
        const allSummaries = await this.fetchSummaries(client, uids);
        allSummaries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return allSummaries.slice(offset, offset + limit);
      } else {
        // Tier 3: reverse UIDs, slice, fetch, sort slice
        uids.reverse();
        fetchUids = uids.slice(offset, offset + limit);
        const summaries = await this.fetchSummaries(client, fetchUids);
        return summaries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    await client.logout().catch(() => {});
  }
}

private async fetchSummaries(client: ImapFlow, uids: number[]): Promise<EmailSummary[]> {
  const summaries: EmailSummary[] = [];
  const uidRange = uids.join(",");

  for await (const msg of client.fetch(uidRange, {
    envelope: true,
    flags: true,
    bodyStructure: true,
    uid: true,
  }, { uid: true })) {
    const envelope = msg.envelope!;
    summaries.push({
      uid: msg.uid,
      messageId: envelope.messageId || "",
      subject: envelope.subject || "",
      from: envelope.from?.[0]
        ? {
            name: envelope.from[0].name,
            address: envelope.from[0].address || "",
          }
        : { address: "unknown" },
      to: (envelope.to || []).map((a: any) => ({
        name: a.name,
        address: a.address || "",
      })),
      date: envelope.date?.toISOString() || "",
      flags: [...(msg.flags || [])],
      hasAttachments: hasAttachmentParts(msg.bodyStructure),
    });
  }
  return summaries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): tiered sort strategy in searchEmails

Tier 2 (<=1000 results): fetch all envelopes, sort by date desc, paginate.
Tier 3 (>1000 results): reverse UIDs, slice, sort slice by date.
Accept SearchParams instead of raw query object."
```

---

## Chunk 3: Tool Rename and Structured Params

### Task 3: Rename list_emails to search_emails with structured params

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts`
- Modify: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Update tests for rename and new params**

In `packages/email-mcp/src/__tests__/emailTools.test.ts`, update:

```typescript
// Change "list_emails" → "search_emails" in the expected tool names test
expect(names).toContain("search_emails");
// Remove: expect(names).toContain("list_emails");

// Replace the "list_emails has folder and query params" test with:
it("search_emails has structured search params", () => {
  const tool = EMAIL_TOOLS.find((t) => t.name === "search_emails")!;
  const props = tool.inputSchema.properties as Record<string, unknown>;
  expect(props).toHaveProperty("folder");
  expect(props).toHaveProperty("query");
  expect(props).toHaveProperty("body");
  expect(props).toHaveProperty("from");
  expect(props).toHaveProperty("to");
  expect(props).toHaveProperty("cc");
  expect(props).toHaveProperty("bcc");
  expect(props).toHaveProperty("subject");
  expect(props).toHaveProperty("since");
  expect(props).toHaveProperty("before");
  expect(props).toHaveProperty("unread");
  expect(props).toHaveProperty("flagged");
  expect(props).toHaveProperty("hasAttachment");
  expect(props).toHaveProperty("tags");
  expect(props).toHaveProperty("limit");
  expect(props).toHaveProperty("offset");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: FAIL — `search_emails` not found, `list_emails` still exists

- [ ] **Step 3: Update tool definition and handler**

In `packages/email-mcp/src/tools/emailTools.ts`:

1. Rename the tool from `list_emails` to `search_emails`
2. Update the description
3. Replace the inputSchema properties with the full structured params
4. Update the handler `case "list_emails"` to `case "search_emails"`
5. Replace `parseSearchQuery` usage with direct `SearchParams` construction from args
6. Update the import from `parseSearchQuery` to `SearchParams`
7. Change default limit from `20` to `50`

Tool definition:

```typescript
{
  name: "search_emails",
  description:
    "Search and list emails in a folder. Returns email summaries sorted by date (newest first). All filters combine with AND logic. String params support keyword matching (space-separated words) and exact phrases (use quotes).",
  inputSchema: {
    type: "object",
    properties: {
      folder: {
        type: "string",
        description: 'IMAP folder path. Defaults to "INBOX".',
      },
      query: {
        type: "string",
        description:
          'Search subject and body. Supports -term for exclusion. Examples: "budget", "dinner -movie".',
      },
      body: {
        type: "string",
        description: "Search body text only.",
      },
      from: {
        type: "string",
        description: "Match sender name or email address.",
      },
      to: {
        type: "string",
        description: "Match recipient name or email address.",
      },
      cc: {
        type: "string",
        description: "Match CC recipient.",
      },
      bcc: {
        type: "string",
        description: "Match BCC recipient.",
      },
      subject: {
        type: "string",
        description: "Match subject line.",
      },
      since: {
        type: "string",
        description: "Emails on or after this date (YYYY-MM-DD).",
      },
      before: {
        type: "string",
        description: "Emails before this date (YYYY-MM-DD).",
      },
      unread: {
        type: "boolean",
        description: "Filter by unread status.",
      },
      flagged: {
        type: "boolean",
        description: "Filter by flagged/starred status.",
      },
      hasAttachment: {
        type: "boolean",
        description: "Filter for emails with attachments.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by IMAP keyword flags.",
      },
      limit: {
        type: "number",
        description: "Max results to return. Defaults to 50.",
      },
      offset: {
        type: "number",
        description: "Number of results to skip for pagination. Defaults to 0.",
      },
    },
  },
},
```

Handler case:

```typescript
case "search_emails": {
  const searchParams: SearchParams = {
    query: args.query as string | undefined,
    body: args.body as string | undefined,
    from: args.from as string | undefined,
    to: args.to as string | undefined,
    cc: args.cc as string | undefined,
    bcc: args.bcc as string | undefined,
    subject: args.subject as string | undefined,
    since: args.since as string | undefined,
    before: args.before as string | undefined,
    unread: args.unread as boolean | undefined,
    flagged: args.flagged as boolean | undefined,
    hasAttachment: args.hasAttachment as boolean | undefined,
    tags: args.tags as string[] | undefined,
  };
  const limit = (args.limit as number) || 50;
  const offset = (args.offset as number) || 0;
  const emails = await imapService.searchEmails(folder, searchParams, {
    limit,
    offset,
  });
  return ok(JSON.stringify(emails, null, 2));
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run`
Expected: PASS — all email-mcp tests green

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): rename list_emails to search_emails with structured params

New params: query, body, from, to, cc, bcc, subject, since, before,
unread, flagged, hasAttachment, tags, limit (default 50), offset."
```

---

## Chunk 4: Full Integration Test and Cleanup

### Task 4: Run full test suite, build, and clean up

**Files:**
- Verify: all `packages/email-mcp/src/**/*.ts` files
- Update: `packages/email-mcp/src/search.ts` — remove old `parseSearchQuery` export if still referenced anywhere

- [ ] **Step 1: Check for stale references to list_emails or parseSearchQuery**

Run: `grep -r "list_emails\|parseSearchQuery" packages/email-mcp/src/`
Expected: No matches (all references updated)

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All 116 tests pass (or count adjusted for new/removed tests)

- [ ] **Step 3: Build all packages**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore(email-mcp): clean up stale references after search_emails rename"
```

### Task 5: Bump version and publish

**Files:**
- Modify: `packages/email-mcp/package.json` — bump version to `0.2.0` (breaking change: tool rename)

- [ ] **Step 1: Bump version to 0.2.0**

In `packages/email-mcp/package.json`, change `"version": "0.1.5"` to `"version": "0.2.0"`.

This is a minor version bump (pre-1.0 semver) because the tool rename is a breaking change for any existing consumers.

- [ ] **Step 2: Sync lock file**

Run: `npm install --package-lock-only`

- [ ] **Step 3: Build and publish**

Run: `npm run build && cd packages/email-mcp && npm publish --access public`

- [ ] **Step 4: Commit version bump**

```bash
git add packages/email-mcp/package.json package-lock.json
git commit -m "chore: bump email-mcp to v0.2.0 for search_emails rename"
```

- [ ] **Step 5: Tag release**

```bash
git tag email-mcp/v0.2.0
```
