# email-mcp: search_emails Sort Parameters

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable `sortBy` (date/from/subject) and `sortOrder` (asc/desc) parameters to `search_emails`, replacing the hardcoded date-descending sort.

**Architecture:** Add `sortBy`/`sortOrder` to `SearchOptions`, extract a `compareSummaries` helper function, replace hardcoded sort in both tiers, wire through handler and tool schema.

**Tech Stack:** TypeScript, imapflow, vitest

**Spec:** `docs/superpowers/specs/2026-03-17-email-search-sort-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/email-mcp/src/services/ImapService.ts` | Modify:43-46,119-132 | Add sortBy/sortOrder to SearchOptions, extract compareSummaries, update both tiers |
| `packages/email-mcp/src/tools/emailTools.ts` | Modify:8-86,339-362 | Add sortBy/sortOrder to tool schema + handler wiring |
| `packages/email-mcp/src/__tests__/ImapService.test.ts` | Modify | New sort tests |
| `packages/email-mcp/src/__tests__/emailTools.test.ts` | Modify | Test tool schema has new properties |

---

## Task 1: Add sortBy/sortOrder to SearchOptions and extract compareSummaries

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts:43-46`
- Modify: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Write failing tests for sort options**

Add these tests inside the `searchEmails` describe block in `ImapService.test.ts`:

```typescript
    it("sorts by date ascending when sortOrder is asc", async () => {
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

      const results = await service.searchEmails("INBOX", {}, { limit: 10, sortOrder: "asc" });
      expect(results[0].subject).toBe("Old");
      expect(results[1].subject).toBe("Middle");
      expect(results[2].subject).toBe("Newest");
    });

    it("sorts by from name (case-insensitive)", async () => {
      mockSearch.mockResolvedValueOnce([101, 102, 103]);

      const messages = [
        {
          uid: 101,
          envelope: {
            messageId: "<msg-101@test.com>",
            subject: "From Charlie",
            from: [{ address: "charlie@test.com", name: "Charlie" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-01"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 102,
          envelope: {
            messageId: "<msg-102@test.com>",
            subject: "From alice",
            from: [{ address: "alice@test.com", name: "alice" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-02"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 103,
          envelope: {
            messageId: "<msg-103@test.com>",
            subject: "From Bob",
            from: [{ address: "bob@test.com", name: "Bob" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-03"),
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

      const results = await service.searchEmails(
        "INBOX",
        {},
        { limit: 10, sortBy: "from", sortOrder: "asc" },
      );
      expect(results[0].subject).toBe("From alice");
      expect(results[1].subject).toBe("From Bob");
      expect(results[2].subject).toBe("From Charlie");
    });

    it("sorts by from address when name is undefined", async () => {
      mockSearch.mockResolvedValueOnce([101, 102]);

      const messages = [
        {
          uid: 101,
          envelope: {
            messageId: "<msg-101@test.com>",
            subject: "No name",
            from: [{ address: "zoe@test.com" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-01"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 102,
          envelope: {
            messageId: "<msg-102@test.com>",
            subject: "Has name",
            from: [{ address: "alice@test.com", name: "Alice" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-02"),
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

      const results = await service.searchEmails(
        "INBOX",
        {},
        { limit: 10, sortBy: "from", sortOrder: "asc" },
      );
      expect(results[0].subject).toBe("Has name");
      expect(results[1].subject).toBe("No name");
    });

    it("sorts by subject (case-insensitive)", async () => {
      mockSearch.mockResolvedValueOnce([101, 102, 103]);

      const messages = [
        {
          uid: 101,
          envelope: {
            messageId: "<msg-101@test.com>",
            subject: "Zulu",
            from: [{ address: "a@test.com", name: "A" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-01"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 102,
          envelope: {
            messageId: "<msg-102@test.com>",
            subject: "alpha",
            from: [{ address: "b@test.com", name: "B" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-02"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 103,
          envelope: {
            messageId: "<msg-103@test.com>",
            subject: "Bravo",
            from: [{ address: "c@test.com", name: "C" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-03"),
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

      const results = await service.searchEmails(
        "INBOX",
        {},
        { limit: 10, sortBy: "subject", sortOrder: "asc" },
      );
      expect(results[0].subject).toBe("alpha");
      expect(results[1].subject).toBe("Bravo");
      expect(results[2].subject).toBe("Zulu");
    });
```

Also add a Tier 2 (>1000 UIDs) test to verify sort applies within the page:

```typescript
    it("Tier 2: sorts within page when >1000 UIDs with non-date sortBy", async () => {
      const allUids = Array.from({ length: 1500 }, (_, i) => i + 1);
      mockSearch.mockResolvedValueOnce(allUids);

      const fetchedMessages = [
        {
          uid: 1500,
          envelope: {
            messageId: "<msg-1500@test.com>",
            subject: "Zulu",
            from: [{ address: "z@test.com", name: "Zoe" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-05"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
        {
          uid: 1499,
          envelope: {
            messageId: "<msg-1499@test.com>",
            subject: "Alpha",
            from: [{ address: "a@test.com", name: "Alice" }],
            to: [{ address: "x@test.com", name: "X" }],
            date: new Date("2026-03-10"),
          },
          flags: new Set([]),
          bodyStructure: { type: "text/plain" },
        },
      ];
      mockFetch.mockReturnValueOnce(
        (async function* () {
          for (const msg of fetchedMessages) yield msg;
        })(),
      );

      const results = await service.searchEmails(
        "INBOX",
        {},
        { limit: 2, offset: 0, sortBy: "subject", sortOrder: "asc" },
      );

      expect(results).toHaveLength(2);
      expect(results[0].subject).toBe("Alpha");
      expect(results[1].subject).toBe("Zulu");
    });
```

Also update the existing Tier 3 test description (line 287) from `"Tier 3: fetches only the paginated slice when >1000 UIDs are returned"` to `"Tier 2: fetches only the paginated slice when >1000 UIDs are returned"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: 5 new tests FAIL (SearchOptions doesn't have sortBy/sortOrder)

- [ ] **Step 3: Update SearchOptions and implement compareSummaries**

In `ImapService.ts`, replace the `SearchOptions` interface (lines 43-46):

```typescript
export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: "date" | "from" | "subject";
  sortOrder?: "asc" | "desc";
}
```

Add the `compareSummaries` function between the closing `}` of the `ImapService` class (line 385) and the `hasAttachmentParts` function (line 387):

```typescript
function compareSummaries(
  a: EmailSummary,
  b: EmailSummary,
  sortBy: "date" | "from" | "subject",
  sortOrder: "asc" | "desc",
): number {
  const direction = sortOrder === "desc" ? -1 : 1;

  switch (sortBy) {
    case "from": {
      const aKey = a.from.name ?? a.from.address;
      const bKey = b.from.name ?? b.from.address;
      return direction * aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    }
    case "subject":
      return direction * a.subject.localeCompare(b.subject, undefined, { sensitivity: "base" });
    case "date":
    default: {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      const aVal = Number.isNaN(aTime) ? 0 : aTime;
      const bVal = Number.isNaN(bTime) ? 0 : bTime;
      return direction * (aVal - bVal);
    }
  }
}
```

- [ ] **Step 4: Update both tiers to use compareSummaries**

Replace lines 119-132 in `searchEmails` (this also renames the tier comments from Tier 2/3 to Tier 1/2):

```typescript
        const offset = options.offset ?? 0;
        const limit = options.limit ?? 50;
        const sortBy = options.sortBy ?? "date";
        const sortOrder = options.sortOrder ?? "desc";

        if (uids.length <= 1000) {
          // Tier 1: fetch all envelopes, sort, paginate
          const allSummaries = await this.fetchSummaries(client, uids);
          allSummaries.sort((a, b) => compareSummaries(a, b, sortBy, sortOrder));
          return allSummaries.slice(offset, offset + limit);
        }
        // Tier 2: reverse UIDs (approximate newest-first), slice, fetch, sort page
        // Note: for non-date sortBy, sort is best-effort (within page only)
        uids.reverse();
        const fetchUids = uids.slice(offset, offset + limit);
        const summaries = await this.fetchSummaries(client, fetchUids);
        return summaries.sort((a, b) => compareSummaries(a, b, sortBy, sortOrder));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: All tests PASS (including existing tests — default behavior unchanged)

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): add sortBy/sortOrder to search_emails with compareSummaries helper"
```

---

## Task 2: Update tool schema and handler wiring

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts:8-86,339-362`
- Modify: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Write failing test for new schema properties**

Add to the `search_emails has structured search params` test (line 51) in `emailTools.test.ts`, after the existing expects:

```typescript
    expect(props).toHaveProperty("sortBy");
    expect(props).toHaveProperty("sortOrder");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: FAIL — `sortBy` and `sortOrder` not in schema

- [ ] **Step 3: Add sortBy/sortOrder to tool schema**

In `emailTools.ts`, add these properties after the `offset` property (after line 83, inside the `search_emails` tool's `properties` object):

```typescript
        sortBy: {
          type: "string",
          enum: ["date", "from", "subject"],
          description: "Sort field. Defaults to date.",
        },
        sortOrder: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction. Defaults to desc (newest first for date).",
        },
```

Update the tool description (line 12) to:

```typescript
      "Search and list emails in a folder. Returns email summaries with configurable sorting (default: date descending). All filters combine with AND logic. Use the dedicated fields (subject, from, to, etc.) for most searches. Note: for result sets >1000, non-date sort fields are approximate (sorted within page only).",
```

- [ ] **Step 4: Update handler wiring**

In the `search_emails` case (lines 355-360), replace:

```typescript
        const limit = (args.limit as number) || 50;
        const offset = (args.offset as number) || 0;
        const emails = await imapService.searchEmails(folder, searchParams, {
          limit,
          offset,
        });
```

With:

```typescript
        const limit = (args.limit as number) || 50;
        const offset = (args.offset as number) || 0;
        const sortBy = (args.sortBy as string | undefined) ?? "date";
        const sortOrder = (args.sortOrder as string | undefined) ?? "desc";
        const emails = await imapService.searchEmails(folder, searchParams, {
          limit,
          offset,
          sortBy: sortBy as "date" | "from" | "subject",
          sortOrder: sortOrder as "asc" | "desc",
        });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run`
Expected: All email-mcp tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): add sortBy/sortOrder to search_emails tool schema and handler"
```

---

## Task 3: Final verification

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
