# card-mcp Parser & Output Quality Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix iOS-vCard parsing defects surfaced during mcporter QA (itemN groups, quoted TYPE values, TYPE noise, unparsed X-SOCIALPROFILE), reduce list payload via `detail_level="summary"` default, and make `resolve_contact` ambiguity explicit.

**Architecture:** Extend the existing hand-rolled vCard parser in `packages/core/src/vcard.ts` with group-aware parsing, TYPE normalization, and X-ABLabel / X-SOCIALPROFILE support. Add `detail_level` to `CardDavService` fetch/get methods and corresponding tool schemas. Rewrite `resolveContact` return shape. No new dependencies.

**Tech Stack:** TypeScript (strict), Vitest, Biome, MCP SDK, tsdav. Turborepo monorepo with `@miguelarios/pim-core` (parser) and `@miguelarios/card-mcp` (MCP server + service layer).

---

## File Structure

**Modified:**
- `packages/core/src/vcard.ts` — parser + builder + new helpers
- `packages/core/src/__tests__/vcard.test.ts` — ~14 new tests
- `packages/core/src/index.ts` — export `SocialProfile` type
- `packages/core/package.json` — version bump to 0.5.0
- `packages/card-mcp/src/services/CardDavService.ts` — add `detail_level` param, rewrite `resolveContact`
- `packages/card-mcp/src/tools/contactTools.ts` — schema + handler updates
- `packages/card-mcp/src/__tests__/CardDavService.test.ts` — new tests
- `packages/card-mcp/src/__tests__/contactTools.test.ts` — updated `resolve_contact` tests
- `packages/card-mcp/package.json` — version bump to 0.3.0, core dep bump to `^0.5.0`

**No files created.** All changes layer onto existing structure.

---

## Task 1: `normalizeType` helper (foundation)

**Files:**
- Modify: `packages/core/src/vcard.ts` (add helper function)
- Test: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Add to the bottom of `packages/core/src/__tests__/vcard.test.ts` (inside a new `describe` block):

```typescript
import { normalizeType } from "../vcard.js";

describe("normalizeType", () => {
  it("drops internet/voice/pref noise tokens", () => {
    expect(normalizeType("internet,work,pref")).toBe("work");
    expect(normalizeType("cell,voice,pref")).toBe("cell");
    expect(normalizeType("internet,home")).toBe("home");
  });

  it("strips surrounding double quotes from TYPE values", () => {
    expect(normalizeType('"internet')).toBe(undefined); // noise-only after strip
    expect(normalizeType('"work"')).toBe("work");
    expect(normalizeType('"internet","work"')).toBe("work");
  });

  it("joins multiple meaningful tokens with /", () => {
    expect(normalizeType("home,fax")).toBe("home/fax");
    expect(normalizeType("work,cell")).toBe("work/cell");
  });

  it("lowercases input tokens", () => {
    expect(normalizeType("HOME")).toBe("home");
    expect(normalizeType("Work,CELL")).toBe("work/cell");
  });

  it("returns undefined when empty or only noise", () => {
    expect(normalizeType("")).toBe(undefined);
    expect(normalizeType("internet,pref,voice")).toBe(undefined);
    expect(normalizeType(undefined)).toBe(undefined);
  });

  it("handles semicolon-separated input", () => {
    expect(normalizeType("home;fax")).toBe("home/fax");
  });
});
```

- [ ] **Step 1.2: Run tests to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "normalizeType"`
Expected: FAIL — `normalizeType is not a function` (import resolution error)

- [ ] **Step 1.3: Implement `normalizeType` in vcard.ts**

Add this exported helper to `packages/core/src/vcard.ts` (before `parseVCard`):

```typescript
const TYPE_NOISE_TOKENS = new Set(["internet", "voice", "pref"]);

/**
 * Normalize a raw TYPE parameter value into a clean label.
 * - Splits on comma or semicolon
 * - Lowercases all tokens
 * - Strips surrounding double-quote characters (from TYPE="internet" RFC 6868 form)
 * - Drops noise tokens: internet, voice, pref
 * - Joins remaining tokens with "/"
 * Returns undefined when no meaningful token remains.
 */
export function normalizeType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const tokens = raw
    .split(/[,;]/)
    .map((tok) => tok.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter((tok) => tok.length > 0 && !TYPE_NOISE_TOKENS.has(tok));
  if (tokens.length === 0) return undefined;
  return tokens.join("/");
}
```

- [ ] **Step 1.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "normalizeType"`
Expected: PASS — all 6 `normalizeType` tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add normalizeType helper for vCard TYPE param cleanup

Drops internet/voice/pref noise tokens, strips surrounding quotes,
joins multi-type with "/", lowercases consistently.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Strip `itemN.` group prefix + track group membership

The existing parser's `extractFirst`, `extractTypedAll`, `extractAddresses` all match property names with exact `startsWith`. iOS prefixes ADR/TEL/EMAIL/URL/X-SOCIALPROFILE lines with `item1.`, `item2.`, etc. We need a single pre-processor that returns both a canonical line (without prefix) AND the group ID for later X-ABLabel joining.

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Test: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 2.1: Write failing tests for group prefix handling**

Add new `describe` block to vcard.test.ts:

```typescript
describe("parseVCard with iOS itemN groups", () => {
  it("parses item1.ADR into addresses[]", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-1",
      "FN:Patrick Wilson",
      "item1.ADR;type=HOME;type=pref:;;789 Pine Rd;Anytown;ST;00000;United States",
      "item1.X-ABADR:us",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0]).toMatchObject({
      type: "home",
      street: "789 Pine Rd",
      city: "Anytown",
      state: "TX",
      postalCode: "00000",
      country: "United States",
    });
  });

  it("parses itemN.EMAIL and itemN.TEL with clean types", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-2",
      "FN:Patrick Wilson",
      "item2.EMAIL;type=INTERNET;type=work;type=pref:alice@example.com",
      "item3.TEL;type=CELL;type=VOICE;type=pref:+1-555-0100",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.emails).toEqual([{ type: "work", value: "alice@example.com" }]);
    expect(contact.phones).toEqual([{ type: "cell", value: "+1-555-0100" }]);
  });

  it("parses itemN.URL", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-3",
      "FN:X",
      "item1.URL;type=WORK:https://example.com",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.urls).toEqual([{ type: "work", value: "https://example.com" }]);
  });
});
```

