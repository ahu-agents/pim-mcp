# email-mcp: search_emails North Star Implementation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining search_emails north star features: unified tokenization with NOT support for subject/body, add `hasWords` field (IMAP TEXT), replace `query` field, and base criteria folding for efficient multi-call IMAP SEARCH.

**Architecture:** Refactor `buildSearchCriteria` in `search.ts` to (1) parse tokens with `-` negation for all tokenized fields, (2) add `hasWords` mapped to IMAP `text` key, (3) remove `query`, and (4) separate base criteria from tokenized criteria so base criteria are folded into each IMAP SEARCH call. Update tool schema and handler to match.

**Tech Stack:** TypeScript, imapflow, vitest

**Spec:** `docs/superpowers/specs/2026-03-17-search-emails-north-star-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/email-mcp/src/search.ts` | Modify:1-146 | Add hasWords to SearchParams, remove query, add NOT support to tokenization, separate base/tokenized criteria |
| `packages/email-mcp/src/services/ImapService.ts` | Modify:87-117 | Use new `buildSearchCriteria` return shape for base criteria folding |
| `packages/email-mcp/src/tools/emailTools.ts` | Modify:10-94,349-364 | Replace query with hasWords in tool schema + handler |
| `packages/email-mcp/src/__tests__/search.test.ts` | Modify | Update/add tests for NOT, hasWords, base criteria separation |
| `packages/email-mcp/src/__tests__/ImapService.test.ts` | Modify | Test base criteria folding in IMAP SEARCH calls |
| `packages/email-mcp/src/__tests__/emailTools.test.ts` | Modify | Update schema test for hasWords replacing query |

---

## Chunk 1: Unified Tokenization with NOT + hasWords

### Task 1: Add NOT support to tokenized fields, add hasWords, remove query + tests

**IMPORTANT:** Tasks 1 and 2 from the original decomposition are merged into one task because changing `parseTokens` to return `ParsedToken[]` breaks the `query` block (lines 64-82) which calls `token.startsWith("-")` on string — the old and new code cannot coexist. Both changes must happen atomically.

**Files:**
- Modify: `packages/email-mcp/src/search.ts`
- Modify: `packages/email-mcp/src/__tests__/search.test.ts`

- [ ] **Step 1: Write failing tests for NOT support and hasWords**

Add to `search.test.ts`:

```typescript
  it("handles -negation in subject tokens", () => {
    const result = buildSearchCriteria({ subject: "update -cancelled" });
    expect(result).toEqual([
      { subject: "update" },
      { not: { subject: "cancelled" } },
    ]);
  });

  it("handles -negation in body tokens", () => {
    const result = buildSearchCriteria({ body: "report -draft" });
    expect(result).toEqual([
      { body: "report" },
      { not: { body: "draft" } },
    ]);
  });

  it("handles quoted phrase with -negation in subject", () => {
    const result = buildSearchCriteria({ subject: '"budget report" -old' });
    expect(result).toEqual([
      { subject: "budget report" },
      { not: { subject: "old" } },
    ]);
  });

  it("handles -negation on quoted phrase", () => {
    const result = buildSearchCriteria({ subject: '-"out of office"' });
    expect(result).toEqual({ not: { subject: "out of office" } });
  });

  it("maps hasWords to IMAP text key", () => {
    expect(buildSearchCriteria({ hasWords: "budget" })).toEqual({
      text: "budget",
    });
  });

  it("tokenizes hasWords with AND", () => {
    const result = buildSearchCriteria({ hasWords: "budget report" });
    expect(result).toEqual([{ text: "budget" }, { text: "report" }]);
  });

  it("handles -negation in hasWords", () => {
    const result = buildSearchCriteria({ hasWords: "budget -draft" });
    expect(result).toEqual([
      { text: "budget" },
      { not: { text: "draft" } },
    ]);
  });

  it("handles quoted phrase in hasWords", () => {
    expect(buildSearchCriteria({ hasWords: '"budget report"' })).toEqual({
      text: "budget report",
    });
  });
```

Also remove the two existing `query` tests:
- Remove `"maps query to OR of subject and body"` (around line 102)
- Remove `"handles query with -exclusion"` (around line 109)

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: 8 new tests FAIL, 2 removed query tests gone

