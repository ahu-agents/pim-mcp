# card-mcp: Expanded vCard Fields & Data-Loss Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the vCard parser/builder to support typed emails/phones, addresses, URLs, and other common properties, while fixing the data-loss bug where `updateContact` silently drops unknown vCard properties.

**Architecture:** The `Contact` interface in `pim-core/src/vcard.ts` gains typed objects (`TypedValue`, `PostalAddress`), new fields, and a raw pass-through (`otherProperties`). Parser/builder helpers extract and emit TYPE parameters. card-mcp tools, service, and tests updated for the new shape. Search upgraded to multi-term tokenized matching.

**Tech Stack:** TypeScript, Vitest, Valibot (validation), tsdav (CardDAV client)

**Spec:** `docs/superpowers/specs/2026-03-18-card-mcp-vcard-fields-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/core/src/vcard.ts` | Modify | `TypedValue`, `PostalAddress`, `Contact` interfaces; `parseVCard`, `buildVCard`, new helpers |
| `packages/core/src/index.ts` | Modify | Export `TypedValue`, `PostalAddress` |
| `packages/core/src/__tests__/vcard.test.ts` | Modify | Update existing 5 tests, add new tests for all new fields |
| `packages/card-mcp/src/tools/contactTools.ts` | Modify | Tool schemas + `handleContactTool` for new fields |
| `packages/card-mcp/src/services/CardDavService.ts` | Modify | Merge logic, `searchContacts`, `resolveContact` |
| `packages/card-mcp/src/__tests__/contactTools.test.ts` | Modify | Tool schema tests for new fields |
| `packages/card-mcp/src/__tests__/CardDavService.test.ts` | Modify | Service tests for search, merge, round-trip |

---

### Task 1: Update `Contact` interface, add `TypedValue`/`PostalAddress` types, `extractTypedAll` helper

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__tests__/vcard.test.ts`

**Important:** The `Contact` interface, all new types, and core exports must be updated in this task — before any parser/builder changes — so that intermediate commits never break `tsc`.

- [ ] **Step 1: Update `Contact` interface and add new types**

In `packages/core/src/vcard.ts`, add the new interfaces and update `Contact`:

```typescript
export interface TypedValue {
  type?: string;
  value: string;
}