- [ ] **Step 2.2: Run tests to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "iOS itemN"`
Expected: FAIL — `addresses` is empty, `emails[0].type` is the unnormalized concat string, etc.

- [ ] **Step 2.3: Add `stripItemPrefix` helper and apply in extraction functions**

Modify `packages/core/src/vcard.ts`. Add near the top of the file (after `TYPE_NOISE_TOKENS`):

```typescript
/**
 * Strip Apple iOS "itemN." group prefix from a line.
 * Returns both the canonical line and the group id (or undefined).
 * "item1.ADR;type=HOME:..." -> { canonical: "ADR;type=HOME:...", group: "item1" }
 * "EMAIL:foo@bar" -> { canonical: "EMAIL:foo@bar", group: undefined }
 */
function stripItemPrefix(line: string): { canonical: string; group: string | undefined } {
  const match = /^(item\d+)\.(.+)$/i.exec(line);
  if (!match) return { canonical: line, group: undefined };
  return { canonical: match[2], group: match[1].toLowerCase() };
}
```

Then update `extractFirst`, `extractTypedAll`, and `extractAddresses` to use `stripItemPrefix` on each line before matching the property name. Replace each function body's per-line logic. For example `extractTypedAll` becomes:

```typescript
function extractTypedAll(lines: string[], property: string): TypedValue[] {
  const results: TypedValue[] = [];
  for (const rawLine of lines) {
    const { canonical: line } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const value = line.slice(colonIndex + 1).trim();
      const paramSection = line.slice(property.length, colonIndex);
      const typeMatches: string[] = [];
      for (const match of paramSection.matchAll(/TYPE=([^;:]+)/gi)) {
        typeMatches.push(match[1]);
      }
      const type = normalizeType(typeMatches.join(","));
      results.push(type ? { type, value } : { value });
    }
  }
  return results;
}
```

Note the regex now captures through semicolons (`[^;:]+` not `[^;,\s]+`) so a single `TYPE=CELL;TYPE=VOICE` param list yields two separate matches we can pass to `normalizeType`.

Apply the same `stripItemPrefix` + `normalizeType` treatment in `extractFirst` (just the prefix strip — it has no TYPE logic) and `extractAddresses` (prefix strip + normalizeType for the `type` field).

Also update the `otherProperties` builder in `parseVCard` (lines 72-78) so `propName` is computed AFTER stripping — preventing `item1.ADR` from being counted as non-KNOWN:

```typescript
for (const rawLine of lines) {
  const { canonical: line } = stripItemPrefix(rawLine);
  const propName = line.split(/[:;]/)[0].toUpperCase();
  if (!KNOWN.has(propName) && rawLine.trim()) {
    otherProperties.push(rawLine); // keep raw form for round-trip
  }
}
```

- [ ] **Step 2.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts`
Expected: All previous tests still pass (regression check) + 3 new `iOS itemN` tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
feat(core): parse iOS itemN group prefix in vCards

Strip item1./item2./... group prefix before property dispatch. ADR,
TEL, EMAIL, URL grouped under itemN now parse into structured fields
instead of falling into otherProperties. TYPE normalization applied.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: X-ABLabel group-override for typed fields

When a group has an `X-ABLabel`, it overrides `TYPE=...` as the friendly label. Scan all lines once to build a group → label map, then apply it during extraction.

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Test: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 3.1: Write failing tests**

Add a new `describe` block:

```typescript
describe("parseVCard X-ABLabel resolution", () => {
  it("decodes _$!<HomePage>!$_ wrapped label for URL type", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-1",
      "FN:X",
      "item1.URL;type=pref:https://example.com",
      "item1.X-ABLabel:_$!<HomePage>!$_",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.urls).toEqual([{ type: "homepage", value: "https://example.com" }]);
  });

  it("uses raw X-ABLabel when no wrapper syntax", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-2",
      "FN:X",
      "item1.TEL;type=voice:+1-555-0100",
      "item1.X-ABLabel:School",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.phones).toEqual([{ type: "school", value: "+1-555-0100" }]);
  });

  it("falls through to normalized TYPE when X-ABLabel absent", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-3",
      "FN:X",
      "item1.EMAIL;type=INTERNET;type=HOME:foo@bar.com",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.emails).toEqual([{ type: "home", value: "foo@bar.com" }]);
  });
});
```

- [ ] **Step 3.2: Run tests to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "X-ABLabel"`
Expected: FAIL — first test gives `type: "pref"` (before TYPE noise strip renders it undefined or literal), second gives `undefined`.

- [ ] **Step 3.3: Implement X-ABLabel group-map and apply during extraction**

In `packages/core/src/vcard.ts`, add a helper at the module level:

```typescript
/**
 * Decode an Apple X-ABLabel value.
 * "_$!<HomePage>!$_" -> "homepage"
 * "School" -> "school"
 */
function decodeABLabel(raw: string): string {
  const wrapped = /^_\$!<(.+)>!\$_$/.exec(raw.trim());
  return (wrapped ? wrapped[1] : raw.trim()).toLowerCase();
}

/**
 * Build a map of group id (e.g. "item1") -> decoded X-ABLabel value.
 */
function buildAbLabelMap(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of lines) {
    const { canonical, group } = stripItemPrefix(rawLine);
    if (!group) continue;
    const upper = canonical.toUpperCase();
    if (!upper.startsWith("X-ABLABEL:") && !upper.startsWith("X-ABLABEL;")) continue;
    const colonIndex = canonical.indexOf(":");
    if (colonIndex === -1) continue;
    map.set(group, decodeABLabel(canonical.slice(colonIndex + 1)));
  }
  return map;
}
```

Then thread this map through `extractTypedAll` and `extractAddresses`. Change their signatures:

```typescript
function extractTypedAll(
  lines: string[],
  property: string,
  abLabels: Map<string, string>,
): TypedValue[] {
  const results: TypedValue[] = [];
  for (const rawLine of lines) {
    const { canonical: line, group } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const value = line.slice(colonIndex + 1).trim();
      const paramSection = line.slice(property.length, colonIndex);
      const typeMatches: string[] = [];
      for (const match of paramSection.matchAll(/TYPE=([^;:]+)/gi)) {
        typeMatches.push(match[1]);
      }
      // X-ABLabel (if present in same group) wins over TYPE
      const labelOverride = group ? abLabels.get(group) : undefined;
      const type = labelOverride ?? normalizeType(typeMatches.join(","));
      results.push(type ? { type, value } : { value });
    }
  }
  return results;
}
```

Apply the same pattern (label override) in `extractAddresses`.

In `parseVCard`, build the map once at the top and pass it:

```typescript
export function parseVCard(data: string): Contact {
  const lines = unfoldLines(data);
  const abLabels = buildAbLabelMap(lines);

  const uid = extractFirst(lines, "UID") ?? "";
  const fullName = extractFirst(lines, "FN") ?? "";
  const n = extractFirst(lines, "N");
  const emails = extractTypedAll(lines, "EMAIL", abLabels);
  const phones = extractTypedAll(lines, "TEL", abLabels);
  const urls = extractTypedAll(lines, "URL", abLabels);
  // ... rest unchanged, pass abLabels to extractAddresses ...
  addresses: extractAddresses(lines, abLabels),
  // ...
}
```

Also add `"X-ABLABEL"` to the `KNOWN` set so the label lines don't clutter `otherProperties`.

- [ ] **Step 3.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts`
Expected: All existing tests still green + 3 new X-ABLabel tests green.

