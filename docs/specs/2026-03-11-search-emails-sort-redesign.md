# search_emails: IMAP SORT + Structured Params Redesign

## Summary

Redesign the `list_emails` tool (renamed `search_emails`) with two improvements:
1. Server-side SORT via RFC 5256 with tiered fallback
2. Structured search parameters instead of query-string syntax

## Motivation

- `list_emails` returned results in UID order (oldest first), confusing for users
- Date sorting was done on a sliced page of UIDs, producing incorrect ordering
- Query-string syntax (`from:x subject:"y z" is:unread`) is error-prone for LLMs — structured params are more reliable
- String search params need to support both keyword matching (`dinner movie` → both words must appear) and exact phrase matching (`"dinner movie"` → exact substring)

## Tool Rename

`list_emails` → `search_emails`

All references in tool schema, handler switch, tests, and documentation updated.

## search_emails Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `folder` | string | no | `"INBOX"` | IMAP folder path (e.g. `"Archive/2026"`) |
| `query` | string | no | — | Search subject + body. Catch-all "search everywhere" field. |
| `body` | string | no | — | Search body text only |
| `from` | string | no | — | Match sender (name or email address) |
| `to` | string | no | — | Match recipient (name or email address) |
| `cc` | string | no | — | Match CC recipient |
| `bcc` | string | no | — | Match BCC recipient |
| `subject` | string | no | — | Match subject line |
| `since` | string | no | — | Emails on or after this ISO date (YYYY-MM-DD) |
| `before` | string | no | — | Emails before this ISO date (YYYY-MM-DD) |
| `unread` | boolean | no | — | Filter by unread status |
| `flagged` | boolean | no | — | Filter by flagged status |
| `hasAttachment` | boolean | no | — | Filter by attachment presence |
| `tags` | string[] | no | — | Filter by IMAP keyword flags |
| `limit` | number | no | `50` | Max results to return |
| `offset` | number | no | `0` | Skip N results for pagination |

### Filter behavior

- All filters combine with **AND** logic
- String search params support two modes:
  - **Keyword matching** (no quotes): `dinner movie` → IMAP `SUBJECT "dinner" SUBJECT "movie"` — both words must appear, any order
  - **Exact phrase** (with quotes): `"dinner movie"` → IMAP `SUBJECT "dinner movie"` — exact substring match
- `query` param searches both subject and body: emits `OR (SUBJECT "x") (BODY "x")` for each term
- `-term` exclusion in `query`: `dinner -movie` → `BODY "dinner" NOT BODY "movie"`
- `from`, `to`, `cc`, `bcc` match against the full header (display name + email address)

## Sort Strategy: Tiered Approach

### Tier 1: Server-side SORT (RFC 5256)

Check IMAP CAPABILITY for `SORT`. If supported:

```
SORT (REVERSE DATE) UTF-8 <criteria>
```

Server returns UIDs pre-sorted by date descending. Paginate directly with `offset`/`limit` on the sorted UID array. This is correct and efficient regardless of mailbox size.

### Tier 2: Local sort for small result sets

If SORT not supported and search returns <= 1000 UIDs:

1. `SEARCH` with criteria → get all matching UIDs
2. Fetch envelopes (date only needed for sorting) for all UIDs
3. Sort locally by date descending
4. Paginate with `offset`/`limit`
5. Fetch full envelope data for the paginated slice

Correct sorting at the cost of fetching up to 1000 envelopes. Envelopes are lightweight (no body content).

### Tier 3: UID approximation for large result sets

If SORT not supported and search returns > 1000 UIDs:

1. `SEARCH` with criteria → get all matching UIDs
2. Reverse UID array (higher UIDs ≈ newer)
3. Slice with `offset`/`limit`
4. Fetch envelopes for the slice
5. Sort the slice by date

Approximate ordering — UIDs generally correlate with arrival time but not guaranteed. Acceptable trade-off for very large mailboxes without SORT support.

## Search Criteria Builder

Replace `parseSearchQuery()` with `buildSearchCriteria()` that maps structured params directly to imapflow search objects:

```typescript
interface SearchParams {
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

function buildSearchCriteria(params: SearchParams): Record<string, unknown> {
  // from: "miguel" → { from: "miguel" }
  // from: "dinner movie" → AND({ from: "dinner" }, { from: "movie" })
  // from: '"dinner movie"' → { from: "dinner movie" }
  // to → { to: "value" }
  // cc → { cc: "value" }
  // bcc → { bcc: "value" }
  // subject: "meeting" → { subject: "meeting" }
  // body: "report" → { body: "report" }
  // query: "budget" → OR({ subject: "budget" }, { body: "budget" })
  // query: "-spam" → NOT({ body: "spam" })
  // since → { since: new Date("value") }
  // before → { before: new Date("value") }
  // unread: true → { seen: false }
  // unread: false → { seen: true }
  // flagged: true → { flagged: true }
  // flagged: false → { flagged: false }
  // hasAttachment → header Content-Type contains "multipart/mixed" or post-filter
  // tags: ["work"] → { keyword: "work" }
  // tags: ["work", "urgent"] → AND({ keyword: "work" }, { keyword: "urgent" })
  // empty params → { all: true }
}
```

## Files Changed

- `packages/email-mcp/src/services/ImapService.ts` — sort strategy, new SearchParams interface, SORT capability check
- `packages/email-mcp/src/tools/emailTools.ts` — rename tool to `search_emails`, structured params schema, update handler
- `packages/email-mcp/src/search.ts` — replace `parseSearchQuery` with `buildSearchCriteria`
- `packages/email-mcp/src/__tests__/ImapService.test.ts` — tests for each sort tier (SORT capability, local sort, UID fallback)
- `packages/email-mcp/src/__tests__/emailTools.test.ts` — rename assertions, new param validation
- `packages/email-mcp/src/__tests__/search.test.ts` — criteria builder tests (keyword splitting, exact phrase, exclusion, combined filters)
- External PRD and architecture doc — update tool name and params

## Not In Scope

- Caching (deferred — sort strategy makes it less urgent)
- OR query operator (LLMs can issue multiple queries)
- `get_email_thread` or `create_draft` (separate features)
- `filename:` search (no native IMAP support, would require BODYSTRUCTURE fetch + local filter)
- Relative date expressions (`older_than: 3d`) — LLM can compute ISO dates
- Changes to other email tools