- [ ] **Step 3: Update SearchParams, parseTokens, and buildSearchCriteria**

In `search.ts`, replace the `SearchParams` interface (lines 1-15) — remove `query`, add `hasWords`:

```typescript
export interface SearchParams {
  hasWords?: string;
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
```

Replace `parseTokens` (lines 23-32) with negation-aware version:

```typescript
interface ParsedToken {
  value: string;
  negated: boolean;
}

/**
 * Parse a string value into tokens, respecting quoted phrases and -negation.
 * "dinner movie" → [{ value: "dinner", negated: false }, { value: "movie", negated: false }]
 * '"dinner movie"' → [{ value: "dinner movie", negated: false }]
 * "update -cancelled" → [{ value: "update", negated: false }, { value: "cancelled", negated: true }]
 * '-"out of office"' → [{ value: "out of office", negated: true }]
 */
function parseTokens(value: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  const regex = /-?"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(value);
  while (match !== null) {
    const raw = match[0];
    const isNegated = raw.startsWith("-");
    const text = match[1] || match[2];
    const cleaned = isNegated && !match[1] ? text.slice(1) : text;
    if (cleaned.length > 0) {
      tokens.push({ value: cleaned, negated: isNegated });
    }
    match = regex.exec(value);
  }
  return tokens;
}
```

Replace the text fields loop (lines 53-62) AND the query block (lines 64-82) with a single unified tokenized fields loop:

```typescript
  // Tokenized fields → tokenized (spaces = AND), quotes for exact phrase, - for NOT
  // subject → IMAP SUBJECT, body → IMAP BODY, hasWords → IMAP TEXT
  const tokenizedFields: Array<{ param: keyof SearchParams; imapKey: string }> = [
    { param: "subject", imapKey: "subject" },
    { param: "body", imapKey: "body" },
    { param: "hasWords", imapKey: "text" },
  ];
  for (const { param, imapKey } of tokenizedFields) {
    const value = params[param] as string | undefined;
    if (value === undefined) continue;
    const tokens = parseTokens(value);
    for (const token of tokens) {
      if (token.negated) {
        criteria.push({ not: { [imapKey]: token.value } });
      } else {
        criteria.push({ [imapKey]: token.value });
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/search.ts packages/email-mcp/src/__tests__/search.test.ts
git commit -m "feat(email-mcp): unified tokenization with NOT support, add hasWords, remove query"
```

---

## Chunk 2: Base Criteria Folding

### Task 2: Separate base and tokenized criteria in buildSearchCriteria + tests

**Files:**
- Modify: `packages/email-mcp/src/search.ts:40-146`
- Modify: `packages/email-mcp/src/__tests__/search.test.ts`

- [ ] **Step 1: Write failing tests for base criteria folding**

Add to `search.test.ts`:

```typescript
  it("returns base criteria folded into each tokenized criterion", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "update meeting",
    });
    // Base criteria (from) should be folded into each tokenized call
    expect(result).toEqual([
      { from: "alice@test.com", subject: "update" },
      { from: "alice@test.com", subject: "meeting" },
    ]);
  });

  it("folds multiple base criteria into each tokenized criterion", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      unread: true,
      subject: "update meeting",
    });
    expect(result).toEqual([
      { from: "alice@test.com", seen: false, subject: "update" },
      { from: "alice@test.com", seen: false, subject: "meeting" },
    ]);
  });

  it("folds base criteria with NOT tokenized criteria", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "update -spam",
    });
    expect(result).toEqual([
      { from: "alice@test.com", subject: "update" },
      { from: "alice@test.com", not: { subject: "spam" } },
    ]);
  });

  it("folds base criteria with hasWords tokens", () => {
    const result = buildSearchCriteria({
      flagged: true,
      hasWords: "budget report",
    });
    expect(result).toEqual([
      { flagged: true, text: "budget" },
      { flagged: true, text: "report" },
    ]);
  });

  it("folds base criteria with tokens from multiple tokenized fields", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "meeting",
      body: "agenda",
    });
    // Two tokenized criteria, each gets the base folded in
    expect(result).toEqual([
      { from: "alice@test.com", subject: "meeting" },
      { from: "alice@test.com", body: "agenda" },
    ]);
  });

  it("folds base into single tokenized criterion (returns 1-element array)", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "meeting",
    });
    // 1 base + 1 tokenized token → folded into 1-element array
    // (behavioral change: previously returned flat object)
    expect(result).toEqual([
      { from: "alice@test.com", subject: "meeting" },
    ]);
  });

  it("returns base-only criteria merged when no tokenized fields", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      unread: true,
    });
    expect(result).toEqual({
      from: "alice@test.com",
      seen: false,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: New folding tests FAIL

- [ ] **Step 3: Refactor buildSearchCriteria to separate base and tokenized criteria**

Replace the entire `buildSearchCriteria` function body (from line 42 to line 146) with:

```typescript
export function buildSearchCriteria(
  params: SearchParams,
): Record<string, unknown> | Record<string, unknown>[] {
  const baseCriteria: Record<string, unknown> = {};
  const tokenizedCriteria: Record<string, unknown>[] = [];

  // Address fields → base criteria (no tokenization)
  const addressFields = ["from", "to", "cc", "bcc"] as const;
  for (const field of addressFields) {
    const value = params[field];
    if (value === undefined) continue;
    baseCriteria[field] = value;
  }

  // Date filters → base criteria
  if (params.since !== undefined) {
    baseCriteria.since = new Date(params.since);
  }
  if (params.before !== undefined) {
    baseCriteria.before = new Date(params.before);
  }

  // Boolean flags → base criteria
  if (params.unread !== undefined) {
    baseCriteria.seen = !params.unread;
  }
  if (params.flagged !== undefined) {
    baseCriteria.flagged = params.flagged;
  }

  // Attachment filter → base criteria
  if (params.hasAttachment === true) {
    baseCriteria.header = { "content-type": "multipart/mixed" };
  }

  // Tags → base criteria (each tag is a separate criterion, but they don't
  // produce duplicate keys unless there are multiple tags)
  if (params.tags !== undefined) {
    if (params.tags.length === 1) {
      baseCriteria.keyword = params.tags[0];
    } else {
      // Multiple tags need to be tokenized criteria to avoid key collision
      for (const tag of params.tags) {
        tokenizedCriteria.push({ keyword: tag });
      }
    }
  }

  // Tokenized fields → subject/body/hasWords with NOT support
  const tokenizedFields: Array<{ param: keyof SearchParams; imapKey: string }> = [
    { param: "subject", imapKey: "subject" },
    { param: "body", imapKey: "body" },
    { param: "hasWords", imapKey: "text" },
  ];
  for (const { param, imapKey } of tokenizedFields) {
    const value = params[param] as string | undefined;
    if (value === undefined) continue;
    const tokens = parseTokens(value);
    for (const token of tokens) {
      if (token.negated) {
        tokenizedCriteria.push({ not: { [imapKey]: token.value } });
      } else {
        tokenizedCriteria.push({ [imapKey]: token.value });
      }
    }
  }

  // No criteria at all → match all
  const hasBase = Object.keys(baseCriteria).length > 0;
  if (!hasBase && tokenizedCriteria.length === 0) {
    return { all: true };
  }

  // Base only, no tokenized → return merged base
  if (tokenizedCriteria.length === 0) {
    return baseCriteria;
  }

  // Tokenized only, no base → check for duplicates
  if (!hasBase) {
    if (tokenizedCriteria.length === 1) {
      return tokenizedCriteria[0];
    }
    return tokenizedCriteria;
  }

  // Both base and tokenized → fold base into each tokenized criterion
  return tokenizedCriteria.map((tc) => ({ ...baseCriteria, ...tc }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/search.test.ts`
Expected: All tests PASS

Note: The existing test `"combines multiple params with AND"` (line 116) tests base-only criteria (from + unread + since) and should still pass since base-only criteria are merged into a single object.

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/search.ts packages/email-mcp/src/__tests__/search.test.ts
git commit -m "perf(email-mcp): fold base criteria into each tokenized IMAP SEARCH call"
```

---

### Task 3: Update ImapService to leverage base criteria folding + tests

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts:97-117`
- Modify: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Write failing test for base criteria folding in IMAP SEARCH**

Add to the `searchEmails` describe block in `ImapService.test.ts`:

```typescript
    it("folds base criteria into each IMAP SEARCH call for tokenized fields", async () => {
      // First search: from + subject "dinner" → UIDs [101, 102]
      mockSearch.mockResolvedValueOnce([101, 102]);
      // Second search: from + subject "movie" → UIDs [102, 103]
      mockSearch.mockResolvedValueOnce([102, 103]);

      const messages = [
        {
          uid: 102,
          envelope: {
            messageId: "<msg-102@test.com>",
            subject: "Dinner and a movie",
            from: [{ address: "alice@test.com", name: "Alice" }],
            to: [{ address: "b@test.com", name: "B" }],
            date: new Date("2026-03-04"),
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

      const results = await service.searchEmails("INBOX", {
        from: "alice@test.com",
        subject: "dinner movie",
      });

      // Should have called search twice — each with from folded in
      expect(mockSearch).toHaveBeenCalledTimes(2);
      expect(mockSearch).toHaveBeenCalledWith(
        { from: "alice@test.com", subject: "dinner" },
        { uid: true },
      );
      expect(mockSearch).toHaveBeenCalledWith(
        { from: "alice@test.com", subject: "movie" },
        { uid: true },
      );

      // Intersection: only UID 102
      expect(results).toHaveLength(1);
      expect(results[0].uid).toBe(102);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: FAIL (current code sends `from` and `subject` as separate SEARCH calls, not folded)

Note: This test may already pass if `buildSearchCriteria` now returns the folded array correctly and `ImapService` already handles arrays. Verify by running — if it passes, great, the refactoring in Task 2 was sufficient.

- [ ] **Step 3: Verify ImapService handles the new criteria shape**

The existing ImapService code at lines 102-117 already handles both single objects and arrays from `buildSearchCriteria`. With base criteria folding, `buildSearchCriteria` returns an array where each element has the base criteria merged in. The IMAP SEARCH intersection logic should work correctly because each search call now includes the base filters, returning narrower UID sets.

If the test passes, no ImapService changes are needed — the folding is handled entirely in `buildSearchCriteria`. If it fails, check that the array handling at line 102-113 correctly processes the folded criteria.

- [ ] **Step 4: Run full email-mcp tests**

Run: `cd packages/email-mcp && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "test(email-mcp): verify base criteria folding in IMAP SEARCH calls"
```

---

## Chunk 3: Tool Schema and Handler Update

### Task 4: Replace query with hasWords in tool schema and handler + tests

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts:10-94,349-364`
- Modify: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Write failing test**

In `emailTools.test.ts`, update the `"search_emails has structured search params"` test. Replace:

```typescript
    expect(props).toHaveProperty("query");
```

With:

```typescript
    expect(props).toHaveProperty("hasWords");
    expect(props).not.toHaveProperty("query");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: FAIL — `hasWords` not in schema, `query` still present

- [ ] **Step 3: Update tool schema**

In `emailTools.ts`, replace the `query` property (lines 46-50):

```typescript
        query: {
          type: "string",
          description:
            'Advanced: search across subject and body with boolean logic. Supports -term for exclusion. Examples: "budget", "dinner -movie".',
        },
```

With:

```typescript
        hasWords: {
          type: "string",
          description:
            'Search all message content (headers + body, IMAP TEXT). Multiple words are ANDed. Use quotes for exact phrase. Use -term for exclusion. Examples: "budget", "report -draft", \'"quarterly report"\'.',
        },
```

Also update the `subject` and `body` descriptions to mention NOT support:

```typescript
        subject: {
          type: "string",
          description:
            "Search subject line. Multiple words are ANDed. Use -term to exclude. Use quotes for exact phrase: '\"weekly report\"'.",
        },
```

```typescript
        body: {
          type: "string",
          description:
            "Search body text. Multiple words are ANDed. Use -term to exclude. Use quotes for exact phrase: '\"project update\"'.",
        },
```

- [ ] **Step 4: Update handler wiring**

In the `search_emails` handler (around line 350), replace:

```typescript
          query: args.query as string | undefined,
          body: args.body as string | undefined,
```

With:

```typescript
          hasWords: args.hasWords as string | undefined,
          body: args.body as string | undefined,
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/email-mcp && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): replace query with hasWords in search_emails tool schema"
```

---

## Chunk 4: Final Verification

### Task 5: Final verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors (fix any formatting issues with `npm run format`)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Build all packages**

Run: `npm run build`
Expected: clean build