- [ ] **Step 3.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
feat(core): resolve Apple X-ABLabel as typed-field label override

X-ABLabel within the same itemN group overrides TYPE=... for EMAIL,
TEL, ADR, URL. Strips the _\$!<...>!\$_ wrapper, lowercases output.
Unwrapped labels pass through lowercased. Falls back to normalized
TYPE when no label present.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Parse `X-SOCIALPROFILE` into `socialProfiles[]`

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Test: `packages/core/src/__tests__/vcard.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 4.1: Write failing tests**

Add new `describe` block to vcard.test.ts:

```typescript
describe("parseVCard X-SOCIALPROFILE", () => {
  it("parses Instagram entry with x-user handle and x-apple URL (drops URL)", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-1",
      "FN:X",
      "X-SOCIALPROFILE;type=Instagram;x-user=example_user:x-apple:example_user",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.socialProfiles).toEqual([
      { type: "instagram", handle: "example_user" },
    ]);
  });

  it("keeps URL when value is http(s)", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-2",
      "FN:X",
      "X-SOCIALPROFILE;type=twitter;x-user=testhandle:http://twitter.com/testhandle",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.socialProfiles).toEqual([
      { type: "twitter", handle: "testhandle", url: "http://twitter.com/testhandle" },
    ]);
  });

  it("handles multiple social profiles and preserves order", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-3",
      "FN:X",
      "X-SOCIALPROFILE;type=Instagram;x-user=foo:x-apple:foo",
      "X-SOCIALPROFILE;type=LinkedIn;x-user=bar:https://linkedin.com/in/bar",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    expect(contact.socialProfiles).toHaveLength(2);
    expect(contact.socialProfiles?.[0].type).toBe("instagram");
    expect(contact.socialProfiles?.[1].type).toBe("linkedin");
    expect(contact.socialProfiles?.[1].url).toBe("https://linkedin.com/in/bar");
  });
});
```

- [ ] **Step 4.2: Run tests to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "X-SOCIALPROFILE"`
Expected: FAIL — `socialProfiles` is undefined (not parsed; still in `otherProperties`).

- [ ] **Step 4.3: Add `SocialProfile` type to Contact and parser**

In `packages/core/src/vcard.ts`:

Add the interface after `PostalAddress`:

```typescript
export interface SocialProfile {
  type: string;    // lowercased service name: "instagram", "twitter", etc.
  handle?: string; // from x-user param
  url?: string;    // value after colon if http(s); omitted for x-apple: prefix
}
```

Add `socialProfiles?: SocialProfile[]` to the `Contact` interface.

Add the extraction function:

```typescript
function extractSocialProfiles(lines: string[]): SocialProfile[] {
  const results: SocialProfile[] = [];
  for (const rawLine of lines) {
    const { canonical: line } = stripItemPrefix(rawLine);
    const upper = line.toUpperCase();
    if (!upper.startsWith("X-SOCIALPROFILE;") && !upper.startsWith("X-SOCIALPROFILE:")) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const paramSection = line.slice("X-SOCIALPROFILE".length, colonIndex);
    const value = line.slice(colonIndex + 1).trim();

    const typeMatch = /type=([^;:]+)/i.exec(paramSection);
    const userMatch = /x-user=([^;:]+)/i.exec(paramSection);
    const type = typeMatch ? typeMatch[1].trim().toLowerCase() : "";
    if (!type) continue;

    const profile: SocialProfile = { type };
    if (userMatch) profile.handle = userMatch[1].trim();
    if (value && !/^x-apple:/i.test(value)) profile.url = value;
    results.push(profile);
  }
  return results;
}
```

Add `"X-SOCIALPROFILE"` to the `KNOWN` set.

In `parseVCard`, call it:

```typescript
const socialProfiles = extractSocialProfiles(lines);
// ...
return {
  // ...existing...
  socialProfiles: socialProfiles.length > 0 ? socialProfiles : undefined,
  otherProperties,
};
```

In `packages/core/src/index.ts`, add `SocialProfile` to the exports from `./vcard.js`:

```typescript
export { parseVCard, buildVCard, normalizeType } from "./vcard.js";
export type { Contact, TypedValue, PostalAddress, SocialProfile } from "./vcard.js";
```

(Preserve any other existing exports; only add the new names.)

- [ ] **Step 4.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts`
Expected: All green.

- [ ] **Step 4.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): parse X-SOCIALPROFILE into structured socialProfiles field

Extract Instagram, Twitter, LinkedIn, etc. from iOS vCards into
Contact.socialProfiles[] with type/handle/url. Drop x-apple:
URLs (they're app-deeplinks, not web URLs). Export SocialProfile.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Strip Apple-internal properties from `otherProperties`

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Test: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 5.1: Write failing test**

Add to vcard.test.ts:

```typescript
describe("parseVCard Apple internals filtering", () => {
  it("strips photo, prodid, rev, and other Apple internals from otherProperties", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-1",
      "FN:X",
      "PRODID:-//Apple Inc.//iOS 26.0//EN",
      "REV:2024-09-16T22:05:13Z",
      "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAASABIAAD",
      "X-IMAGETYPE:PHOTO",
      "X-IMAGEHASH:+t54yzQVDfamrN6MVyxA7A==",
      "X-SHARED-PHOTO-DISPLAY-PREF:AUTOUPDATE",
      "item1.X-ADDRESSING-GRAMMAR:encryptedbase64blob==",
      "item1.X-ABADR:us",
      "X-UNKNOWN-CUSTOM:preserve-me",
      "END:VCARD",
    ].join("\r\n");
    const contact = parseVCard(vcard);
    const joined = contact.otherProperties.join("|");
    expect(joined).not.toContain("PRODID");
    expect(joined).not.toContain("REV:");
    expect(joined).not.toContain("PHOTO;");
    expect(joined).not.toContain("X-IMAGETYPE");
    expect(joined).not.toContain("X-IMAGEHASH");
    expect(joined).not.toContain("X-SHARED-PHOTO-DISPLAY-PREF");
    expect(joined).not.toContain("X-ADDRESSING-GRAMMAR");
    expect(joined).not.toContain("X-ABADR");
    expect(joined).toContain("X-UNKNOWN-CUSTOM");
  });
});
```

- [ ] **Step 5.2: Run test to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "Apple internals filtering"`
Expected: FAIL — PRODID, REV, PHOTO, etc. still appear in `otherProperties`.