export interface PostalAddress {
  type?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Contact {
  uid: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  emails: TypedValue[];
  phones: TypedValue[];
  addresses: PostalAddress[];
  urls: TypedValue[];
  organization?: string;
  title?: string;
  role?: string;
  nickname?: string;
  birthday?: string;
  categories?: string[];
  note?: string;
  otherProperties: string[];
}
```

- [ ] **Step 2: Update core exports**

In `packages/core/src/index.ts`, add `TypedValue` and `PostalAddress` to the vcard exports:

```typescript
export {
  type Contact,
  type TypedValue,
  type PostalAddress,
  buildVCard,
  parseVCard,
} from "./vcard.js";
```

- [ ] **Step 3: Update `parseVCard` to return new shape with placeholders**

Update `parseVCard` to return the new `Contact` shape. For now, use empty arrays for `addresses`, `urls`, `otherProperties` and `undefined` for the new simple fields. Convert `extractAll` results to `TypedValue[]` temporarily (just wrapping in `{ value }`) — the full `extractTypedAll` helper comes next:

```typescript
const emails = extractAll(lines, "EMAIL").map(v => ({ value: v }));
const phones = extractAll(lines, "TEL").map(v => ({ value: v }));

return {
  uid, fullName, firstName, lastName, emails, phones,
  addresses: [], urls: [], organization, title, note,
  otherProperties: [],
};
```

- [ ] **Step 4: Update `buildVCard` for new typed shape**

```typescript
for (const email of contact.emails) {
  lines.push(email.type ? `EMAIL;TYPE=${email.type}:${email.value}` : `EMAIL:${email.value}`);
}
for (const phone of contact.phones) {
  lines.push(phone.type ? `TEL;TYPE=${phone.type}:${phone.value}` : `TEL:${phone.value}`);
}
for (const url of contact.urls) {
  lines.push(url.type ? `URL;TYPE=${url.type}:${url.value}` : `URL:${url.value}`);
}
```

Also add placeholders for addresses and otherProperties (implemented in Tasks 2 and 3):

```typescript
// addresses — Task 2
// otherProperties — Task 3
```

- [ ] **Step 5: Update existing tests for new typed shape**

In `packages/core/src/__tests__/vcard.test.ts`:

```typescript
// "parses a full vCard" — update email/phone assertions:
expect(contact.emails).toEqual([
  { value: "john@example.com" },
  { value: "john@work.com" },
]);
expect(contact.phones).toEqual([
  { value: "+1-555-0100" },
  { value: "+1-555-0100" },
]);

// "handles minimal vCard" — unchanged (emails/phones already [])

// "handles vCard 4.0" — update:
expect(contact.emails).toEqual([{ value: "v4@test.com" }]);

// "builds a valid vCard 3.0 string" — update contact literal:
const contact: Contact = {
  uid: "new-1",
  fullName: "Jane Smith",
  firstName: "Jane",
  lastName: "Smith",
  emails: [{ value: "jane@example.com" }],
  phones: [{ value: "+1-555-0100" }],
  addresses: [],
  urls: [],
  organization: "Widgets Co",
  title: "Manager",
  note: "A note",
  otherProperties: [],
};

// "builds vCard with only required fields" — update:
const contact: Contact = {
  uid: "min-1",
  fullName: "Minimal",
  emails: [],
  phones: [],
  addresses: [],
  urls: [],
  otherProperties: [],
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 7: Run full build to verify no type errors**

Run: `npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/index.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "feat(core): update Contact interface with TypedValue, PostalAddress, and new fields"
```

---

### Task 2: Implement `extractTypedAll` helper and typed EMAIL/TEL/URL parsing

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Modify: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 1: Write failing tests for TYPE parameter extraction**

```typescript
it("extracts TYPE parameter from email/phone/url lines", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:t1\nFN:Test\nEMAIL;TYPE=WORK:work@test.com\nEMAIL:plain@test.com\nTEL;TYPE=CELL:+1-555-0100\nTEL;TYPE=WORK;TYPE=VOICE:+1-555-0100\nURL;TYPE=home:https://example.com\nURL:https://other.com\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.emails).toEqual([
    { type: "work", value: "work@test.com" },
    { value: "plain@test.com" },
  ]);
  expect(contact.phones).toEqual([
    { type: "cell", value: "+1-555-0100" },
    { type: "work,voice", value: "+1-555-0100" },
  ]);
  expect(contact.urls).toEqual([
    { type: "home", value: "https://example.com" },
    { value: "https://other.com" },
  ]);
});

it("builds typed EMAIL/TEL/URL lines with TYPE parameter", () => {
  const contact: Contact = {
    uid: "tb1", fullName: "Type Build",
    emails: [{ type: "work", value: "work@test.com" }, { value: "plain@test.com" }],
    phones: [{ type: "cell", value: "+1-555-0100" }],
    addresses: [],
    urls: [{ type: "home", value: "https://example.com" }],
    otherProperties: [],
  };
  const vcard = buildVCard(contact);
  expect(vcard).toContain("EMAIL;TYPE=work:work@test.com");
  expect(vcard).toContain("EMAIL:plain@test.com");
  expect(vcard).toContain("TEL;TYPE=cell:+1-555-0100");
  expect(vcard).toContain("URL;TYPE=home:https://example.com");
});
```

Also update the existing "parses a full vCard" test — SAMPLE_VCARD has `EMAIL;TYPE=HOME` and `TEL;TYPE=CELL`, so update expected values:

```typescript
expect(contact.emails).toEqual([
  { type: "home", value: "john@example.com" },
  { type: "work", value: "john@work.com" },
]);
expect(contact.phones).toEqual([
  { type: "cell", value: "+1-555-0100" },
  { type: "home", value: "+1-555-0100" },
]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — emails missing `type` field, urls empty

- [ ] **Step 3: Implement `extractTypedAll` helper**

```typescript
/** Extract all values for a property with optional TYPE parameter */
function extractTypedAll(lines: string[], property: string): TypedValue[] {
  const results: TypedValue[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith(`${property}:`) || upper.startsWith(`${property};`)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const value = line.slice(colonIndex + 1).trim();
      const paramSection = line.slice(property.length, colonIndex);
      const types: string[] = [];
      for (const match of paramSection.matchAll(/TYPE=([^;,\s]+)/gi)) {
        types.push(match[1].toLowerCase().trim());
      }
      const type = types.length > 0 ? types.join(",") : undefined;
      results.push(type ? { type, value } : { value });
    }
  }
  return results;
}
```

Update `parseVCard` to use `extractTypedAll` for EMAIL, TEL, URL:

```typescript
const emails = extractTypedAll(lines, "EMAIL");
const phones = extractTypedAll(lines, "TEL");
const urls = extractTypedAll(lines, "URL");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "feat(core): implement extractTypedAll for typed email/phone/url parsing"
```

---

### Task 3: Add `PostalAddress` parsing and building (`ADR`)

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Modify: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 1: Write failing tests for ADR parsing**

```typescript
it("parses ADR lines into PostalAddress objects", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:a1\nFN:Addr Test\nADR;TYPE=home:;;123 Main St;Denver;CO;80202;US\nADR;TYPE=work:PO Box 100;Suite 2;456 Oak Ave;Austin;TX;73301;US\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.addresses).toEqual([
    { type: "home", street: "123 Main St", city: "Denver", state: "CO", postalCode: "80202", country: "US" },
    { type: "work", street: "PO Box 100, Suite 2, 456 Oak Ave", city: "Austin", state: "TX", postalCode: "73301", country: "US" },
  ]);
});

