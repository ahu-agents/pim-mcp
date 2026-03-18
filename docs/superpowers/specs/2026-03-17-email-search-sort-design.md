# email-mcp: search_emails Sort Parameters

> **Iteration 1** of the search_emails improvements roadmap.
> North star spec: `docs/specs/search-emails-north-star.md` (future)

## Goal

Add configurable `sortBy` and `sortOrder` parameters to `search_emails`, replacing the hardcoded date-descending sort. No changes to query parsing, search criteria building, or IMAP SEARCH behavior.

## Current Behavior

`searchEmails` sorts results by date descending in both tiers (code comments label these Tier 2 and Tier 3; we rename to Tier 1/2 here since the original Tier 1 — IMAP SORT — was deferred):

- **Tier 1 (≤1000 UIDs):** Fetch all envelopes → sort by date desc → slice for pagination
- **Tier 2 (>1000 UIDs):** Reverse UIDs (approximate newest-first) → slice → fetch page → sort page by date desc

The sort field and direction are hardcoded at `ImapService.ts:125` and `ImapService.ts:132`. Update the in-code tier comments to match the 1/2 naming.

## Design

### New Parameters

Add `sortBy` and `sortOrder` to `SearchOptions`:

```typescript
export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: "date" | "from" | "subject";   // default: "date"
  sortOrder?: "asc" | "desc";              // default: "desc"
}
```

### Tool Schema Update

Add to the `search_emails` tool definition in `emailTools.ts`:

```
sortBy:    enum ["date", "from", "subject"]  — Sort field (default: date)
sortOrder: enum ["asc", "desc"]              — Sort direction (default: desc)
```

Update the tool description to mention configurable sorting.

### Sort Implementation

Extract sorting into a standalone comparison function in `ImapService.ts`:

```typescript
function compareSummaries(
  a: EmailSummary,
  b: EmailSummary,
  sortBy: "date" | "from" | "subject",
  sortOrder: "asc" | "desc",
): number
```

Sort key extraction per field:
- `date` → `new Date(msg.date).getTime()`, guarding against empty/invalid dates: if `isNaN`, treat as `0` (sorts to end for desc, start for asc)
- `from` → `msg.from.name ?? msg.from.address` (note: `name` can be `undefined` from IMAP envelopes, so the `??` fallback to address is intentional)
- `subject` → `msg.subject`

String comparison: use `a.localeCompare(b, undefined, { sensitivity: "base" })` for case-insensitive, locale-aware ordering.

Direction: multiply the comparator result by `sortOrder === "desc" ? -1 : 1`.

Fall back to `date` comparison for any unrecognized `sortBy` value (defensive).

### Tier Behavior

**Tier 1 (≤1000 UIDs):** Replace hardcoded date sort with `compareSummaries` using the provided `sortBy`/`sortOrder`. Accurate sort across entire result set.

**Tier 2 (>1000 UIDs):** UID reversal still approximates newest-first for the pre-slice. Then sort the fetched page with `compareSummaries`.

**Known limitation for Tier 2:** When `sortBy` is `"from"` or `"subject"`, both the sort and pagination (`offset`) only apply within the UID-order pre-sliced page. The results are effectively an arbitrary sample sorted within that page — not a globally sorted view. For `sortBy: "date"`, UID ordering provides a reasonable approximation. This limitation should be documented in the tool description.

### Handler Wiring

In `emailTools.ts`, pass `sortBy` and `sortOrder` from `args` to `searchEmails` options. The handler defaults match `SearchOptions` defaults:

```typescript
const emails = await imapService.searchEmails(folder, searchParams, {
  limit,
  offset,
  sortBy: (args.sortBy as string | undefined) ?? "date",
  sortOrder: (args.sortOrder as string | undefined) ?? "desc",
});
```

## Files Changed

| File | Change |
|------|--------|
| `packages/email-mcp/src/services/ImapService.ts` | Add `sortBy`/`sortOrder` to `SearchOptions` interface; extract `compareSummaries` helper; replace hardcoded sort in both tiers; update tier comments to 1/2 naming |
| `packages/email-mcp/src/tools/emailTools.ts` | Add `sortBy`/`sortOrder` to tool schema + handler wiring |
| `packages/email-mcp/src/__tests__/ImapService.test.ts` | Tests for sort by date asc, from, subject; from fallback (name undefined); both tiers |
| `packages/email-mcp/src/__tests__/emailTools.test.ts` | Test tool schema has new properties |

## Testing

- Default behavior unchanged (date desc) — existing tests should pass as-is
- Sort by date ascending
- Sort by from (alphabetical, case-insensitive)
- Sort by from with `name` undefined (falls back to address)
- Sort by subject (alphabetical, case-insensitive)
- Sort direction asc vs desc
- Tier 2 (>1000) sort applies within page

## Roadmap (Future Iterations)

1. **Tokenized search with NOT + hasWords** — unified tokenization for subject/body/hasWords, `-prefix` negation, replace `query` field with `hasWords` (IMAP TEXT)
2. **Base criteria folding** — fold non-tokenized fields into each IMAP SEARCH call
3. **IMAP SORT (RFC 5256)** — capability detection + raw SORT command when server supports it