- [ ] **Step 5.3: Add filter set and apply in `parseVCard` loop**

In `packages/core/src/vcard.ts`, add at the module level:

```typescript
const APPLE_INTERNAL_PROPS = new Set([
  "PRODID",
  "REV",
  "PHOTO",
  "X-IMAGETYPE",
  "X-IMAGEHASH",
  "X-SHARED-PHOTO-DISPLAY-PREF",
  "X-ADDRESSING-GRAMMAR",
  "X-ABADR",
]);
```

Update the `otherProperties` builder loop in `parseVCard` to skip these:

```typescript
for (const rawLine of lines) {
  const { canonical: line } = stripItemPrefix(rawLine);
  const propName = line.split(/[:;]/)[0].toUpperCase();
  if (KNOWN.has(propName) || APPLE_INTERNAL_PROPS.has(propName)) continue;
  if (rawLine.trim()) {
    otherProperties.push(rawLine);
  }
}
```

- [ ] **Step 5.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts`
Expected: All green.

- [ ] **Step 5.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
feat(core): strip Apple-internal properties from otherProperties

PRODID, REV, PHOTO binaries, X-IMAGE*, X-ADDRESSING-GRAMMAR (encrypted
Apple blob), X-ABADR, X-SHARED-PHOTO-DISPLAY-PREF are noise for any
LLM/API consumer. They're always dropped. Unknown X-* extensions are
still preserved for round-trip.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Round-trip `socialProfiles` in `buildVCard`

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Test: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 6.1: Write failing round-trip test**

Add to vcard.test.ts:

```typescript
describe("buildVCard round-trip", () => {
  it("preserves socialProfiles through parse -> build -> parse", () => {
    const original = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "UID:test-rt",
      "FN:Patrick",
      "X-SOCIALPROFILE;type=Instagram;x-user=example_user:x-apple:example_user",
      "X-SOCIALPROFILE;type=twitter;x-user=testhandle:http://twitter.com/testhandle",
      "END:VCARD",
    ].join("\r\n");
    const first = parseVCard(original);
    const rebuilt = buildVCard(first);
    const second = parseVCard(rebuilt);
    expect(second.socialProfiles).toEqual(first.socialProfiles);
  });

  it("serializes socialProfiles with handle and url when present", () => {
    const contact = {
      uid: "u",
      fullName: "X",
      emails: [],
      phones: [],
      addresses: [],
      urls: [],
      otherProperties: [],
      socialProfiles: [
        { type: "twitter", handle: "a", url: "https://twitter.com/a" },
        { type: "instagram", handle: "b" },
      ],
    };
    const built = buildVCard(contact as any);
    expect(built).toContain("X-SOCIALPROFILE;type=twitter;x-user=a:https://twitter.com/a");
    expect(built).toContain("X-SOCIALPROFILE;type=instagram;x-user=b:x-apple:b");
  });
});
```

- [ ] **Step 6.2: Run tests to verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "round-trip"`
Expected: FAIL — `buildVCard` does not emit X-SOCIALPROFILE lines.

- [ ] **Step 6.3: Extend `buildVCard` with socialProfiles output**

In `packages/core/src/vcard.ts`, inside `buildVCard`, before the `for (const raw of contact.otherProperties)` loop:

```typescript
if (contact.socialProfiles) {
  for (const sp of contact.socialProfiles) {
    const parts: string[] = [`type=${sp.type}`];
    if (sp.handle) parts.push(`x-user=${sp.handle}`);
    const params = parts.join(";");
    const value = sp.url ?? (sp.handle ? `x-apple:${sp.handle}` : "");
    lines.push(`X-SOCIALPROFILE;${params}:${value}`);
  }
}
```

- [ ] **Step 6.4: Run tests to verify pass**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts`
Expected: All green.

- [ ] **Step 6.5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
feat(core): round-trip socialProfiles through buildVCard

Emit X-SOCIALPROFILE lines from Contact.socialProfiles when
serializing. Falls back to x-apple:<handle> when no URL is present
(Apple-compatible default).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Bump `pim-core` to 0.5.0

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 7.1: Edit the version field**

Change `packages/core/package.json`:

```json
  "version": "0.5.0",
```

(from `0.4.1`)

- [ ] **Step 7.2: Sync lockfile**

Run: `npm install --package-lock-only`

- [ ] **Step 7.3: Run full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests green (existing + new).

- [ ] **Step 7.4: Commit**

```bash
git add packages/core/package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(core): bump pim-core to 0.5.0

Parser output shape changes (new socialProfiles field, Apple internals
stripped from otherProperties) warrant a minor bump on 0.x.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add `detail_level` to `CardDavService.fetchContacts` and `getContact`-like path

The service currently has `fetchContacts(addressBookUrl)` returning `Contact[]`. Add an optional detail parameter and a new helper that applies the summary transformation.

**Files:**
- Modify: `packages/card-mcp/src/services/CardDavService.ts`
- Test: `packages/card-mcp/src/__tests__/CardDavService.test.ts`

- [ ] **Step 8.1: Write failing tests**