it("handles ADR with empty components", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:a2\nFN:Minimal Addr\nADR:;;;;;;US\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.addresses).toEqual([{ country: "US" }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — addresses is `[]`

- [ ] **Step 3: Implement `extractAddresses` helper**

```typescript
function extractAddresses(lines: string[]): PostalAddress[] {
  const results: PostalAddress[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!upper.startsWith("ADR:") && !upper.startsWith("ADR;")) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const paramSection = line.slice(3, colonIndex); // "ADR".length = 3
    const types: string[] = [];
    for (const match of paramSection.matchAll(/TYPE=([^;,]+)/gi)) {
      types.push(match[1].toLowerCase());
    }
    const type = types.length > 0 ? types.join(",") : undefined;

    const parts = line.slice(colonIndex + 1).split(";");
    const streetParts = [parts[0], parts[1], parts[2]].filter(Boolean);
    const street = streetParts.join(", ") || undefined;
    const city = parts[3] || undefined;
    const state = parts[4] || undefined;
    const postalCode = parts[5] || undefined;
    const country = parts[6] || undefined;

    const addr: PostalAddress = {};
    if (type) addr.type = type;
    if (street) addr.street = street;
    if (city) addr.city = city;
    if (state) addr.state = state;
    if (postalCode) addr.postalCode = postalCode;
    if (country) addr.country = country;
    results.push(addr);
  }
  return results;
}
```

Update `parseVCard` to use: `addresses: extractAddresses(lines)`.

- [ ] **Step 4: Add ADR building test**

```typescript
it("builds ADR lines from PostalAddress objects", () => {
  const contact: Contact = {
    uid: "ab1", fullName: "Addr Build",
    emails: [], phones: [],
    addresses: [
      { type: "home", street: "123 Main St", city: "Denver", state: "CO", postalCode: "80202", country: "US" },
    ],
    urls: [], otherProperties: [],
  };
  const vcard = buildVCard(contact);
  expect(vcard).toContain("ADR;TYPE=home:;;123 Main St;Denver;CO;80202;US");
});
```

- [ ] **Step 5: Implement ADR building in `buildVCard`**

```typescript
for (const addr of contact.addresses) {
  const parts = ["", "", addr.street ?? "", addr.city ?? "", addr.state ?? "", addr.postalCode ?? "", addr.country ?? ""];
  const line = addr.type ? `ADR;TYPE=${addr.type}:${parts.join(";")}` : `ADR:${parts.join(";")}`;
  lines.push(line);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "feat(core): add PostalAddress parsing and building for ADR"
```

---

### Task 4: Add simple fields (ORG fix, ROLE, NICKNAME, BDAY, CATEGORIES) and `otherProperties`

**Files:**
- Modify: `packages/core/src/vcard.ts`
- Modify: `packages/core/src/__tests__/vcard.test.ts`

- [ ] **Step 1: Write failing tests for new simple fields and ORG fix**

```typescript
it("extracts ORG first component only, stripping trailing semicolons", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:o1\nFN:Org Test\nORG:Acme Corp;Engineering;Platform\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.organization).toBe("Acme Corp");
});

it("parses ROLE, NICKNAME, BDAY, and CATEGORIES", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:f1\nFN:Fields Test\nROLE:Project Lead\nNICKNAME:Johnny\nBDAY:1990-01-01\nCATEGORIES:Friends,Family,VIP\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.role).toBe("Project Lead");
  expect(contact.nickname).toBe("Johnny");
  expect(contact.birthday).toBe("1990-01-01");
  expect(contact.categories).toEqual(["Friends", "Family", "VIP"]);
});

it("extracts BDAY as-is without normalizing format", () => {
  const compact = `BEGIN:VCARD\nVERSION:3.0\nUID:b1\nFN:Compact\nBDAY:19900101\nEND:VCARD`;
  expect(parseVCard(compact).birthday).toBe("19900101");
  const partial = `BEGIN:VCARD\nVERSION:3.0\nUID:b2\nFN:Partial\nBDAY:--01-01\nEND:VCARD`;
  expect(parseVCard(partial).birthday).toBe("--01-01");
});

it("captures unknown properties in otherProperties", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:r1\nFN:Raw Test\nPHOTO;VALUE=uri:https://example.com/photo.jpg\nX-SOCIALPROFILE;TYPE=twitter:@test\nEND:VCARD`;
  const contact = parseVCard(vcard);
  expect(contact.otherProperties).toEqual([
    "PHOTO;VALUE=uri:https://example.com/photo.jpg",
    "X-SOCIALPROFILE;TYPE=twitter:@test",
  ]);
});

