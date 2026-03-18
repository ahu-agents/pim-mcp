# search_emails North Star Spec

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
| `body` | string | Tokenized, AND across tokens (body only). Same tokenization rules as subject: whitespace splits → AND, "quoted phrases" → exact match, `-` prefix → NOT |
| `since` | date | Emails on or after this date |
| `before` | date | Emails before this date |
| `unread` | boolean | UNSEEN flag |
| `flagged` | boolean | FLAGGED flag |
| `hasAttachment` | boolean | Header/structure match |
| `tags` | string[] | KEYWORD per tag, all AND'd |

### Subject Search

`subject` (string) — Searched within subject field only.

Behavior (Gmail-like):
- Tokenized by whitespace, AND across tokens: `"update meeting"` → `SUBJECT "update" SUBJECT "meeting"` (email must contain BOTH words in subject)
- Quoted phrases preserved as single criterion: `"\"update meeting\""` → `SUBJECT "update meeting"` (exact phrase in subject)
- Negation with `-` prefix per token: `"update -cancelled"` → `SUBJECT "update" NOT SUBJECT "cancelled"`

### Advanced Query

`query` (string) — Boolean search across subject + body.

Default operator: AND (matches Gmail behavior).

Supported operators:
- `AND` — Implicit between tokens, or explicit
- `OR` — Union of terms
- `NOT` / `-` — Exclusion
- `"..."` — Exact phrase (no tokenization)
- `( )` — Grouping for precedence

Each resolved token/phrase expands to search both fields: `token "update"` → `OR SUBJECT "update" BODY "update"`

Cross-token combination maps to IMAP:
- AND → sequential criteria (IMAP implicit AND)
- OR → `OR( criterion, criterion )`
- NOT → `NOT( criterion )`

Examples:

```
"update meeting"
  → (OR SUBJECT "update" BODY "update")
    (OR SUBJECT "meeting" BODY "meeting")
  → emails containing both words, each anywhere in subject or body

"update OR meeting"
  → OR (OR SUBJECT "update" BODY "update")
       (OR SUBJECT "meeting" BODY "meeting")
  → emails containing either word

"(update OR sync) NOT cancelled"
  → OR (OR SUBJECT "update" BODY "update")
        (OR SUBJECT "sync" BODY "sync")
    NOT (OR SUBJECT "cancelled" BODY "cancelled")

"\"budget report\""
  → OR SUBJECT "budget report" BODY "budget report"
  → exact phrase match

"from:alice update OR meeting"
  → INVALID — use structured `from` param instead
  → query field is for content search only, not field operators
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
- subject → tokenize/parse, one SUBJECT key per token
- query → parse boolean expression tree, expand each leaf to OR(SUBJECT, BODY), map tree to IMAP criteria
- All three groups AND'd together at top level

**Step 1.5: Base Criteria Folding**

When tokenization produces duplicate keys that require multiple IMAP SEARCH calls, the structured filters (from, to, cc, bcc, since, before, unread, flagged, hasAttachment, tags) are folded into EVERY call as base criteria.

Example: `from:"alice" subject:"update meeting"`

```
Call 1: FROM "alice" SUBJECT "update"   → UID set A
Call 2: FROM "alice" SUBJECT "meeting"  → UID set B
Result: A ∩ B
```

Without folding, each call returns a broader set that may include non-Alice emails, leading to false positives in the intersection.

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

### Query Parser

```
Input:  "(update OR sync) NOT cancelled"

Tokenizer output:
  LPAREN, WORD("update"), OR, WORD("sync"), RPAREN,
  NOT, WORD("cancelled")

Parse tree:
  AND(
    OR( WORD("update"), WORD("sync") ),
    NOT( WORD("cancelled") )
  )

IMAP expansion (each WORD → OR SUBJECT BODY):
  AND(
    OR(
      OR(SUBJECT "update", BODY "update"),
      OR(SUBJECT "sync", BODY "sync")
    ),
    NOT(
      OR(SUBJECT "cancelled", BODY "cancelled")
    )
  )
```

Tokenizer rules:
- Whitespace between non-operator tokens → implicit AND
- `"quoted string"` → single PHRASE token, no split
- `-` prefix on token → NOT(token)
- AND, OR, NOT → operators (case-insensitive match)
- `( )` → grouping

## Roadmap

1. **Sort params** (Iteration 1) — `sortBy` + `sortOrder` ← current
2. **NOT support for subject/body** — `-prefix` negation in tokenized fields
3. **Base criteria folding** — fold non-tokenized fields into each IMAP SEARCH call
4. **Boolean query parser** — AND, OR, NOT, `()` grouping for `query` field
5. **IMAP SORT (RFC 5256)** — capability detection + raw SORT command when server supports it