Add a new `describe` block at the bottom of `packages/card-mcp/src/__tests__/CardDavService.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CardDavService } from "../services/CardDavService.js";

// NOTE: Reuse the existing vi.mock("tsdav", ...) setup at the top of this file.
// These tests use the same mock client pattern as the existing tests above.

describe("CardDavService detail_level", () => {
  const sampleVCard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "UID:uid-1",
    "FN:Jane",
    "EMAIL;TYPE=WORK:jane@example.com",
    "PHOTO;ENCODING=b;TYPE=JPEG:fakebinary",
    "X-CUSTOM-EXT:keep-me",
    "END:VCARD",
  ].join("\r\n");

  it('fetchContacts with detail_level="summary" drops otherProperties and photo', async () => {
    const service = new CardDavService({
      url: "https://x",
      username: "u",
      password: "p",
    });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([{ url: "x", data: sampleVCard, etag: "" }]),
    };
    const contacts = await service.fetchContacts("book", { detailLevel: "summary" });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].otherProperties).toEqual([]);
    // Photo data should not appear anywhere in the returned JSON
    expect(JSON.stringify(contacts[0])).not.toContain("fakebinary");
    // Structured fields survive
    expect(contacts[0].emails[0].value).toBe("jane@example.com");
  });

  it('fetchContacts with detail_level="full" preserves otherProperties (minus Apple internals stripped by parser)', async () => {
    const service = new CardDavService({
      url: "https://x",
      username: "u",
      password: "p",
    });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([{ url: "x", data: sampleVCard, etag: "" }]),
    };
    const contacts = await service.fetchContacts("book", { detailLevel: "full" });
    expect(contacts[0].otherProperties.join("|")).toContain("X-CUSTOM-EXT");
    // PHOTO is still stripped at the parser level (Apple-internal)
    expect(contacts[0].otherProperties.join("|")).not.toContain("PHOTO");
  });

  it("fetchContacts defaults to summary when detail_level omitted", async () => {
    const service = new CardDavService({
      url: "https://x",
      username: "u",
      password: "p",
    });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([{ url: "x", data: sampleVCard, etag: "" }]),
    };
    const contacts = await service.fetchContacts("book");
    expect(contacts[0].otherProperties).toEqual([]);
  });
});
```

- [ ] **Step 8.2: Run tests to verify failure**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/CardDavService.test.ts -t "detail_level"`
Expected: FAIL — `fetchContacts` does not accept a second argument.

- [ ] **Step 8.3: Implement `detailLevel` in `CardDavService`**

Modify `packages/card-mcp/src/services/CardDavService.ts`:

Add a type and helper near the top:

```typescript
export type DetailLevel = "summary" | "full";

function applyDetailLevel(contact: Contact, level: DetailLevel): Contact {
  if (level === "full") return contact;
  return {
    ...contact,
    otherProperties: [],
  };
}
```

Change the signature of `fetchContacts`:

```typescript
async fetchContacts(
  addressBookUrl: string,
  opts: { detailLevel?: DetailLevel } = {},
): Promise<Contact[]> {
  const detailLevel = opts.detailLevel ?? "summary";
  const client = await this.ensureConnected();
  try {
    const vcards = await client.fetchVCards({
      addressBook: { url: addressBookUrl } as any,
    });
    return vcards
      .filter((v) => v.data)
      .map((v) => applyDetailLevel(parseVCard(v.data!), detailLevel));
  } catch (error) {
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  }
}
```

Also update `searchContacts` to pass through the same opts:

```typescript
async searchContacts(
  addressBookUrl: string,
  query: string,
  opts: { detailLevel?: DetailLevel } = {},
): Promise<Contact[]> {
  const contacts = await this.fetchContacts(addressBookUrl, opts);
  // ...rest of existing filter logic unchanged...
}
```

`updateContact` internally uses `parseVCard(existing.data!)` directly (not `fetchContacts`), so its behavior is untouched — merge still sees the full otherProperties and round-trips them. **This is intentional**: writes need full fidelity.

- [ ] **Step 8.4: Run tests to verify pass**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/CardDavService.test.ts`
Expected: All green (existing tests still pass; new detail_level tests pass).

- [ ] **Step 8.5: Commit**