it("round-trips otherProperties through build and parse", () => {
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:rt1\nFN:Roundtrip\nPHOTO;VALUE=uri:https://example.com/photo.jpg\nX-CUSTOM:hello\nEND:VCARD`;
  const contact = parseVCard(vcard);
  const rebuilt = buildVCard(contact);
  const reparsed = parseVCard(rebuilt);
  expect(reparsed.otherProperties).toEqual(contact.otherProperties);
  expect(reparsed.uid).toBe("rt1");
  expect(reparsed.fullName).toBe("Roundtrip");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — `role`, `nickname`, `birthday`, `categories` undefined, `otherProperties` empty or missing

- [ ] **Step 3: Implement new field extraction and ORG fix in `parseVCard`**

Update `parseVCard`:

```typescript
// ORG fix — first component only
const orgRaw = extractFirst(lines, "ORG");
const organization = orgRaw ? orgRaw.split(";")[0].trim() || undefined : undefined;

// New simple fields
const role = extractFirst(lines, "ROLE");
const nickname = extractFirst(lines, "NICKNAME");
const birthday = extractFirst(lines, "BDAY");
const categoriesRaw = extractFirst(lines, "CATEGORIES");
const categories = categoriesRaw ? categoriesRaw.split(",").map(c => c.trim()) : undefined;

// Raw pass-through
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

Add all new fields to the return object.

- [ ] **Step 4: Write build tests for new simple fields**

```typescript
it("builds ROLE, NICKNAME, BDAY, and CATEGORIES lines", () => {
  const contact: Contact = {
    uid: "sf1", fullName: "Simple Fields",
    emails: [], phones: [], addresses: [], urls: [],
    role: "Project Lead",
    nickname: "Johnny",
    birthday: "1990-01-01",
    categories: ["Friends", "Family"],
    otherProperties: [],
  };
  const vcard = buildVCard(contact);
  expect(vcard).toContain("ROLE:Project Lead");
  expect(vcard).toContain("NICKNAME:Johnny");
  expect(vcard).toContain("BDAY:1990-01-01");
  expect(vcard).toContain("CATEGORIES:Friends,Family");
});
```

- [ ] **Step 5: Update `buildVCard` for new fields and `otherProperties`**

Add before `END:VCARD`:

```typescript
if (contact.role) lines.push(`ROLE:${contact.role}`);
if (contact.nickname) lines.push(`NICKNAME:${contact.nickname}`);
if (contact.birthday) lines.push(`BDAY:${contact.birthday}`);
if (contact.categories && contact.categories.length > 0) {
  lines.push(`CATEGORIES:${contact.categories.join(",")}`);
}
for (const raw of contact.otherProperties) {
  lines.push(raw);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 7: Run full build to verify**

Run: `npm run build`
Expected: PASS (no type errors)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/vcard.ts packages/core/src/__tests__/vcard.test.ts
git commit -m "feat(core): add ORG fix, ROLE/NICKNAME/BDAY/CATEGORIES fields, otherProperties pass-through"
```

---

### Task 5: Update card-mcp tool schemas

**Files:**
- Modify: `packages/card-mcp/src/tools/contactTools.ts`
- Modify: `packages/card-mcp/src/__tests__/contactTools.test.ts`

- [ ] **Step 1: Write failing test for new tool schema properties**

Add to `contactTools.test.ts`:

```typescript
it("create_contact has typed email/phone schemas and new fields", () => {
  const tool = CONTACT_TOOLS.find((t) => t.name === "create_contact")!;
  const props = tool.inputSchema.properties as Record<string, any>;

  // emails should be array of objects with type and value
  expect(props.emails.type).toBe("array");
  expect(props.emails.items.type).toBe("object");
  expect(props.emails.items.properties.value).toBeDefined();
  expect(props.emails.items.properties.type).toBeDefined();

  // new fields exist
  expect(props.addresses).toBeDefined();
  expect(props.urls).toBeDefined();
  expect(props.role).toBeDefined();
  expect(props.nickname).toBeDefined();
  expect(props.birthday).toBeDefined();
  expect(props.categories).toBeDefined();
});

it("update_contact has typed email/phone schemas and new fields", () => {
  const tool = CONTACT_TOOLS.find((t) => t.name === "update_contact")!;
  const props = tool.inputSchema.properties as Record<string, any>;
  expect(props.emails.type).toBe("array");
  expect(props.emails.items.type).toBe("object");
  expect(props.addresses).toBeDefined();
  expect(props.urls).toBeDefined();
  expect(props.role).toBeDefined();
  expect(props.nickname).toBeDefined();
  expect(props.birthday).toBeDefined();
  expect(props.categories).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/card-mcp && npx vitest run`
Expected: FAIL — schemas still have old string array shape

- [ ] **Step 3: Update tool schemas in `contactTools.ts`**

Replace `emails` and `phones` schema definitions in both `create_contact` and `update_contact`:

```typescript
emails: {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", description: "Email type (e.g., 'home', 'work')" },
      value: { type: "string", description: "Email address" },
    },
    required: ["value"],
  },
  description: "Email addresses with optional type",
},
phones: {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", description: "Phone type (e.g., 'cell', 'home', 'work')" },
      value: { type: "string", description: "Phone number" },
    },
    required: ["value"],
  },
  description: "Phone numbers with optional type",
},
addresses: {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", description: "Address type (e.g., 'home', 'work')" },
      street: { type: "string", description: "Street address" },
      city: { type: "string", description: "City" },
      state: { type: "string", description: "State/province" },
      postalCode: { type: "string", description: "Postal/ZIP code" },
      country: { type: "string", description: "Country" },
    },
  },
  description: "Postal addresses",
},
urls: {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", description: "URL type (e.g., 'home', 'work')" },
      value: { type: "string", description: "URL" },
    },
    required: ["value"],
  },
  description: "URLs with optional type",
},
role: { type: "string", description: "Role/function within organization" },
nickname: { type: "string", description: "Nickname" },
birthday: { type: "string", description: "Birthday (YYYY-MM-DD)" },
categories: {
  type: "array",
  items: { type: "string" },
  description: "Contact categories/tags",
},
```

- [ ] **Step 4: Update `handleContactTool` for `create_contact` case**

```typescript
case "create_contact": {
  const contact: Contact = {
    uid: randomUUID(),
    fullName: args.fullName as string,
    firstName: args.firstName as string | undefined,
    lastName: args.lastName as string | undefined,
    emails: (args.emails as TypedValue[]) ?? [],
    phones: (args.phones as TypedValue[]) ?? [],
    addresses: (args.addresses as PostalAddress[]) ?? [],
    urls: (args.urls as TypedValue[]) ?? [],
    organization: args.organization as string | undefined,
    title: args.title as string | undefined,
    role: args.role as string | undefined,
    nickname: args.nickname as string | undefined,
    birthday: args.birthday as string | undefined,
    categories: args.categories as string[] | undefined,
    note: args.note as string | undefined,
    otherProperties: [],
  };
  // ... rest unchanged
}
```

- [ ] **Step 5: Update `handleContactTool` for `update_contact` case**

```typescript
case "update_contact": {
  const uid = args.uid as string;
  const updates: Partial<Omit<Contact, "uid" | "otherProperties">> = {};
  if (args.fullName !== undefined) updates.fullName = args.fullName as string;
  if (args.firstName !== undefined) updates.firstName = args.firstName as string;
  if (args.lastName !== undefined) updates.lastName = args.lastName as string;
  if (args.emails !== undefined) updates.emails = args.emails as TypedValue[];
  if (args.phones !== undefined) updates.phones = args.phones as TypedValue[];
  if (args.addresses !== undefined) updates.addresses = args.addresses as PostalAddress[];
  if (args.urls !== undefined) updates.urls = args.urls as TypedValue[];
  if (args.organization !== undefined) updates.organization = args.organization as string;
  if (args.title !== undefined) updates.title = args.title as string;
  if (args.role !== undefined) updates.role = args.role as string;
  if (args.nickname !== undefined) updates.nickname = args.nickname as string;
  if (args.birthday !== undefined) updates.birthday = args.birthday as string;
  if (args.categories !== undefined) updates.categories = args.categories as string[];
  if (args.note !== undefined) updates.note = args.note as string;
  // ... rest unchanged
}
```

Update the import to include `TypedValue`, `PostalAddress` from `@miguelarios/pim-core`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/card-mcp && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/card-mcp/src/tools/contactTools.ts packages/card-mcp/src/__tests__/contactTools.test.ts
git commit -m "feat(card-mcp): update tool schemas and handler for typed fields and new properties"
```

