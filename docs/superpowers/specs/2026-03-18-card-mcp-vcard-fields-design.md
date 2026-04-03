# card-mcp: Expanded vCard Fields & Data-Loss Fix

**Date:** 2026-03-18
**Package:** `@miguelarios/card-mcp` + `@miguelarios/pim-core`
**Status:** Implemented (pim-core@0.4.0, card-mcp@0.2.0)

## Problem

`parseVCard` only extracts 8 properties (UID, FN, N, EMAIL, TEL, ORG, TITLE, NOTE). All other vCard properties — ADR, URL, BDAY, NICKNAME, CATEGORIES, ROLE, PHOTO, X-* — are silently dropped.

This is a **data-loss bug**: `updateContact` does fetch → `parseVCard` → merge → `buildVCard` → save. Any property not in the known set is permanently deleted from the contact on the server.

## Solution

Three complementary changes:

1. **Typed objects** for emails, phones, addresses, and URLs — preserving TYPE parameter info
2. **New structured fields** for commonly useful properties (addresses, urls, role, nickname, birthday, categories)
3. **Raw pass-through** (`otherProperties`) for everything else — visible in output, preserved on round-trip

## Contact Interface

```typescript
export interface TypedValue {
  type?: string;  // "home", "work", "cell", etc. — lowercased
  value: string;
}

export interface PostalAddress {
  type?: string;       // "home", "work", etc. — lowercased
  street?: string;     // ADR component 2 (+ PO Box/Extended folded in if present)
  city?: string;       // ADR component 3
  state?: string;      // ADR component 4
  postalCode?: string; // ADR component 5
  country?: string;    // ADR component 6
}

export interface Contact {
  uid: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  emails: TypedValue[];        // BREAKING: was string[]
  phones: TypedValue[];        // BREAKING: was string[]
  addresses: PostalAddress[];  // NEW — ADR
  urls: TypedValue[];          // NEW — URL
  organization?: string;       // flat string, first ORG component only
  title?: string;
  role?: string;               // NEW — ROLE
  nickname?: string;           // NEW — NICKNAME
  birthday?: string;           // NEW — BDAY (YYYY-MM-DD)
  categories?: string[];       // NEW — CATEGORIES (comma-separated → array)
  note?: string;
  otherProperties: string[];   // NEW — raw vCard lines for unknown properties
}
```

### Breaking Changes

- `emails` and `phones` change from `string[]` to `TypedValue[]`
- `addresses`, `urls`, and `otherProperties` are new required (non-optional) array fields — all construction sites must supply `[]` as default
- All consumers must be updated: card-mcp tools, service layer, `CardDavService.resolveContact` (`.emails[0]` → `.emails[0].value`), and **all existing tests** including `packages/core/src/__tests__/vcard.test.ts`
- `TypedValue` and `PostalAddress` must be added to `pim-core/src/index.ts` exports

## Parser Changes (`parseVCard`)

### New helper: `extractTypedAll`

Extracts property value AND TYPE parameter from vCard lines:

```
TEL;TYPE=WORK:+1-555-0100    → { type: "work", value: "+1-555-0100" }
TEL:+1-555-0100              → { value: "+1-555-0100" }
EMAIL;TYPE=home:a@b.com   → { type: "home", value: "a@b.com" }
```

TYPE is lowercased for consistency. Used for EMAIL, TEL, and URL.

### New helper: `extractAddresses`

Parses ADR lines. ADR uses semicolon-delimited positional components:

```
ADR;TYPE=home:PO Box;Extended;Street;City;State;Zip;Country
         [0]    [1]    [2]   [3]   [4]  [5]  [6]
```

- Component 2 (`Street`) maps to `street`
- Components 0 (PO Box) and 1 (Extended): prepended to `street` if present (e.g., `"PO Box 100, Suite 2, 123 Main St"`)
- Components 3-6: mapped to `city`, `state`, `postalCode`, `country`
- TYPE extracted and lowercased

Pseudocode:
```typescript
const parts = value.split(";"); // 7 positional components
const streetParts = [parts[0], parts[1], parts[2]].filter(Boolean);
const street = streetParts.join(", ") || undefined;
const city = parts[3] || undefined;
const state = parts[4] || undefined;
const postalCode = parts[5] || undefined;
const country = parts[6] || undefined;
```

### ORG handling

`ORG:Acme Corp;Engineering;Platform` → `"Acme Corp"`

Split on `;`, take first component, trim. Matches iOS/Nextcloud Contacts behavior.

### CATEGORIES handling

`CATEGORIES:Friends,Family,VIP` → `["Friends", "Family", "VIP"]`

Split on `,`.

### BDAY handling

Extract value as-is. vCard BDAY is typically `YYYY-MM-DD` or `YYYYMMDD`.

### Raw pass-through

```typescript
const KNOWN = new Set([
  "BEGIN", "END", "VERSION", "UID", "FN", "N",
  "EMAIL", "TEL", "ORG", "TITLE", "NOTE", "ADR",
  "URL", "BDAY", "NICKNAME", "CATEGORIES", "ROLE",
]);

const otherProperties: string[] = [];
for (const line of lines) {
  const propName = line.split(/[:;]/)[0].toUpperCase();
  if (!KNOWN.has(propName) && line.trim()) {
    otherProperties.push(line);
  }
}
```

## Builder Changes (`buildVCard`)