```bash
git add packages/card-mcp/src/services/CardDavService.ts packages/card-mcp/src/__tests__/CardDavService.test.ts
git commit -m "$(cat <<'EOF'
feat(card-mcp): add detailLevel option to fetchContacts/searchContacts

Default is "summary" — drops otherProperties entirely for consumer
LLMs. "full" preserves everything for round-trip / update flows.
updateContact bypasses the filter so merge preserves fidelity.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rewrite `CardDavService.resolveContact` return shape

**Files:**
- Modify: `packages/card-mcp/src/services/CardDavService.ts`
- Test: `packages/card-mcp/src/__tests__/CardDavService.test.ts`

- [ ] **Step 9.1: Write failing tests**

Append to `CardDavService.test.ts`:

```typescript
describe("CardDavService.resolveContact", () => {
  const mkVCard = (uid: string, fn: string, email?: string) =>
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `UID:${uid}`,
      `FN:${fn}`,
      email ? `EMAIL;TYPE=WORK:${email}` : "",
      "END:VCARD",
    ].filter(Boolean).join("\r\n");

  it("returns resolved shape on single match", async () => {
    const service = new CardDavService({ url: "x", username: "u", password: "p" });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([
        { url: "1", data: mkVCard("u1", "Patrick Wilson", "n@t.com"), etag: "" },
      ]),
    };
    const r = await service.resolveContact("book", "Patrick");
    expect(r).toEqual({
      status: "resolved",
      fullName: "Patrick Wilson",
      email: "n@t.com",
    });
  });

  it("returns ambiguous shape with candidates sorted by fullName on multi-match", async () => {
    const service = new CardDavService({ url: "x", username: "u", password: "p" });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([
        { url: "1", data: mkVCard("u1", "Alice Smith", "r@x.com"), etag: "" },
        { url: "2", data: mkVCard("u2", "Alice Brown", "a@y.com"), etag: "" },
        { url: "3", data: mkVCard("u3", "Alice Lee", "w@z.com"), etag: "" },
      ]),
    };
    const r = await service.resolveContact("book", "Alice");
    if (r.status !== "ambiguous") throw new Error(`expected ambiguous, got ${r.status}`);
    expect(r.candidates.map((c) => c.fullName)).toEqual([
      "Alice Brown",
      "Alice Smith",
      "Alice Lee",
    ]);
    expect(r.candidates[0]).toMatchObject({
      fullName: "Alice Brown",
      email: "a@y.com",
      uid: "u2",
    });
  });

  it("returns not_found shape when no match", async () => {
    const service = new CardDavService({ url: "x", username: "u", password: "p" });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([]),
    };
    const r = await service.resolveContact("book", "Nobody");
    if (r.status !== "not_found") throw new Error(`expected not_found, got ${r.status}`);
    expect(r.message).toContain("Nobody");
  });

  it("ambiguous candidates skip contacts without email", async () => {
    const service = new CardDavService({ url: "x", username: "u", password: "p" });
    (service as any).client = {
      fetchVCards: vi.fn().mockResolvedValue([
        { url: "1", data: mkVCard("u1", "Alice One", "one@x.com"), etag: "" },
        { url: "2", data: mkVCard("u2", "Alice Two"), etag: "" }, // no email
        { url: "3", data: mkVCard("u3", "Alice Three", "three@x.com"), etag: "" },
      ]),
    };
    const r = await service.resolveContact("book", "Alice");
    if (r.status !== "ambiguous") throw new Error(`expected ambiguous, got ${r.status}`);
    expect(r.candidates.length).toBe(2);
    expect(r.candidates.every((c) => c.email.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 9.2: Run tests to verify failure**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/CardDavService.test.ts -t "resolveContact"`
Expected: FAIL — current `resolveContact` returns `{fullName, email} | null`.

- [ ] **Step 9.3: Rewrite `resolveContact` signature + body**

In `packages/card-mcp/src/services/CardDavService.ts`:

Add the result shape near the top of the file (after `DetailLevel`):

```typescript
export type ResolveContactResult =
  | { status: "resolved"; fullName: string; email: string }
  | { status: "ambiguous"; candidates: Array<{ fullName: string; email: string; uid: string }> }
  | { status: "not_found"; message: string };
```

Replace the existing `resolveContact` method with:

```typescript
async resolveContact(
  addressBookUrl: string,
  name: string,
): Promise<ResolveContactResult> {
  const matches = await this.searchContacts(addressBookUrl, name);
  const withEmail = matches.filter((c) => c.emails.length > 0);
  if (withEmail.length === 0) {
    return {
      status: "not_found",
      message: `No contact with email found matching "${name}"`,
    };
  }
  if (withEmail.length === 1) {
    const c = withEmail[0];
    return {
      status: "resolved",
      fullName: c.fullName,
      email: c.emails[0].value,
    };
  }
  const candidates = [...withEmail]
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((c) => ({
      fullName: c.fullName,
      email: c.emails[0].value,
      uid: c.uid,
    }));
  return { status: "ambiguous", candidates };
}
```

- [ ] **Step 9.4: Run tests to verify pass**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/CardDavService.test.ts`
Expected: All green (existing + new).

- [ ] **Step 9.5: Commit**

```bash
git add packages/card-mcp/src/services/CardDavService.ts packages/card-mcp/src/__tests__/CardDavService.test.ts
git commit -m "$(cat <<'EOF'
feat(card-mcp): rewrite resolveContact with explicit status field

Returns { status: "resolved" | "ambiguous" | "not_found" }. On multiple
matches, enumerates candidates[] sorted by fullName instead of silently
picking the first. Breaking change.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `detail_level` through tool schemas + handlers

**Files:**
- Modify: `packages/card-mcp/src/tools/contactTools.ts`
- Test: `packages/card-mcp/src/__tests__/contactTools.test.ts`

- [ ] **Step 10.1: Write failing tests**

Add to `packages/card-mcp/src/__tests__/contactTools.test.ts`:

```typescript
describe("contactTools detail_level wiring", () => {
  it("list_contacts passes detailLevel to service (default summary)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue([]);
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "book1", displayName: "x" }]),
      fetchContacts: fetchSpy,
      searchContacts: vi.fn().mockResolvedValue([]),
    } as any;
    await handleContactTool("list_contacts", {}, fakeService);
    expect(fetchSpy).toHaveBeenCalledWith("book1", { detailLevel: "summary" });
  });

  it("list_contacts respects explicit detail_level=full", async () => {
    const fetchSpy = vi.fn().mockResolvedValue([]);
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "book1", displayName: "x" }]),
      fetchContacts: fetchSpy,
      searchContacts: vi.fn().mockResolvedValue([]),
    } as any;
    await handleContactTool("list_contacts", { detail_level: "full" }, fakeService);
    expect(fetchSpy).toHaveBeenCalledWith("book1", { detailLevel: "full" });
  });

  it("get_contact passes detailLevel to service", async () => {
    const fetchSpy = vi.fn().mockResolvedValue([
      { uid: "u1", fullName: "X", emails: [], phones: [], addresses: [], urls: [], otherProperties: [] },
    ]);
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "book1", displayName: "x" }]),
      fetchContacts: fetchSpy,
    } as any;
    await handleContactTool("get_contact", { uid: "u1", detail_level: "full" }, fakeService);
    expect(fetchSpy).toHaveBeenCalledWith("book1", { detailLevel: "full" });
  });
});
```

Import `handleContactTool` at the top if not already imported.

- [ ] **Step 10.2: Run tests to verify failure**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/contactTools.test.ts -t "detail_level wiring"`
Expected: FAIL — handlers don't pass detailLevel; `fetchContacts` is called with only `(url)`.

- [ ] **Step 10.3: Update tool schemas and handlers in contactTools.ts**

In the `list_contacts` tool schema, add a `detail_level` property:

```typescript
{
  name: "list_contacts",
  description:
    "List or search contacts. Returns all contacts if no query provided, or filters by name/email/phone/org when query is given.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional search query to filter contacts by name, email, phone, or organization",
      },
      detail_level: {
        type: "string",
        enum: ["summary", "full"],
        description:
          "Level of detail. 'summary' (default) omits photo binary and raw otherProperties. 'full' returns the complete parsed vCard shape.",
      },
      addressBook: {
        type: "string",
        description: "Address book URL. If omitted, uses the first available address book.",
      },
    },
  },
},
```

Do the same for `get_contact` (add `detail_level` property with the same enum + description).

Update the `list_contacts` handler branch:

```typescript
case "list_contacts": {
  const query = args.query as string | undefined;
  const detailLevel = (args.detail_level as "summary" | "full" | undefined) ?? "summary";
  const contacts = query
    ? await service.searchContacts(addressBookUrl, query, { detailLevel })
    : await service.fetchContacts(addressBookUrl, { detailLevel });
  return ok(JSON.stringify(contacts, null, 2));
}
```

Update the `get_contact` handler branch:

```typescript
case "get_contact": {
  const uid = args.uid as string;
  const detailLevel = (args.detail_level as "summary" | "full" | undefined) ?? "summary";
  const contacts = await service.fetchContacts(addressBookUrl, { detailLevel });
  const contact = contacts.find((c) => c.uid === uid);
  if (!contact) {
    throw new ContactError(`Contact ${uid} not found`, ErrorCode.CONTACT_NOT_FOUND, uid);
  }
  return ok(JSON.stringify(contact, null, 2));
}
```

- [ ] **Step 10.4: Run tests to verify pass**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/contactTools.test.ts`
Expected: All green.

- [ ] **Step 10.5: Commit**

```bash
git add packages/card-mcp/src/tools/contactTools.ts packages/card-mcp/src/__tests__/contactTools.test.ts
git commit -m "$(cat <<'EOF'
feat(card-mcp): expose detail_level on list_contacts and get_contact

