# search_emails North Star Spec

**Status:** Partially implemented (email-mcp@0.6.0 — sort, tokenized search, NOT prefix)

> This is the target spec for the fully-featured search_emails tool.
> We iterate toward this incrementally. See roadmap at the bottom.

## search_emails Tool Specification

### Structured Filters

All structured filters are AND'd together at the IMAP SEARCH level.

| Param | Type | Behavior |
|-------|------|----------|
| `from` | string | Literal substring match on sender |
| `to` | string | Literal substring match on recipient |
| `cc` | string | Literal substring match |
| `bcc` | string | Literal substring match |
| `since` | date | Emails on or after this date |
| `before` | date | Emails before this date |
| `unread` | boolean | UNSEEN flag |
| `flagged` | boolean | FLAGGED flag |
| `hasAttachment` | boolean | Header/structure match |
| `tags` | string[] | KEYWORD per tag, all AND'd |

### Tokenized Search Fields

All three share identical tokenization rules, differing only in which IMAP search key they target.

| Param | Type | IMAP Key | Scope |
|-------|------|----------|-------|
| `subject` | string | SUBJECT | Subject line only |
| `body` | string | BODY | Message body only |
| `hasWords` | string | TEXT | Headers + body (everything) |

Tokenization rules:
- Whitespace splits into tokens, AND across tokens
- `"quoted phrases"` preserved as single token, no split
- `-` prefix on token/phrase → NOT

Examples:

```
"update meeting"          → TERM "update" TERM "meeting"  (AND)
"update -cancelled"       → TERM "update" NOT TERM "cancelled"
"\"budget report\""       → TERM "budget report"  (exact phrase)
"\"budget report\" -old"  → TERM "budget report" NOT TERM "old"
```

Where TERM maps to the field's IMAP key:

```
subject: "update -cancelled"
  → SUBJECT "update" NOT SUBJECT "cancelled"
body: "update -cancelled"
  → BODY "update" NOT BODY "cancelled"
hasWords: "update -cancelled"
  → TEXT "update" NOT TEXT "cancelled"
```

### Sort

| Param | Type | Default |
|-------|------|---------|
| `sortBy` | enum: date, from, subject | date |
| `sortOrder` | enum: asc, desc | desc |

Implementation: in-memory sort on fetched envelopes. IMAP SORT (RFC 5256) deferred — imapflow doesn't expose it.

### Pagination

| Param | Type | Default |
|-------|------|---------|
| `limit` | integer | 50 |
| `offset` | integer | 0 |

### Search Algorithm

**Step 1: Build Criteria**
- Structured filters → direct IMAP SEARCH keys
- Tokenized fields (subject, body, hasWords) → parse into tokens/phrases, one IMAP criterion per token per field
- All groups AND'd together at top level

**Step 1.5: Base Criteria Folding**

When tokenization produces duplicate keys that require multiple IMAP SEARCH calls, the structured filters (from, to, cc, bcc, since, before, unread, flagged, hasAttachment, tags) are folded into EVERY call as base criteria.

Example: `from:"alice" subject:"update meeting"`

```
Call 1: FROM "alice" SUBJECT "update"   → UID set A
Call 2: FROM "alice" SUBJECT "meeting"  → UID set B
Result: A ∩ B
```

Without folding:

```
Call 1: SUBJECT "update"   → UID set A  (missing base filter)
Call 2: SUBJECT "meeting"  → UID set B
Result: A ∩ B             (would include non-Alice emails)
```

This ensures the intersection only contains emails that satisfy ALL structured filters AND all tokenized terms. Without folding, the intersection could include false positives — emails matching the tokenized terms but not the sender/date/flag constraints.

**Step 2: IMAP SEARCH**
- Single criteria object → one SEARCH call
- Multiple calls needed (duplicate keys from tokenization) → multiple SEARCH calls, intersect resulting UID sets

**Step 3: Sort + Paginate (tiered by result set size)**

Tier 1 (≤1000 UIDs):
1. Fetch envelopes for ALL UIDs
2. Sort entire list by sortBy + sortOrder in memory
3. Slice at offset/limit
4. Accurate sort, cost is up to 1000 envelope fetches

Tier 2 (>1000 UIDs):
1. Reverse UID array (UIDs ≈ chronological, reverse ≈ newest-first)
2. Slice first at offset/limit (fetch only the page)
3. Fetch envelopes for the slice
4. Sort the slice by sortBy + sortOrder
5. Fast, approximate — "roughly the newest N, sorted within page"
6. sortBy other than date is best-effort in this tier

## Roadmap

1. ~~**Sort params** (Iteration 1) — `sortBy` + `sortOrder`~~ ✅ shipped in email-mcp@0.5.0
2. **Tokenized search with NOT + hasWords** — unified tokenization for subject/body/hasWords, `-prefix` negation, replace `query` field with `hasWords`
3. **Base criteria folding** — fold non-tokenized fields into each IMAP SEARCH call
4. **IMAP SORT (RFC 5256)** — capability detection + raw SORT command when server supports it