---

### Task 6: Update `CardDavService` — merge logic, search, and `resolveContact`

**Files:**
- Modify: `packages/card-mcp/src/services/CardDavService.ts`
- Modify: `packages/card-mcp/src/__tests__/CardDavService.test.ts`

- [ ] **Step 1: Write failing tests for updated service behavior**

Update existing tests and add new ones in `CardDavService.test.ts`:

```typescript
// Update fetchContacts test — emails is now TypedValue[]
expect(contacts[0].emails).toEqual([{ value: "john@test.com" }]);

// Update createContact test — use typed input
await service.createContact("/dav/addressbooks/users/miguel/contacts/", {
  uid: "new-1",
  fullName: "New Person",
  emails: [{ value: "new@test.com" }],
  phones: [],
  addresses: [],
  urls: [],
  otherProperties: [],
});

// Update existing updateContact test — use typed input
await service.updateContact("/dav/addressbooks/users/miguel/contacts/", "uid-1", {
  fullName: "New Name",
  emails: [{ value: "new@test.com" }],
});

// Update resolveContact test — email assertion unchanged (still plain string)
// but mock vCard will now produce TypedValue

// Add: otherProperties preserved through update
it("preserves otherProperties through update round-trip", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  __mockClient.fetchVCards.mockResolvedValueOnce([
    {
      url: "/dav/contacts/uid-1.vcf",
      etag: '"etag1"',
      data: "BEGIN:VCARD\nVERSION:3.0\nUID:uid-1\nFN:Test\nEMAIL:test@test.com\nPHOTO;VALUE=uri:https://example.com/photo.jpg\nX-CUSTOM:keepme\nEND:VCARD",
    },
  ]);

  await service.connect();
  await service.updateContact("/dav/addressbooks/users/miguel/contacts/", "uid-1", {
    fullName: "Updated Name",
  });

  const updateCall = __mockClient.updateVCard.mock.calls[0][0];
  expect(updateCall.vCard.data).toContain("PHOTO;VALUE=uri:https://example.com/photo.jpg");
  expect(updateCall.vCard.data).toContain("X-CUSTOM:keepme");
  expect(updateCall.vCard.data).toContain("FN:Updated Name");
});

// Add: multi-term tokenized search
it("supports multi-term tokenized search with AND semantics", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  __mockClient.fetchVCards.mockResolvedValueOnce([
    {
      url: "/dav/contacts/1.vcf",
      etag: '"e1"',
      data: "BEGIN:VCARD\nVERSION:3.0\nUID:1\nFN:John Doe\nEMAIL;TYPE=work:john@acme.com\nORG:ACME\nEND:VCARD",
    },
    {
      url: "/dav/contacts/2.vcf",
      etag: '"e2"',
      data: "BEGIN:VCARD\nVERSION:3.0\nUID:2\nFN:Jane Acme\nEMAIL:jane@other.com\nEND:VCARD",
    },
  ]);

  await service.connect();
  const results = await service.searchContacts(
    "/dav/addressbooks/users/miguel/contacts/",
    "acme john",
  );
  expect(results).toHaveLength(1);
  expect(results[0].uid).toBe("1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/card-mcp && npx vitest run`