Default summary strips photo binaries and raw otherProperties,
reducing the 25MB full-list payload by ~90%. Callers pass
detail_level="full" when they need round-trip fidelity.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update `resolve_contact` tool handler for new shape

**Files:**
- Modify: `packages/card-mcp/src/tools/contactTools.ts`
- Test: `packages/card-mcp/src/__tests__/contactTools.test.ts`

- [ ] **Step 11.1: Write failing tests**

Add to `contactTools.test.ts`:

```typescript
describe("resolve_contact handler new shape", () => {
  it("returns resolved JSON on single match", async () => {
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "b", displayName: "x" }]),
      resolveContact: vi.fn().mockResolvedValue({
        status: "resolved",
        fullName: "Patrick",
        email: "n@t.com",
      }),
    } as any;
    const res = await handleContactTool("resolve_contact", { name: "Patrick" }, fakeService);
    const body = JSON.parse(res.content[0].text);
    expect(body).toEqual({ status: "resolved", fullName: "Patrick", email: "n@t.com" });
  });

  it("returns ambiguous JSON with candidates array on multi-match", async () => {
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "b", displayName: "x" }]),
      resolveContact: vi.fn().mockResolvedValue({
        status: "ambiguous",
        candidates: [
          { fullName: "Alice Brown", email: "a@x.com", uid: "u1" },
          { fullName: "Alice Smith", email: "r@x.com", uid: "u2" },
        ],
      }),
    } as any;
    const res = await handleContactTool("resolve_contact", { name: "Alice" }, fakeService);
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe("ambiguous");
    expect(body.candidates).toHaveLength(2);
  });

  it("returns not_found JSON with message", async () => {
    const fakeService = {
      listAddressBooks: vi.fn().mockResolvedValue([{ url: "b", displayName: "x" }]),
      resolveContact: vi.fn().mockResolvedValue({
        status: "not_found",
        message: 'No contact with email found matching "Nobody"',
      }),
    } as any;
    const res = await handleContactTool("resolve_contact", { name: "Nobody" }, fakeService);
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe("not_found");
    expect(body.message).toContain("Nobody");
  });
});
```

- [ ] **Step 11.2: Run tests to verify failure**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/contactTools.test.ts -t "resolve_contact handler new shape"`
Expected: FAIL — handler currently handles the old `{fullName, email}|null` shape.

- [ ] **Step 11.3: Simplify resolve_contact branch**

In `packages/card-mcp/src/tools/contactTools.ts`, replace the existing `case "resolve_contact"` block:

```typescript
case "resolve_contact": {
  const name = args.name as string;
  const result = await service.resolveContact(addressBookUrl, name);
  return ok(JSON.stringify(result));
}
```

Also update the tool description to reflect the new shape:

```typescript
{
  name: "resolve_contact",
  description:
    "Given a person's name, resolve to email. Returns { status: 'resolved', fullName, email } on a single match; { status: 'ambiguous', candidates: [...] } when multiple contacts match (caller must disambiguate); { status: 'not_found', message } when no contact with email matches.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name to search for (partial matches allowed)",
      },
      addressBook: {
        type: "string",
        description: "Address book URL. If omitted, uses the first available address book.",
      },
    },
    required: ["name"],
  },
},
```

- [ ] **Step 11.4: Run tests to verify pass**

Run: `cd packages/card-mcp && npx vitest run src/__tests__/contactTools.test.ts`
Expected: All green.

- [ ] **Step 11.5: Commit**

```bash
git add packages/card-mcp/src/tools/contactTools.ts packages/card-mcp/src/__tests__/contactTools.test.ts
git commit -m "$(cat <<'EOF'
feat(card-mcp): update resolve_contact tool for ambiguity-aware shape

Handler now passes through the service's structured result directly.
Tool description updated to document status enum and candidates array.
Breaking change for consumers of the old flat {fullName, email} shape.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Golden-file round-trip test (iOS vCard → parsed → matches phone view)

This test locks in the full integration: strip groups + normalize types + resolve labels + parse socials + filter internals, all in one realistic vCard.

**Files:**
- Modify: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 12.1: Write the golden-file test**

Append to vcard.test.ts:

```typescript
describe("parseVCard iOS golden (Patrick-shaped)", () => {
  it("matches the iOS Contacts phone view 1:1", () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "PRODID:-//Apple Inc.//iOS 26.0//EN",
      "N:Wilson;Patrick;;;",
      "FN:Patrick Wilson",
      "NICKNAME:Alice",
      "item2.EMAIL;type=INTERNET;type=WORK;type=pref:alice@example.com",
      "item3.EMAIL;type=INTERNET;type=HOME:alice@example.com",
      "item4.TEL;type=CELL;type=VOICE;type=pref:+1-555-0100",
      "item5.TEL;type=WORK;type=VOICE:+1-555-0100",
      "item1.ADR;type=HOME;type=pref:;;789 Pine Rd;Anytown;ST;00000;United States",
      "item1.X-ABADR:us",
      "BDAY:1990-01-01",
      "NOTE:TI Intern\\nGoing out friend\\nDallas\\nFriends\\n",
      "X-SOCIALPROFILE;type=Instagram;x-user=example_user:x-apple:example_user",
      "X-SOCIALPROFILE;type=twitter;x-user=testhandle:http://twitter.com/testhandle",
      "PHOTO;ENCODING=b;TYPE=JPEG:fakebase64photodata",
      "REV:2024-09-16T22:05:13Z",
      "X-IMAGETYPE:PHOTO",
      "X-IMAGEHASH:+t54yzQVDfamrN6MVyxA7A==",
      "X-SHARED-PHOTO-DISPLAY-PREF:AUTOUPDATE",
      "UID:00000000-0000-0000-0000-000000000001",
      "END:VCARD",
    ].join("\r\n");

    const contact = parseVCard(vcard);

    expect(contact).toMatchObject({
      uid: "00000000-0000-0000-0000-000000000001",
      fullName: "Patrick Wilson",
      firstName: "Patrick",
      lastName: "Wilson",
      nickname: "Alice",
      emails: [
        { type: "work", value: "alice@example.com" },
        { type: "home", value: "alice@example.com" },
      ],
      phones: [
        { type: "cell", value: "+1-555-0100" },
        { type: "work", value: "+1-555-0100" },
      ],
      addresses: [
        {
          type: "home",
          street: "789 Pine Rd",
          city: "Anytown",
          state: "TX",
          postalCode: "00000",
          country: "United States",
        },
      ],
      birthday: "1990-01-01",
      socialProfiles: [
        { type: "instagram", handle: "example_user" },
        { type: "twitter", handle: "testhandle", url: "http://twitter.com/testhandle" },
      ],
    });
    expect(contact.note).toContain("TI Intern");
    // Apple internals stripped from otherProperties
    const op = contact.otherProperties.join("|");
    expect(op).not.toContain("PRODID");
    expect(op).not.toContain("REV:");
    expect(op).not.toContain("PHOTO");
    expect(op).not.toContain("X-IMAGETYPE");
    expect(op).not.toContain("X-IMAGEHASH");
    expect(op).not.toContain("X-SHARED-PHOTO-DISPLAY-PREF");
    expect(op).not.toContain("X-ABADR");
  });
});
```