- Emit `EMAIL;TYPE=work:foo@bar.com` when type is present, `EMAIL:foo@bar.com` when not
- Same pattern for TEL, URL
- Emit `ADR;TYPE=home:;;123 Main St;Denver;CO;80202;US` — reconstruct semicolon-delimited format
- Emit `ORG:value` (no trailing semicolons)
- Emit `ROLE:value`, `NICKNAME:value`, `BDAY:value`
- Emit `CATEGORIES:val1,val2,val3` (comma-joined)
- Append all `otherProperties` lines before `END:VCARD`

## Tool Schema Changes

### `create_contact` and `update_contact`

Updated input schemas:

- `emails`: `TypedValue[]` — e.g. `[{"type": "work", "value": "foo@bar.com"}]`
- `phones`: `TypedValue[]` — e.g. `[{"type": "cell", "value": "+1-555-0100"}]`
- `addresses`: `PostalAddress[]`
- `urls`: `TypedValue[]`
- `role`: `string`
- `nickname`: `string`
- `birthday`: `string` (YYYY-MM-DD)
- `categories`: `string[]`

`otherProperties` is NOT a tool input — only returned in output, preserved on round-trip via the service layer.

### `update_contact` merge logic

In `CardDavService.updateContact`:

```typescript
const merged: Contact = {
  ...current,
  fullName: updates.fullName ?? current.fullName,
  emails: updates.emails ?? current.emails,
  // ... same pattern for all fields ...
  otherProperties: current.otherProperties,  // always from existing
};
```

`otherProperties` always comes from the parsed existing contact, never from updates.

### `resolve_contact`

Return type unchanged: `{ fullName: string; email: string }`. Implementation change required: `contact.emails[0]` → `contact.emails[0].value` in `CardDavService.resolveContact`.

### `list_contacts` / `get_contact`

Return full `Contact` object including all new fields and `otherProperties`.

## Search Upgrade

### Current behavior

Single substring match — concatenate all fields, `.includes(query)`.

### New behavior: multi-term tokenized search

1. Split query on whitespace into tokens
2. Build searchable text from all Contact fields, extracting `.value` from typed fields:
   ```typescript
   const searchable = [
     c.fullName, c.firstName, c.lastName, c.organization, c.title,
     c.role, c.nickname, ...(c.categories ?? []),
     ...c.emails.map(e => e.value),
     ...c.phones.map(e => e.value),
     ...c.urls.map(u => u.value),
     ...c.addresses.map(a =>
       [a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(" ")
     ),
   ].filter(Boolean).join(" ").toLowerCase();
   ```
3. Contact matches if **all tokens** are found as substrings (AND semantics)

Examples:
- `"john work"` → matches contact where "john" in name AND "work" in email type, org, address, etc.
- `"acme denver"` → matches Acme Corp employee with Denver address
- `"smith"` → single token, same as current behavior

### Future: server-side CardDAV search

CardDAV supports `addressbook-query` REPORT with property-level filtering (contains, starts-with, ends-with, equals), AND/OR combination, and result limiting. tsdav exposes `addressBookQuery()`. This is deferred — to be tracked in PRD and architecture doc as a future optimization for large address books.

## Testing Strategy

### Core `vcard.test.ts` (update existing — file already has 5 tests that must be updated for `TypedValue` shape)

- Parse typed emails: `EMAIL;TYPE=work:foo@bar.com` → `{ type: "work", value: "foo@bar.com" }`
- Parse typed phones: `TEL;TYPE=CELL:+1-555-0100` → `{ type: "cell", value: "+1-555-0100" }`
- Parse addresses: full ADR with TYPE, PO Box folding
- Parse URLs with TYPE
- Parse ROLE, NICKNAME, BDAY, CATEGORIES
- ORG first-component extraction: `ORG:Acme;Engineering;` → `"Acme"`
- `otherProperties` captures PHOTO, X-SOCIALPROFILE, etc.
- Round-trip: parse → build → parse produces equivalent Contact
- `otherProperties` preserved through round-trip
- Edge cases: missing TYPE, multiple TYPE values (e.g. `TEL;TYPE=WORK;TYPE=VOICE` — join with comma: `"work,voice"`), empty values, no ADR components
- BDAY format: extract as-is (may be `YYYY-MM-DD`, `YYYYMMDD`, or partial `--MM-DD`), no normalization

### Card-mcp `contactTools.test.ts` (update existing)

- `create_contact` with typed email/phone inputs
- `update_contact` with new fields
- `update_contact` preserves `otherProperties` (data-loss fix verification)
- Search with multi-term queries

### Card-mcp `CardDavService.test.ts` (update existing)

- `searchContacts` multi-term tokenization
- `updateContact` merge logic with all new fields
- `otherProperties` preservation through update flow

## Out of Scope

- Server-side CardDAV search (future — noted in PRD/arch doc)
- Structured read/write for custom X-* properties (future)
- PHOTO binary handling (preserved in otherProperties as raw lines)
- Structured ORG with department (matches iOS/Nextcloud: flat string only)

## Deliverables

1. Updated `Contact`, `TypedValue`, `PostalAddress` interfaces in `pim-core/src/vcard.ts`
2. Updated `parseVCard` and `buildVCard` with new helpers
3. Updated core exports in `pim-core/src/index.ts`
4. Updated tool schemas in `card-mcp/src/tools/contactTools.ts`
5. Updated `handleContactTool` for new field inputs
6. Updated `CardDavService` merge logic and search
7. Updated `pim-core/src/__tests__/vcard.test.ts` (existing tests updated + new tests added)
8. Updated `card-mcp/src/__tests__/contactTools.test.ts`
9. Updated `card-mcp/src/__tests__/CardDavService.test.ts`
10. PRD and architecture doc updated with server-side CardDAV search as future enhancement