Expected: FAIL — type mismatches, otherProperties test fails, multi-term search not implemented

- [ ] **Step 3: Update `CardDavService.updateContact` merge logic**

In `packages/card-mcp/src/services/CardDavService.ts`, update the method signature to exclude `otherProperties` from updates (it should always come from the existing contact):

```typescript
async updateContact(
  addressBookUrl: string,
  uid: string,
  updates: Partial<Omit<Contact, "uid" | "otherProperties">>,
): Promise<void> {
```

Update the `merged` object:

```typescript
const merged: Contact = {
  uid: current.uid,
  fullName: updates.fullName ?? current.fullName,
  firstName: updates.firstName ?? current.firstName,
  lastName: updates.lastName ?? current.lastName,
  emails: updates.emails ?? current.emails,
  phones: updates.phones ?? current.phones,
  addresses: updates.addresses ?? current.addresses,
  urls: updates.urls ?? current.urls,
  organization: updates.organization ?? current.organization,
  title: updates.title ?? current.title,
  role: updates.role ?? current.role,
  nickname: updates.nickname ?? current.nickname,
  birthday: updates.birthday ?? current.birthday,
  categories: updates.categories ?? current.categories,
  note: updates.note ?? current.note,
  otherProperties: current.otherProperties, // always from existing
};
```