- [ ] **Step 12.2: Run test**

Run: `cd packages/core && npx vitest run src/__tests__/vcard.test.ts -t "iOS golden"`
Expected: PASS. If it fails, re-read the failure message — most likely a minor field the parser still mishandles — and fix the specific parser path without breaking earlier tests.

- [ ] **Step 12.3: Commit**

```bash
git add packages/core/src/__tests__/vcard.test.ts
git commit -m "$(cat <<'EOF'
test(core): add iOS golden-file integration test for parser output

Locks in the full parse pipeline matching the iOS Contacts app view
1:1 for Patrick-shaped contact. Covers groups + TYPE normalization +
socialProfiles + Apple-internal filter in one realistic vCard.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Bump `card-mcp` to 0.3.0 and upgrade core dep

**Files:**
- Modify: `packages/card-mcp/package.json`

- [ ] **Step 13.1: Edit version and dependency**

Change `packages/card-mcp/package.json`:

```json
  "version": "0.3.0",
```

(from `0.2.0`)

And in the `"dependencies"` block:

```json
    "@miguelarios/pim-core": "^0.5.0",
```

(from `^0.4.0`)

- [ ] **Step 13.2: Sync lockfile**

Run: `npm install --package-lock-only`

- [ ] **Step 13.3: Run entire workspace test suite**

Run: `npm test`
Expected: All packages green. Specifically verify:
- `packages/core` — all existing tests + ~14 new parser tests pass
- `packages/card-mcp` — existing tests + new detail_level/resolveContact tests pass
- `packages/email-mcp`, `packages/cal-mcp` — no regressions (they don't depend on changed card-mcp behavior, but pim-core export surface grew)

- [ ] **Step 13.4: Typecheck full monorepo**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 13.5: Lint check**

Run: `npm run lint`
Expected: No errors. If Biome flags anything, fix it before committing.

- [ ] **Step 13.6: Commit**

```bash
git add packages/card-mcp/package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(card-mcp): bump to 0.3.0, require pim-core ^0.5.0

Breaking: detail_level="summary" is the new default for list_contacts
and get_contact; resolve_contact returns {status, ...} instead of the
old flat shape.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: End-to-end manual verification against live CardDAV

Fast smoke test to confirm the fixes behave against a real address book before publish.

- [ ] **Step 14.1: Rebuild**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 14.2: Test via mcporter against live CardDAV**

Run: `mcporter call contacts.list_contacts query=alice --output json | jq '.[0] | {uid, fullName, emails, phones, addresses, socialProfiles, otherProperties}'`
Expected output shape (example):

```json
{
  "uid": "00000000-0000-0000-0000-000000000001",
  "fullName": "Patrick Wilson",
  "emails": [
    {"type": "work", "value": "alice@example.com"},
    {"type": "home", "value": "alice@example.com"}
  ],
  "phones": [
    {"type": "cell", "value": "+1-555-0100"},
    {"type": "work", "value": "+1-555-0100"}
  ],
  "addresses": [
    {"type": "home", "street": "789 Pine Rd", "city": "Anytown", ...}
  ],
  "socialProfiles": [
    {"type": "instagram", "handle": "example_user"},
    {"type": "twitter", "handle": "testhandle", "url": "http://twitter.com/testhandle"}
  ],
  "otherProperties": []
}
```

Key validations:
- Phone types are clean strings (`"cell"`, `"work"`) — not `"cell,voice,pref"`.
- Email types are clean (`"work"`, `"home"`) — not `"internet,work,pref"`.
- Address populated (not empty).
- `socialProfiles` populated with Instagram/Twitter.
- `otherProperties` is empty (no PHOTO blob, no PRODID, no X-ADDRESSING-GRAMMAR, etc.).

- [ ] **Step 14.3: Test resolve_contact ambiguity**

Run: `mcporter call contacts.resolve_contact name=Alice --output json`
Expected: `{"status": "ambiguous", "candidates": [...]}` with 4+ candidates sorted by fullName.

Run: `mcporter call contacts.resolve_contact name="Alice Smith" --output json`
Expected: `{"status": "resolved", "fullName": "Alice Smith", "email": "..."}`.

Run: `mcporter call contacts.resolve_contact name="ZZZZ NonExistent" --output json`
Expected: `{"status": "not_found", "message": "..."}`.

- [ ] **Step 14.4: Confirm full-list payload reduction**

Run: `mcporter call contacts.list_contacts --output json > /tmp/all-after.json && wc -c /tmp/all-after.json`
Expected: Payload dropped from ~25 MB (pre-fix) to ~1–3 MB.

- [ ] **Step 14.5: No commit needed** — this task is verification-only. If anything fails, circle back to the specific task that should have covered it (likely the parser tests missed a case) and add a test + fix before releasing.

---

## Self-Review Checklist (plan author)

- [x] **Spec coverage:** All 6 defects + the TYPE normalization add-on + Apple-internal filter are covered:
  - #1 itemN groups → Task 2
  - #2 TYPE noise → Task 1 (helper) + applied in Task 2
  - #3 Quoted TYPE → covered by `normalizeType` (Task 1)
  - #4 Payload size → Task 8 + Task 10 (detail_level)
  - #5 Ambiguity → Task 9 + Task 11
  - #6 X-SOCIALPROFILE → Task 4 + Task 6 (round-trip)
  - X-ABLabel resolution → Task 3
  - Apple-internal filter → Task 5
  - Versioning → Tasks 7 and 13
  - Golden integration test → Task 12
- [x] **No placeholders** — every code block contains concrete code.
- [x] **Type consistency** — `DetailLevel`, `ResolveContactResult`, `SocialProfile` are defined before first use and used identically in subsequent tasks.
- [x] **Commit cadence** — 13 commits (one per task); Task 14 is verification-only.
- [x] **TDD per task** — write failing test → verify failure → implement → verify pass → commit.