- [ ] **Step 4: Update `searchContacts` for multi-term tokenized search**

```typescript
async searchContacts(addressBookUrl: string, query: string): Promise<Contact[]> {
  const contacts = await this.fetchContacts(addressBookUrl);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return contacts;

  return contacts.filter((c) => {
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

    return tokens.every(token => searchable.includes(token));
  });
}
```

- [ ] **Step 5: Update `resolveContact` to use `.value`**

```typescript
async resolveContact(
  addressBookUrl: string,
  name: string,
): Promise<{ fullName: string; email: string } | null> {
  const matches = await this.searchContacts(addressBookUrl, name);
  for (const contact of matches) {
    if (contact.emails.length > 0) {
      return { fullName: contact.fullName, email: contact.emails[0].value };
    }
  }
  return null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/card-mcp && npx vitest run`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass across all packages

- [ ] **Step 8: Commit**

```bash
git add packages/card-mcp/src/services/CardDavService.ts packages/card-mcp/src/__tests__/CardDavService.test.ts
git commit -m "feat(card-mcp): update service merge/search/resolve for typed fields and otherProperties"
```

---

### Task 7: Full build verification and PRD/arch doc update

**Files:**
- Modify: `/path/to/project-docs/prd.md`
- Modify: `/path/to/project-docs/architecture-recommendation.md`

- [ ] **Step 1: Run full build and test suite**

Run: `npm run build && npm test && npm run lint && npm run typecheck`
Expected: All pass with no errors

- [ ] **Step 2: Fix any lint issues**

Run: `npm run format`

- [ ] **Step 3: Add server-side CardDAV search as future enhancement to PRD**

Add a section or bullet point under future enhancements:

> **Server-Side CardDAV Search:** CardDAV supports `addressbook-query` REPORT with property-level filtering (contains, starts-with, ends-with, equals), AND/OR combination, and result limiting via RFC 6352. tsdav exposes `addressBookQuery()`. Currently search is client-side; server-side search would improve performance for large address books.

- [ ] **Step 4: Add same to architecture doc**

Add under future considerations or the CardDAV section.

- [ ] **Step 5: Commit**

```bash
git add "/path/to/project-docs/prd.md" "/path/to/project-docs/architecture-recommendation.md"
git commit -m "docs: add server-side CardDAV search to PRD and architecture doc as future enhancement"
```
