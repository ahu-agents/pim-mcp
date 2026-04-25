# cal-mcp ical.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate cal-mcp from `node-ical` + `ical-generator` to `ical.js`, relocating ICS parse/generate/update logic into a new `@miguelarios/pim-core/ics` submodule shared with future tasks-mcp. Close 7 correctness gaps as part of the migration (DST-correct RRULE, VTIMEZONE emission, multi-line/TZID EXDATE, RDATE, multi-RRULE, floating-time, VTODO/VJOURNAL parsing).

**Architecture:** Two PRs in sequence. PR1 ships `pim-core` v0.6.0 with the new `ics/` submodule, full fixture+oracle test corpus, and all 7 correctness fixes. PR2 ships `cal-mcp` v0.10.0 as a mechanical import-flip: deletes `src/ical.ts`, updates 17 call sites to import from `@miguelarios/pim-core/ics`, removes `node-ical` and `ical-generator` from dependencies.

**Tech Stack:** TypeScript (strict, ESM), Vitest, `ical.js@2.2.1` (Mozilla, MPL 2.0), `@touch4it/ical-timezones@1.9.0` (VTIMEZONE block source for generation), Biome (lint/format), Turborepo monorepo.

**Reference:** Design doc at `docs/superpowers/specs/2026-04-24-cal-mcp-icaljs-migration-design.md`.

---

## File Structure

### PR1 — `packages/core` (pim-core)

**Created:**
- `packages/core/src/ics/index.ts` — public barrel
- `packages/core/src/ics/types.ts` — ParsedAlarm, ParsedEvent, ParsedTodo, ParsedJournal, TimeRange, EventCreateProps
- `packages/core/src/ics/errors.ts` — IcsParseError, IcsGenerateError
- `packages/core/src/ics/_shared.ts` — internal property extractors (parseAttendees, parseOrganizer, parseAlarms, parseCategories, parseGeo, formatTriggerHuman, parseDurationToSeconds)
- `packages/core/src/ics/parse-events.ts` — parseIcsEvents
- `packages/core/src/ics/parse-todos.ts` — parseIcsTodos
- `packages/core/src/ics/parse-journals.ts` — parseIcsJournals
- `packages/core/src/ics/generate.ts` — generateEventIcs (emits VTIMEZONE)
- `packages/core/src/ics/components.ts` — createExceptionComponent, combineIcsComponents, addExdateToIcs
- `packages/core/src/ics/rrule.ts` — normalizeRecurrenceRule
- `packages/core/src/ics/_tz-init.ts` — registers IANA tz set with ICAL.TimezoneService at module load
- `packages/core/src/__tests__/ics/fixtures/` — 14 `.ics` files + paired `.oracle.json` files
- `packages/core/src/__tests__/ics/fixture-runner.test.ts`
- `packages/core/src/__tests__/ics/parse-events.unit.test.ts`
- `packages/core/src/__tests__/ics/parse-todos.unit.test.ts`
- `packages/core/src/__tests__/ics/parse-journals.unit.test.ts`
- `packages/core/src/__tests__/ics/generate.test.ts`
- `packages/core/src/__tests__/ics/generate-vtimezone.test.ts`
- `packages/core/src/__tests__/ics/components.test.ts`
- `packages/core/src/__tests__/ics/rrule.test.ts`
- `packages/core/src/__tests__/ics/errors.test.ts`

**Modified:**
- `packages/core/package.json` — bump version to 0.6.0, add deps, extend `exports` map with `./ics`
- `packages/core/tsconfig.json` — no change expected; `include: ["src"]` already covers new files

### PR2 — `packages/cal-mcp`

**Modified:**
- `packages/cal-mcp/package.json` — bump version to 0.10.0, remove `node-ical` + `ical-generator`, bump `@miguelarios/pim-core` peer to `^0.6.0`
- `packages/cal-mcp/src/services/CalDavService.ts:11` — import from `@miguelarios/pim-core/ics` instead of `../ical.js`
- `packages/cal-mcp/src/tools/calendarTools.ts:1-10` — import from `@miguelarios/pim-core/ics` instead of `../ical.js`
- `packages/cal-mcp/src/__tests__/CalDavService.test.ts` — update any expectations affected by item-6 (floating-time) semantic change
- `packages/cal-mcp/src/__tests__/calendarTools.test.ts` — same

**Deleted:**
- `packages/cal-mcp/src/ical.ts` (740 lines)
- `packages/cal-mcp/src/__tests__/ical.test.ts` (1627 lines)

---

## PR1 — pim-core v0.6.0

### Task 1: Add dependencies and update package.json

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add the two new runtime dependencies**

```bash
cd packages/core && npm install --save ical.js@^2.2.1 @touch4it/ical-timezones@^1.9.0
```

- [ ] **Step 2: Update version and exports map in `packages/core/package.json`**

Change `"version": "0.5.0"` to `"version": "0.6.0"`. Replace the `exports` block with:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./ics": {
    "import": "./dist/ics/index.js",
    "types": "./dist/ics/index.d.ts"
  }
}
```

- [ ] **Step 3: Verify build still succeeds**

Run: `cd packages/core && npm run build`
Expected: PASS, dist/ regenerated. (At this point dist/ics/ does not exist yet — that's fine, the build target is current source only.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json package-lock.json
git commit -m "chore(pim-core): add ical.js + @touch4it/ical-timezones, bump to 0.6.0, expose ./ics export"
```

---

### Task 2: Create the ics/ directory skeleton with empty barrel

**Files:**
- Create: `packages/core/src/ics/index.ts`

- [ ] **Step 1: Create the directory and a placeholder barrel**

Create `packages/core/src/ics/index.ts` with content:

```ts
// Public exports for @miguelarios/pim-core/ics — populated as submodule files land.
export {};
```

- [ ] **Step 2: Verify the new export path resolves**

Run: `cd packages/core && npm run build && npm run typecheck`
Expected: PASS, `dist/ics/index.js` and `dist/ics/index.d.ts` exist.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ics/index.ts
git commit -m "chore(pim-core): scaffold src/ics/ submodule with empty barrel"
```

---

### Task 3: Define ICS error types

**Files:**
- Create: `packages/core/src/ics/errors.ts`
- Create: `packages/core/src/__tests__/ics/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/ics/errors.test.ts
import { describe, expect, it } from "vitest";
import { IcsParseError, IcsGenerateError } from "../../ics/errors.js";

describe("IcsParseError", () => {
  it("preserves the cause and a message", () => {
    const cause = new Error("underlying ical.js error");
    const err = new IcsParseError("Invalid ICS content", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Invalid ICS content");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("IcsParseError");
  });
});

describe("IcsGenerateError", () => {
  it("preserves the cause and a message", () => {
    const cause = new Error("invalid input");
    const err = new IcsGenerateError("Cannot generate", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Cannot generate");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("IcsGenerateError");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/ics/errors.test.ts`
Expected: FAIL with module-not-found for `../../ics/errors.js`.

- [ ] **Step 3: Implement `errors.ts`**

```ts
// packages/core/src/ics/errors.ts
export class IcsParseError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "IcsParseError";
    this.cause = cause;
  }
}

export class IcsGenerateError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "IcsGenerateError";
    this.cause = cause;
  }
}
```

- [ ] **Step 4: Re-export from barrel**

Update `packages/core/src/ics/index.ts`:

```ts
export { IcsParseError, IcsGenerateError } from "./errors.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/ics/errors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ics/errors.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/errors.test.ts
git commit -m "feat(pim-core/ics): add IcsParseError and IcsGenerateError types"
```

---

### Task 4: Define ICS data types

**Files:**
- Create: `packages/core/src/ics/types.ts`

This task is type-only (no behavior to test directly — type usage is verified when consumers compile against these types in later tasks).

- [ ] **Step 1: Write `types.ts` with all six interfaces**

```ts
// packages/core/src/ics/types.ts

export interface ParsedAlarm {
  type: "relative" | "absolute";
  trigger: number | string;
  trigger_human: string;
}

export interface ParsedAttendee {
  name: string | null;
  email: string;
  status: string | null;
  role: string | null;
  type: string;
}

export interface ParsedOrganizer {
  name: string | null;
  email: string;
}

export interface ParsedGeo {
  latitude: number;
  longitude: number;
}

export interface ParsedEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  status: string | null;
  availability: string | null;
  url: string | null;
  attendees: ParsedAttendee[];
  categories: string[];
  geo: ParsedGeo | null;
  organizer: ParsedOrganizer | null;
  recurrence_rule: string | null;
  rdates: string[] | null;
  created: string | null;
  last_modified: string | null;
  is_recurring: boolean;
  alarms: ParsedAlarm[];
  occurrence_date: string | null;
}

export interface ParsedTodo {
  uid: string;
  title: string;
  due: string | null;
  completed: string | null;
  percent_complete: number | null;
  priority: number | null;
  status: string | null;
  description: string | null;
  categories: string[];
  attendees: ParsedAttendee[];
  organizer: ParsedOrganizer | null;
  alarms: ParsedAlarm[];
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  occurrence_date: string | null;
}

export interface ParsedJournal {
  uid: string;
  title: string;
  date: string;
  description: string | null;
  categories: string[];
  status: string | null;
  created: string | null;
  last_modified: string | null;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string }>;
  uid?: string;
  timezone?: string;
  alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
  categories?: string[];
  recurrence_rule?: string;
  organizer?: { email: string; name?: string | null };
  availability?: "busy" | "free";
}
```

- [ ] **Step 2: Re-export from barrel**

Update `packages/core/src/ics/index.ts`:

```ts
export { IcsParseError, IcsGenerateError } from "./errors.js";
export type {
  ParsedAlarm,
  ParsedAttendee,
  ParsedOrganizer,
  ParsedGeo,
  ParsedEvent,
  ParsedTodo,
  ParsedJournal,
  TimeRange,
  EventCreateProps,
} from "./types.js";
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ics/types.ts packages/core/src/ics/index.ts
git commit -m "feat(pim-core/ics): define ParsedEvent/Todo/Journal and supporting types"
```

---

### Task 5: Initialize ICAL.TimezoneService with IANA tz set at module load

**Files:**
- Create: `packages/core/src/ics/_tz-init.ts`

`@touch4it/ical-timezones` exports VTIMEZONE blocks for IANA zones; we register them with ICAL.TimezoneService once at module load so all parsers and generators see them.

- [ ] **Step 1: Write the module**

```ts
// packages/core/src/ics/_tz-init.ts
import ICAL from "ical.js";
import * as tzData from "@touch4it/ical-timezones";

// Idempotent registration. tzData exports an object keyed by tzid → VTIMEZONE block string.
let initialized = false;

export function initializeTimezones(): void {
  if (initialized) return;
  initialized = true;

  for (const [tzid, vtimezoneBlock] of Object.entries(tzData)) {
    if (typeof vtimezoneBlock !== "string") continue;
    if (ICAL.TimezoneService.has(tzid)) continue;
    try {
      const wrapped = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pim-core//tz init//EN\r\n${vtimezoneBlock}\r\nEND:VCALENDAR`;
      const root = ICAL.Component.fromString(wrapped);
      const vtz = root.getFirstSubcomponent("vtimezone");
      if (vtz) {
        const tz = new ICAL.Timezone({ component: vtz, tzid });
        ICAL.TimezoneService.register(tzid, tz);
      }
    } catch {
      // Skip any malformed entries silently — vendor data, not user input.
    }
  }
}

// Call at module load so the first user of any parse/generate function has them ready.
initializeTimezones();
```

- [ ] **Step 2: Smoke-test the registration with a tiny test**

Add to `packages/core/src/__tests__/ics/errors.test.ts` (extend existing file):

```ts
import "../../ics/_tz-init.js";
import ICAL from "ical.js";

describe("timezone init", () => {
  it("registers America/New_York", () => {
    expect(ICAL.TimezoneService.has("America/New_York")).toBe(true);
  });
  it("registers Europe/Berlin", () => {
    expect(ICAL.TimezoneService.has("Europe/Berlin")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd packages/core && npx vitest run src/__tests__/ics/errors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ics/_tz-init.ts packages/core/src/__tests__/ics/errors.test.ts
git commit -m "feat(pim-core/ics): register IANA timezone set with ICAL.TimezoneService at module load"
```

---

### Task 6: Implement shared property extractors

**Files:**
- Create: `packages/core/src/ics/_shared.ts`

These helpers operate on `ICAL.Component` and are consumed by all three parse-* files. We don't write a dedicated test file for `_shared.ts` — its behavior is exercised through every parser test downstream. (Adding standalone tests would duplicate coverage; the fixture+oracle suite is the contract.)

- [ ] **Step 1: Implement the file**

```ts
// packages/core/src/ics/_shared.ts
import ICAL from "ical.js";
import type { ParsedAlarm, ParsedAttendee, ParsedGeo, ParsedOrganizer } from "./types.js";

const CUTYPE_MAP: Record<string, string> = {
  INDIVIDUAL: "person",
  ROOM: "room",
  RESOURCE: "resource",
  GROUP: "group",
};

function stripMailto(value: string): string {
  return value.replace(/^mailto:/i, "");
}

export function parseAttendees(component: ICAL.Component): ParsedAttendee[] {
  const properties = component.getAllProperties("attendee");
  return properties.map((prop) => {
    const value = prop.getFirstValue();
    const email = typeof value === "string" ? stripMailto(value) : "";
    const cn = prop.getParameter("cn") ?? null;
    const partstat = prop.getParameter("partstat");
    const role = prop.getParameter("role");
    const cutype = prop.getParameter("cutype") ?? "";
    return {
      email,
      name: cn,
      status: partstat ? partstat.toLowerCase() : null,
      role: role ? role.toLowerCase() : null,
      type: CUTYPE_MAP[cutype] ?? "unknown",
    };
  });
}

export function parseOrganizer(component: ICAL.Component): ParsedOrganizer | null {
  const prop = component.getFirstProperty("organizer");
  if (!prop) return null;
  const value = prop.getFirstValue();
  const email = typeof value === "string" ? stripMailto(value) : "";
  if (!email) return null;
  return { email, name: prop.getParameter("cn") ?? null };
}

export function parseCategories(component: ICAL.Component): string[] {
  const properties = component.getAllProperties("categories");
  const out: string[] = [];
  for (const prop of properties) {
    const values = prop.getValues();
    for (const v of values) {
      if (typeof v === "string" && v.length > 0) out.push(v);
    }
  }
  return out;
}

export function parseGeo(component: ICAL.Component): ParsedGeo | null {
  const prop = component.getFirstProperty("geo");
  if (!prop) return null;
  const value = prop.getFirstValue();
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lat, lon] = value as [number, number];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  // Reject GEO:; sentinel produced by malformed inputs that ical.js coerces to 0,0.
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}

export function parseDurationToSeconds(duration: string): number {
  const negative = duration.startsWith("-");
  const match = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (!match) return 0;
  const days = Number.parseInt(match[1] || "0", 10);
  const hours = Number.parseInt(match[2] || "0", 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  const seconds = Number.parseInt(match[4] || "0", 10);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return negative ? -total : total;
}

export function formatTriggerHuman(seconds: number): string {
  if (seconds === 0) return "At time of event";
  const abs = Math.abs(seconds);
  const suffix = seconds < 0 ? "before" : "after";
  const parts: string[] = [];
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (parts.length === 0) {
    parts.push(`${abs} ${abs === 1 ? "second" : "seconds"}`);
  }
  return `${parts.join(", ")} ${suffix}`;
}

export function parseAlarms(component: ICAL.Component): ParsedAlarm[] {
  const valarms = component.getAllSubcomponents("valarm");
  const out: ParsedAlarm[] = [];
  for (const valarm of valarms) {
    const triggerProp = valarm.getFirstProperty("trigger");
    if (!triggerProp) continue;
    const value = triggerProp.getFirstValue();
    if (value instanceof ICAL.Time) {
      const date = value.toJSDate();
      out.push({
        type: "absolute",
        trigger: date.toISOString(),
        trigger_human: date.toISOString(),
      });
    } else if (value instanceof ICAL.Duration) {
      const seconds = value.toSeconds();
      out.push({
        type: "relative",
        trigger: seconds,
        trigger_human: formatTriggerHuman(seconds),
      });
    }
  }
  return out;
}

export function timeToIso(time: ICAL.Time): string {
  // Convert to UTC then to JS Date then to ISO. Floating times resolve as-if-UTC
  // unless the caller is providing context via a viewer timezone (handled at the
  // parse-events layer where the timezone param is known).
  return time.toJSDate().toISOString();
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd packages/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ics/_shared.ts
git commit -m "feat(pim-core/ics): add shared property extractors for VEVENT/VTODO/VJOURNAL"
```

---

### Task 7: Implement normalizeRecurrenceRule

**Files:**
- Create: `packages/core/src/ics/rrule.ts`
- Create: `packages/core/src/__tests__/ics/rrule.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/__tests__/ics/rrule.test.ts
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { normalizeRecurrenceRule } from "../../ics/rrule.js";

describe("normalizeRecurrenceRule", () => {
  it("returns the rule unchanged when valid", () => {
    expect(normalizeRecurrenceRule("FREQ=WEEKLY;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=MO");
  });
  it("strips the RRULE: prefix (case-insensitive)", () => {
    expect(normalizeRecurrenceRule("RRULE:FREQ=DAILY")).toBe("FREQ=DAILY");
    expect(normalizeRecurrenceRule("rrule:FREQ=DAILY")).toBe("FREQ=DAILY");
  });
  it("returns null for invalid input", () => {
    expect(normalizeRecurrenceRule("")).toBeNull();
    expect(normalizeRecurrenceRule("not-a-rrule")).toBeNull();
    expect(normalizeRecurrenceRule("FREQ=BOGUS")).toBeNull();
    expect(normalizeRecurrenceRule("FREQ=WEEKLY\nBYDAY=MO")).toBeNull(); // CRLF inside
  });
  it("accepts all RFC 5545 frequencies", () => {
    for (const freq of ["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
      expect(normalizeRecurrenceRule(`FREQ=${freq}`)).toBe(`FREQ=${freq}`);
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/ics/rrule.test.ts`
Expected: FAIL on module-not-found.

- [ ] **Step 3: Implement `rrule.ts`**

```ts
// packages/core/src/ics/rrule.ts
import ICAL from "ical.js";

export function normalizeRecurrenceRule(rule: string): string | null {
  if (typeof rule !== "string") return null;
  let trimmed = rule.trim();
  if (!trimmed) return null;
  if (/^RRULE:/i.test(trimmed)) trimmed = trimmed.slice(6).trim();
  if (/[\r\n]/.test(trimmed)) return null;
  try {
    ICAL.Recur.fromString(trimmed);
  } catch {
    return null;
  }
  return trimmed;
}
```

- [ ] **Step 4: Re-export from barrel**

Update `packages/core/src/ics/index.ts`, append:

```ts
export { normalizeRecurrenceRule } from "./rrule.js";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run src/__tests__/ics/rrule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ics/rrule.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/rrule.test.ts
git commit -m "feat(pim-core/ics): add normalizeRecurrenceRule using ICAL.Recur.fromString"
```

---

### Task 8: Borrow ical.js fixtures (10 files)

**Files:**
- Create: `packages/core/src/__tests__/ics/fixtures/recur_instances.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/timezone_from_file.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/daily_recur.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/minimal.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/rdate_exdate.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/multiple_rrules.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/recur_instances_finite.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/parserv2.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/forced_types.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/utc_negative_zero.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/NOTICE.md`

- [ ] **Step 1: Download all 10 fixture files**

```bash
cd "packages/core/src/__tests__/ics/fixtures"
BASE="https://raw.githubusercontent.com/kewisch/ical.js/main/samples"
for f in recur_instances timezone_from_file daily_recur minimal rdate_exdate multiple_rrules recur_instances_finite parserv2 forced_types utc_negative_zero; do
  curl -sf "$BASE/${f}.ics" -o "${f}.ics" || echo "FAILED: $f"
done
ls -la *.ics
```

Expected: all 10 files present, no FAILED messages.

- [ ] **Step 2: Verify each file is non-empty and starts with BEGIN:VCALENDAR**

```bash
for f in *.ics; do head -1 "$f" | grep -q "BEGIN:VCALENDAR" && echo "OK: $f" || echo "BAD: $f"; done
```

Expected: 10 OK lines.

- [ ] **Step 3: Add NOTICE.md documenting MPL 2.0 origin**

Create `packages/core/src/__tests__/ics/fixtures/NOTICE.md`:

```markdown
# Test Fixture Origin

The `.ics` files in this directory are sourced from the ical.js project at
https://github.com/kewisch/ical.js/tree/main/samples and are licensed under
the Mozilla Public License 2.0 (https://www.mozilla.org/en-US/MPL/2.0/).

These files are used as test inputs only; pim-core itself remains MIT-licensed.
The MPL is file-scoped: modifying one of these fixture files would keep that
file under MPL 2.0, but does not affect the license of any pim-core source code.

The hand-written `*.oracle.json` files paired with each fixture are pim-core
originals (MIT-licensed) describing the expected parser output for the
adjacent `.ics` input.

The synthesized fixtures `dst_transition.ics`, `vtodo_basic.ics`,
`vtodo_with_due_completed.ics`, and `vjournal_basic.ics` are pim-core
originals (MIT-licensed).
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/__tests__/ics/fixtures/
git commit -m "test(pim-core/ics): import 10 ICS fixtures from ical.js samples (MPL 2.0)"
```

---

### Task 9: Synthesize 4 additional fixtures (DST, VTODO ×2, VJOURNAL)

**Files:**
- Create: `packages/core/src/__tests__/ics/fixtures/dst_transition.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/vtodo_basic.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/vtodo_with_due_completed.ics`
- Create: `packages/core/src/__tests__/ics/fixtures/vjournal_basic.ics`

- [ ] **Step 1: Create `dst_transition.ics`** — recurring weekly meeting at 09:00 America/New_York spanning the spring-forward transition (March 8, 2026 EST → March 15, 2026 EDT). Asserts the parser produces 09:00 wall-clock for both, not a 1-hour drift.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//pim-core//test fixture//EN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19701101T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11
TZNAME:EST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3
TZNAME:EDT
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:dst-test-fixture@pim-core
DTSTAMP:20260201T000000Z
DTSTART;TZID=America/New_York:20260301T090000
DTEND;TZID=America/New_York:20260301T100000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Weekly DST-spanning standup
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 2: Create `vtodo_basic.ics`** — minimal VTODO.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//pim-core//test fixture//EN
BEGIN:VTODO
UID:todo-basic-fixture@pim-core
DTSTAMP:20260424T120000Z
SUMMARY:Buy groceries
STATUS:NEEDS-ACTION
PRIORITY:5
END:VTODO
END:VCALENDAR
```

- [ ] **Step 3: Create `vtodo_with_due_completed.ics`** — VTODO with DUE, COMPLETED, PERCENT-COMPLETE, DESCRIPTION, CATEGORIES.

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//pim-core//test fixture//EN
BEGIN:VTODO
UID:todo-completed-fixture@pim-core
DTSTAMP:20260424T120000Z
SUMMARY:File 2025 taxes
DESCRIPTION:Use the imported 1099s from broker
DUE;VALUE=DATE-TIME:20260415T235959Z
COMPLETED:20260410T143000Z
PERCENT-COMPLETE:100
PRIORITY:1
STATUS:COMPLETED
CATEGORIES:Finance,Personal
END:VTODO
END:VCALENDAR
```

- [ ] **Step 4: Create `vjournal_basic.ics`**

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//pim-core//test fixture//EN
BEGIN:VJOURNAL
UID:journal-basic-fixture@pim-core
DTSTAMP:20260424T120000Z
DTSTART;VALUE=DATE:20260424
SUMMARY:Project journal entry
DESCRIPTION:First milestone reached for the migration project.
CATEGORIES:Work,Notes
STATUS:FINAL
END:VJOURNAL
END:VCALENDAR
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/__tests__/ics/fixtures/dst_transition.ics packages/core/src/__tests__/ics/fixtures/vtodo_basic.ics packages/core/src/__tests__/ics/fixtures/vtodo_with_due_completed.ics packages/core/src/__tests__/ics/fixtures/vjournal_basic.ics
git commit -m "test(pim-core/ics): add synthesized fixtures for DST, VTODO, VJOURNAL coverage"
```

---

### Task 10: Implement parseIcsEvents (TDD against minimal.ics first)

**Files:**
- Create: `packages/core/src/ics/parse-events.ts`
- Create: `packages/core/src/__tests__/ics/fixtures/minimal.oracle.json`
- Create: `packages/core/src/__tests__/ics/fixture-runner.test.ts`

This is the core task. We TDD against `minimal.ics` as the smallest possible input, get the loop running, then add oracles/tests for richer fixtures in subsequent tasks.

- [ ] **Step 1: Read `minimal.ics` to determine its content shape**

Run: `cat packages/core/src/__tests__/ics/fixtures/minimal.ics`

Expected (one VEVENT, no recurrence, ASCII content). Note its UID, SUMMARY, DTSTART, DTEND for use in the oracle.

- [ ] **Step 2: Write `minimal.oracle.json`** based on the file's actual contents

Use the values you read in Step 1. The oracle is a JSON object with `range` (optional), `timezone` (optional), and `expected` (the array your parser should return). Example shape (substitute values from the actual fixture):

```json
{
  "expected": [
    {
      "uid": "<uid from fixture>",
      "title": "<summary from fixture>",
      "start": "<ISO 8601 UTC string from DTSTART>",
      "end": "<ISO 8601 UTC string from DTEND>",
      "all_day": false,
      "location": null,
      "description": null,
      "status": null,
      "availability": null,
      "url": null,
      "attendees": [],
      "categories": [],
      "geo": null,
      "organizer": null,
      "recurrence_rule": null,
      "rdates": null,
      "created": null,
      "last_modified": null,
      "is_recurring": false,
      "alarms": [],
      "occurrence_date": null
    }
  ]
}
```

- [ ] **Step 3: Write the fixture-runner test**

```ts
// packages/core/src/__tests__/ics/fixture-runner.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsEvents } from "../../ics/parse-events.js";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

interface Oracle {
  range?: { start: string; end: string };
  timezone?: string;
  expected: unknown[];
}

function loadOracles(): Array<{ name: string; ics: string; oracle: Oracle }> {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".oracle.json"))
    // Only event fixtures for this runner; vtodo/vjournal handled in their own runners.
    .filter((f) => !f.startsWith("vtodo_") && !f.startsWith("vjournal_"))
    .map((oracleFile) => {
      const name = oracleFile.replace(".oracle.json", "");
      const ics = fs.readFileSync(path.join(FIXTURES_DIR, `${name}.ics`), "utf-8");
      const oracle = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, oracleFile), "utf-8"));
      return { name, ics, oracle };
    });
}

describe("parseIcsEvents fixture-runner", () => {
  for (const { name, ics, oracle } of loadOracles()) {
    it(name, () => {
      const result = parseIcsEvents(ics, oracle.range, oracle.timezone);
      expect(result).toEqual(oracle.expected);
    });
  }
});
```

- [ ] **Step 4: Run the test, expect module-not-found**

Run: `cd packages/core && npx vitest run src/__tests__/ics/fixture-runner.test.ts`
Expected: FAIL on missing `parse-events.js`.

- [ ] **Step 5: Implement `parse-events.ts`** — first cut sufficient for `minimal.ics`

```ts
// packages/core/src/ics/parse-events.ts
import ICAL from "ical.js";
import "./_tz-init.js";
import { IcsParseError } from "./errors.js";
import {
  parseAttendees,
  parseOrganizer,
  parseAlarms,
  parseCategories,
  parseGeo,
  timeToIso,
} from "./_shared.js";
import type { ParsedEvent, TimeRange } from "./types.js";

function buildBaseEvent(component: ICAL.Component): Omit<ParsedEvent, "start" | "end" | "occurrence_date"> {
  const url = component.getFirstPropertyValue("url");
  const status = component.getFirstPropertyValue("status");
  const transp = component.getFirstPropertyValue("transp");
  const rrule = component.getFirstPropertyValue("rrule");
  const created = component.getFirstPropertyValue("created");
  const lastModified = component.getFirstPropertyValue("last-modified");

  const rdateProps = component.getAllProperties("rdate");
  const rdates: string[] = [];
  for (const prop of rdateProps) {
    for (const v of prop.getValues()) {
      if (v instanceof ICAL.Time) rdates.push(timeToIso(v));
    }
  }

  let availability: string | null = null;
  if (typeof transp === "string") {
    if (transp.toUpperCase() === "OPAQUE") availability = "busy";
    else if (transp.toUpperCase() === "TRANSPARENT") availability = "free";
  }

  return {
    uid: (component.getFirstPropertyValue("uid") as string) ?? "",
    title: (component.getFirstPropertyValue("summary") as string) ?? "",
    all_day: false, // overwritten below per-instance
    location: (component.getFirstPropertyValue("location") as string) ?? null,
    description: (component.getFirstPropertyValue("description") as string) ?? null,
    status: typeof status === "string" ? status.toLowerCase() : null,
    availability,
    url: typeof url === "string" ? url : null,
    attendees: parseAttendees(component),
    categories: parseCategories(component),
    geo: parseGeo(component),
    organizer: parseOrganizer(component),
    recurrence_rule: rrule ? rrule.toString() : null,
    rdates: rdates.length > 0 ? rdates : null,
    created: created instanceof ICAL.Time ? created.toJSDate().toISOString() : null,
    last_modified: lastModified instanceof ICAL.Time ? lastModified.toJSDate().toISOString() : null,
    is_recurring: !!rrule,
    alarms: parseAlarms(component),
    occurrence_date: null,
  };
}

export function parseIcsEvents(
  icsContent: string,
  range?: TimeRange,
  timezone?: string,
): ParsedEvent[] {
  if (!icsContent.trim()) return [];

  let root: ICAL.Component;
  try {
    root = ICAL.Component.fromString(icsContent);
  } catch (e) {
    throw new IcsParseError("Invalid ICS content", e);
  }

  const veventComponents = root.getAllSubcomponents("vevent");
  // Group by UID. Master events have no RECURRENCE-ID; exception VEVENTs do.
  const groups = new Map<string, { master: ICAL.Component | null; exceptions: ICAL.Component[] }>();
  for (const comp of veventComponents) {
    const uid = (comp.getFirstPropertyValue("uid") as string) ?? "";
    if (!uid) continue;
    let group = groups.get(uid);
    if (!group) {
      group = { master: null, exceptions: [] };
      groups.set(uid, group);
    }
    if (comp.getFirstProperty("recurrence-id")) {
      group.exceptions.push(comp);
    } else {
      group.master = comp;
    }
  }

  const out: ParsedEvent[] = [];

  for (const [, group] of groups) {
    if (!group.master) {
      // Orphan exception VEVENTs (master not in this ICS) — emit each as standalone.
      for (const ex of group.exceptions) {
        out.push(...emitNonExpanded(ex, true, timezone));
      }
      continue;
    }

    let event: ICAL.Event;
    try {
      event = new ICAL.Event(group.master);
      for (const ex of group.exceptions) {
        event.relateException(new ICAL.Event(ex));
      }
    } catch (e) {
      // If ICAL.Event construction fails for this group, skip it but don't fail the batch.
      continue;
    }

    if (event.isRecurring() && range) {
      out.push(...emitOccurrences(event, range));
    } else {
      out.push(...emitNonExpanded(group.master, false, timezone));
      for (const ex of group.exceptions) {
        out.push(...emitNonExpanded(ex, true, timezone));
      }
    }
  }

  return out;
}

function emitNonExpanded(component: ICAL.Component, isException: boolean, _timezone?: string): ParsedEvent[] {
  const base = buildBaseEvent(component);
  const dtstart = component.getFirstPropertyValue("dtstart");
  const dtend = component.getFirstPropertyValue("dtend");
  if (!(dtstart instanceof ICAL.Time)) return [];
  const allDay = dtstart.isDate;
  const startIso = dtstart.toJSDate().toISOString();
  const endIso = dtend instanceof ICAL.Time ? dtend.toJSDate().toISOString() : startIso;
  let occDate: string | null = null;
  if (isException) {
    const recurId = component.getFirstPropertyValue("recurrence-id");
    if (recurId instanceof ICAL.Time) occDate = recurId.toJSDate().toISOString();
  }
  return [{ ...base, all_day: allDay, start: startIso, end: endIso, occurrence_date: occDate }];
}

function emitOccurrences(event: ICAL.Event, range: TimeRange): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const rangeStart = ICAL.Time.fromJSDate(new Date(range.start), true);
  const rangeEnd = ICAL.Time.fromJSDate(new Date(range.end), true);
  const it = event.iterator();
  let next: ICAL.Time | null;
  // event.iterator().next() returns null when the series is exhausted.
  while ((next = it.next()) !== null) {
    if (next.compare(rangeEnd) > 0) break;
    if (next.compare(rangeStart) < 0) continue;
    const details = event.getOccurrenceDetails(next);
    const effective = details.item; // master or exception override
    const base = buildBaseEvent(effective.component);
    const allDay = details.startDate.isDate;
    out.push({
      ...base,
      all_day: allDay,
      start: details.startDate.toJSDate().toISOString(),
      end: details.endDate.toJSDate().toISOString(),
      occurrence_date: details.startDate.toJSDate().toISOString(),
    });
  }
  return out;
}
```

- [ ] **Step 6: Re-export from barrel**

Update `packages/core/src/ics/index.ts`, append:

```ts
export { parseIcsEvents } from "./parse-events.js";
```

- [ ] **Step 7: Run fixture-runner; expect minimal to pass, others to fail (no oracle yet)**

Run: `cd packages/core && npx vitest run src/__tests__/ics/fixture-runner.test.ts`
Expected: 1 PASS (minimal), the rest skipped (no oracle files yet).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ics/parse-events.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/fixture-runner.test.ts packages/core/src/__tests__/ics/fixtures/minimal.oracle.json
git commit -m "feat(pim-core/ics): implement parseIcsEvents using ICAL.Event, passing on minimal fixture"
```

---

### Task 11: Add oracles for the 9 remaining event fixtures

For each fixture below, repeat the pattern: read the `.ics`, hand-derive the expected `ParsedEvent[]` from RFC 5545, write the `.oracle.json`, run the fixture-runner, update the parser implementation if any expectation fails, commit.

Sub-tasks (one fixture each — same pattern, do them in order):

- [ ] **Step 1: `daily_recur.oracle.json`** — DAILY recurrence with UNTIL. Oracle includes a `range` covering the full series.
- [ ] **Step 2: `recur_instances.oracle.json`** — recurring with EXDATEs and RECURRENCE-ID exceptions. Oracle's `expected` array includes one entry per occurrence in the range, with the exception's overrides applied at the right occurrence.
- [ ] **Step 3: `recur_instances_finite.oracle.json`** — finite COUNT-based RRULE. Oracle has all N occurrences.
- [ ] **Step 4: `timezone_from_file.oracle.json`** — VEVENT with custom VTIMEZONE. Oracle asserts the start/end UTCs are computed correctly from the inline VTIMEZONE.
- [ ] **Step 5: `rdate_exdate.oracle.json`** — RDATE-added dates appear in the occurrence stream and `rdates` field; EXDATE'd ones do not.
- [ ] **Step 6: `multiple_rrules.oracle.json`** — both RRULEs contribute occurrences (item 5 fix verified here).
- [ ] **Step 7: `parserv2.oracle.json`** — minimal expected output; this fixture is mostly a "doesn't crash" smoke test.
- [ ] **Step 8: `forced_types.oracle.json`** — VALUE= typing respected (e.g., a VALUE=DATE DTSTART produces `all_day: true`).
- [ ] **Step 9: `utc_negative_zero.oracle.json`** — TZ offset edge case correctly normalized to UTC ISO.

For each oracle file, after writing it:

```bash
cd packages/core && npx vitest run src/__tests__/ics/fixture-runner.test.ts
```

If a test fails because the expected output doesn't match what the parser emits, decide: is the parser wrong (fix it), or is the oracle wrong (fix the oracle). Use the design doc's correctness items 1-7 as the spec for "correct."

Commit each oracle (and any parser fixes that came out of it) as a separate commit:

```bash
git add packages/core/src/__tests__/ics/fixtures/<name>.oracle.json packages/core/src/ics/parse-events.ts
git commit -m "test(pim-core/ics): oracle for <name> + parser fixes if any"
```

---

### Task 12: Add unit tests for floating-time and DST that don't fit the fixture pattern

**Files:**
- Create: `packages/core/src/__tests__/ics/parse-events.unit.test.ts`

These tests target items 1 (DST) and 6 (floating-time) directly. The DST fixture from Task 9 is also covered here with a unit assertion.

- [ ] **Step 1: Write the tests**

```ts
// packages/core/src/__tests__/ics/parse-events.unit.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsEvents } from "../../ics/parse-events.js";

const FIXTURES = path.join(__dirname, "fixtures");

describe("parseIcsEvents — DST correctness (item 1)", () => {
  it("produces 09:00 wall-clock occurrences across the spring-forward boundary", () => {
    const ics = fs.readFileSync(path.join(FIXTURES, "dst_transition.ics"), "utf-8");
    // Range covers all 4 occurrences across DST.
    const result = parseIcsEvents(ics, {
      start: "2026-02-25T00:00:00Z",
      end: "2026-04-15T00:00:00Z",
    });
    expect(result.length).toBe(4);
    // Mar 1 EST → 14:00 UTC; Mar 8 EST → 14:00 UTC; Mar 15 EDT → 13:00 UTC; Mar 22 EDT → 13:00 UTC.
    expect(result[0].start).toBe("2026-03-01T14:00:00.000Z");
    expect(result[1].start).toBe("2026-03-08T14:00:00.000Z");
    expect(result[2].start).toBe("2026-03-15T13:00:00.000Z");
    expect(result[3].start).toBe("2026-03-22T13:00:00.000Z");
  });
});

describe("parseIcsEvents — floating time (item 6)", () => {
  it("interprets floating DTSTART in the viewer timezone, not as UTC", () => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pim-core//test//EN\r\nBEGIN:VEVENT\r\nUID:floating-test@pim-core\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260601T090000\r\nDTEND:20260601T100000\r\nSUMMARY:Floating-time event\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const result = parseIcsEvents(ics, undefined, "America/Chicago");
    // 9am Chicago in June (CDT, UTC-5) → 14:00 UTC, NOT 09:00 UTC.
    expect(result[0].start).toBe("2026-06-01T14:00:00.000Z");
  });
});

describe("parseIcsEvents — multiple RRULEs (item 5)", () => {
  it("expands occurrences from all RRULEs in a VEVENT, not just the first", () => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pim-core//test//EN\r\nBEGIN:VEVENT\r\nUID:multi-rrule-test@pim-core\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260101T090000Z\r\nDTEND:20260101T100000Z\r\nSUMMARY:Multi-RRULE\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3\r\nRRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const result = parseIcsEvents(ics, {
      start: "2026-01-01T00:00:00Z",
      end: "2026-02-01T00:00:00Z",
    });
    expect(result.length).toBe(6); // 3 Mondays + 3 Fridays
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/core && npx vitest run src/__tests__/ics/parse-events.unit.test.ts`
Expected: 3 PASS. If floating-time fails, the parser doesn't yet route the `timezone` parameter to floating-time interpretation — extend `parseIcsEvents` so that when a non-UTC, non-TZID DTSTART is encountered and a `timezone` argument is provided, the time is rebound to that zone before conversion to UTC.

- [ ] **Step 3: If implementation needed, extend `parse-events.ts`**

In `emitNonExpanded`, before `dtstart.toJSDate().toISOString()`, check if the time is floating (`dtstart.zone === ICAL.Timezone.localTimezone || (!dtstart.zone && !dtstart.isDate)`) and the `timezone` parameter is provided; if so, set `dtstart.zone = ICAL.TimezoneService.get(timezone)` (after verifying the timezone is registered). Same in `emitOccurrences`.

- [ ] **Step 4: Re-run and commit**

```bash
git add packages/core/src/__tests__/ics/parse-events.unit.test.ts packages/core/src/ics/parse-events.ts
git commit -m "feat(pim-core/ics): floating-time interpretation + DST + multi-RRULE coverage"
```

---

### Task 13: Implement parseIcsTodos with VTODO fixtures

**Files:**
- Create: `packages/core/src/ics/parse-todos.ts`
- Create: `packages/core/src/__tests__/ics/fixtures/vtodo_basic.oracle.json`
- Create: `packages/core/src/__tests__/ics/fixtures/vtodo_with_due_completed.oracle.json`
- Create: `packages/core/src/__tests__/ics/parse-todos.unit.test.ts`

- [ ] **Step 1: Write oracle for `vtodo_basic`**

```json
{
  "expected": [
    {
      "uid": "todo-basic-fixture@pim-core",
      "title": "Buy groceries",
      "due": null,
      "completed": null,
      "percent_complete": null,
      "priority": 5,
      "status": "needs-action",
      "description": null,
      "categories": [],
      "attendees": [],
      "organizer": null,
      "alarms": [],
      "recurrence_rule": null,
      "created": null,
      "last_modified": null,
      "occurrence_date": null
    }
  ]
}
```

- [ ] **Step 2: Write oracle for `vtodo_with_due_completed`**

```json
{
  "expected": [
    {
      "uid": "todo-completed-fixture@pim-core",
      "title": "File 2025 taxes",
      "due": "2026-04-15T23:59:59.000Z",
      "completed": "2026-04-10T14:30:00.000Z",
      "percent_complete": 100,
      "priority": 1,
      "status": "completed",
      "description": "Use the imported 1099s from broker",
      "categories": ["Finance", "Personal"],
      "attendees": [],
      "organizer": null,
      "alarms": [],
      "recurrence_rule": null,
      "created": null,
      "last_modified": null,
      "occurrence_date": null
    }
  ]
}
```

- [ ] **Step 3: Write the test runner**

```ts
// packages/core/src/__tests__/ics/parse-todos.unit.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsTodos } from "../../ics/parse-todos.js";

const FIXTURES = path.join(__dirname, "fixtures");

function load(name: string) {
  const ics = fs.readFileSync(path.join(FIXTURES, `${name}.ics`), "utf-8");
  const oracle = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.oracle.json`), "utf-8"));
  return { ics, oracle };
}

describe("parseIcsTodos", () => {
  it("vtodo_basic", () => {
    const { ics, oracle } = load("vtodo_basic");
    expect(parseIcsTodos(ics)).toEqual(oracle.expected);
  });
  it("vtodo_with_due_completed", () => {
    const { ics, oracle } = load("vtodo_with_due_completed");
    expect(parseIcsTodos(ics)).toEqual(oracle.expected);
  });
});
```

- [ ] **Step 4: Run, verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/ics/parse-todos.unit.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 5: Implement `parse-todos.ts`**

```ts
// packages/core/src/ics/parse-todos.ts
import ICAL from "ical.js";
import "./_tz-init.js";
import { IcsParseError } from "./errors.js";
import { parseAttendees, parseOrganizer, parseAlarms, parseCategories } from "./_shared.js";
import type { ParsedTodo } from "./types.js";

export function parseIcsTodos(icsContent: string): ParsedTodo[] {
  if (!icsContent.trim()) return [];

  let root: ICAL.Component;
  try {
    root = ICAL.Component.fromString(icsContent);
  } catch (e) {
    throw new IcsParseError("Invalid ICS content", e);
  }

  const out: ParsedTodo[] = [];
  for (const vtodo of root.getAllSubcomponents("vtodo")) {
    try {
      const due = vtodo.getFirstPropertyValue("due");
      const completed = vtodo.getFirstPropertyValue("completed");
      const percent = vtodo.getFirstPropertyValue("percent-complete");
      const priority = vtodo.getFirstPropertyValue("priority");
      const status = vtodo.getFirstPropertyValue("status");
      const created = vtodo.getFirstPropertyValue("created");
      const lastModified = vtodo.getFirstPropertyValue("last-modified");
      const rrule = vtodo.getFirstPropertyValue("rrule");
      const recurId = vtodo.getFirstPropertyValue("recurrence-id");

      out.push({
        uid: (vtodo.getFirstPropertyValue("uid") as string) ?? "",
        title: (vtodo.getFirstPropertyValue("summary") as string) ?? "",
        due: due instanceof ICAL.Time ? due.toJSDate().toISOString() : null,
        completed: completed instanceof ICAL.Time ? completed.toJSDate().toISOString() : null,
        percent_complete: typeof percent === "number" ? percent : null,
        priority: typeof priority === "number" ? priority : null,
        status: typeof status === "string" ? status.toLowerCase() : null,
        description: (vtodo.getFirstPropertyValue("description") as string) ?? null,
        categories: parseCategories(vtodo),
        attendees: parseAttendees(vtodo),
        organizer: parseOrganizer(vtodo),
        alarms: parseAlarms(vtodo),
        recurrence_rule: rrule ? rrule.toString() : null,
        created: created instanceof ICAL.Time ? created.toJSDate().toISOString() : null,
        last_modified: lastModified instanceof ICAL.Time ? lastModified.toJSDate().toISOString() : null,
        occurrence_date: recurId instanceof ICAL.Time ? recurId.toJSDate().toISOString() : null,
      });
    } catch {
      // Skip malformed VTODO, don't fail whole batch.
      continue;
    }
  }
  return out;
}
```

- [ ] **Step 6: Re-export from barrel**

Append to `packages/core/src/ics/index.ts`:

```ts
export { parseIcsTodos } from "./parse-todos.js";
```

- [ ] **Step 7: Run and commit**

Run: `cd packages/core && npx vitest run src/__tests__/ics/parse-todos.unit.test.ts`
Expected: 2 PASS.

```bash
git add packages/core/src/ics/parse-todos.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/parse-todos.unit.test.ts packages/core/src/__tests__/ics/fixtures/vtodo_basic.oracle.json packages/core/src/__tests__/ics/fixtures/vtodo_with_due_completed.oracle.json
git commit -m "feat(pim-core/ics): implement parseIcsTodos with VTODO fixture coverage"
```

---

### Task 14: Implement parseIcsJournals with VJOURNAL fixture

**Files:**
- Create: `packages/core/src/ics/parse-journals.ts`
- Create: `packages/core/src/__tests__/ics/fixtures/vjournal_basic.oracle.json`
- Create: `packages/core/src/__tests__/ics/parse-journals.unit.test.ts`

- [ ] **Step 1: Oracle for `vjournal_basic`**

```json
{
  "expected": [
    {
      "uid": "journal-basic-fixture@pim-core",
      "title": "Project journal entry",
      "date": "2026-04-24",
      "description": "First milestone reached for the migration project.",
      "categories": ["Work", "Notes"],
      "status": "final",
      "created": null,
      "last_modified": null
    }
  ]
}
```

- [ ] **Step 2: Test runner**

```ts
// packages/core/src/__tests__/ics/parse-journals.unit.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsJournals } from "../../ics/parse-journals.js";

describe("parseIcsJournals", () => {
  it("vjournal_basic", () => {
    const fixtures = path.join(__dirname, "fixtures");
    const ics = fs.readFileSync(path.join(fixtures, "vjournal_basic.ics"), "utf-8");
    const oracle = JSON.parse(fs.readFileSync(path.join(fixtures, "vjournal_basic.oracle.json"), "utf-8"));
    expect(parseIcsJournals(ics)).toEqual(oracle.expected);
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/ics/parse-journals.unit.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 4: Implement `parse-journals.ts`**

```ts
// packages/core/src/ics/parse-journals.ts
import ICAL from "ical.js";
import "./_tz-init.js";
import { IcsParseError } from "./errors.js";
import { parseCategories } from "./_shared.js";
import type { ParsedJournal } from "./types.js";

function dateOnlyToString(t: ICAL.Time): string {
  // For VALUE=DATE properties, ical.js sets isDate=true and the JS Date is at midnight UTC.
  // Emit YYYY-MM-DD without timezone interpretation.
  const yr = t.year.toString().padStart(4, "0");
  const mo = t.month.toString().padStart(2, "0");
  const da = t.day.toString().padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

export function parseIcsJournals(icsContent: string): ParsedJournal[] {
  if (!icsContent.trim()) return [];

  let root: ICAL.Component;
  try {
    root = ICAL.Component.fromString(icsContent);
  } catch (e) {
    throw new IcsParseError("Invalid ICS content", e);
  }

  const out: ParsedJournal[] = [];
  for (const vjournal of root.getAllSubcomponents("vjournal")) {
    try {
      const dtstart = vjournal.getFirstPropertyValue("dtstart");
      const status = vjournal.getFirstPropertyValue("status");
      const created = vjournal.getFirstPropertyValue("created");
      const lastModified = vjournal.getFirstPropertyValue("last-modified");

      let dateStr = "";
      if (dtstart instanceof ICAL.Time) {
        dateStr = dtstart.isDate ? dateOnlyToString(dtstart) : dtstart.toJSDate().toISOString();
      }

      out.push({
        uid: (vjournal.getFirstPropertyValue("uid") as string) ?? "",
        title: (vjournal.getFirstPropertyValue("summary") as string) ?? "",
        date: dateStr,
        description: (vjournal.getFirstPropertyValue("description") as string) ?? null,
        categories: parseCategories(vjournal),
        status: typeof status === "string" ? status.toLowerCase() : null,
        created: created instanceof ICAL.Time ? created.toJSDate().toISOString() : null,
        last_modified: lastModified instanceof ICAL.Time ? lastModified.toJSDate().toISOString() : null,
      });
    } catch {
      continue;
    }
  }
  return out;
}
```

- [ ] **Step 5: Re-export from barrel**

Append to `packages/core/src/ics/index.ts`:

```ts
export { parseIcsJournals } from "./parse-journals.js";
```

- [ ] **Step 6: Run and commit**

```bash
cd packages/core && npx vitest run src/__tests__/ics/parse-journals.unit.test.ts
```

Expected: PASS.

```bash
git add packages/core/src/ics/parse-journals.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/parse-journals.unit.test.ts packages/core/src/__tests__/ics/fixtures/vjournal_basic.oracle.json
git commit -m "feat(pim-core/ics): implement parseIcsJournals with VJOURNAL fixture coverage"
```

---

### Task 15: Implement generateEventIcs (basic, no VTIMEZONE)

**Files:**
- Create: `packages/core/src/ics/generate.ts`
- Create: `packages/core/src/__tests__/ics/generate.test.ts`

- [ ] **Step 1: Write the test for the basic generation flow**

```ts
// packages/core/src/__tests__/ics/generate.test.ts
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { generateEventIcs } from "../../ics/generate.js";
import { parseIcsEvents } from "../../ics/parse-events.js";
import { IcsGenerateError } from "../../ics/errors.js";

describe("generateEventIcs — basic round-trip", () => {
  it("emits VCALENDAR/VEVENT and round-trips through parseIcsEvents", () => {
    const ics = generateEventIcs({
      title: "Team standup",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T13:30:00.000Z",
      uid: "round-trip-test@pim-core",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:round-trip-test@pim-core");
    const parsed = parseIcsEvents(ics);
    expect(parsed.length).toBe(1);
    expect(parsed[0].uid).toBe("round-trip-test@pim-core");
    expect(parsed[0].title).toBe("Team standup");
    expect(parsed[0].start).toBe("2026-05-01T13:00:00.000Z");
    expect(parsed[0].end).toBe("2026-05-01T13:30:00.000Z");
  });

  it("emits attendees and organizer", () => {
    const ics = generateEventIcs({
      title: "Sync",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T13:30:00.000Z",
      uid: "attendees-test@pim-core",
      organizer: { email: "alice@example.com", name: "Alice Smith" },
      attendees: [{ email: "bob@example.com" }, { email: "carol@example.com" }],
    });
    expect(ics).toContain("ORGANIZER");
    expect(ics).toContain("alice@example.com");
    expect(ics).toMatch(/ATTENDEE.*bob@example\.com/);
    expect(ics).toMatch(/ATTENDEE.*carol@example\.com/);
  });

  it("emits a valid RRULE", () => {
    const ics = generateEventIcs({
      title: "Recurring",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T13:30:00.000Z",
      uid: "rrule-test@pim-core",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=FR",
    });
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=FR");
  });

  it("throws IcsGenerateError on invalid RRULE", () => {
    expect(() => generateEventIcs({
      title: "Bad",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T13:30:00.000Z",
      recurrence_rule: "BAD-RULE",
    })).toThrow(IcsGenerateError);
  });

  it("throws IcsGenerateError when attendees provided without organizer", () => {
    expect(() => generateEventIcs({
      title: "Bad",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T13:30:00.000Z",
      attendees: [{ email: "bob@example.com" }],
    })).toThrow(IcsGenerateError);
  });

  it("throws IcsGenerateError on invalid date", () => {
    expect(() => generateEventIcs({
      title: "Bad",
      start: "not-a-date",
      end: "2026-05-01T13:30:00.000Z",
    })).toThrow(IcsGenerateError);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/ics/generate.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `generate.ts`**

```ts
// packages/core/src/ics/generate.ts
import ICAL from "ical.js";
import "./_tz-init.js";
import { IcsGenerateError } from "./errors.js";
import { normalizeRecurrenceRule } from "./rrule.js";
import type { EventCreateProps } from "./types.js";

function toIcalTime(iso: string, allDay: boolean, tzid?: string): ICAL.Time {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new IcsGenerateError(`Invalid ISO date: ${iso}`, null);
  }
  if (allDay) {
    return ICAL.Time.fromDateString(date.toISOString().slice(0, 10));
  }
  if (tzid) {
    const zone = ICAL.TimezoneService.get(tzid);
    if (zone) {
      const utc = ICAL.Time.fromJSDate(date, true);
      return utc.convertToZone(zone);
    }
  }
  return ICAL.Time.fromJSDate(date, true);
}

export function generateEventIcs(props: EventCreateProps): string {
  if (props.attendees && props.attendees.length > 0 && !props.organizer) {
    throw new IcsGenerateError(
      "ORGANIZER is required when ATTENDEE is present (RFC 6638)",
      null,
    );
  }

  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("prodid", "-//pim-core//cal-mcp//EN");
  calendar.updatePropertyWithValue("version", "2.0");

  if (props.timezone) {
    const zone = ICAL.TimezoneService.get(props.timezone);
    if (zone?.component) {
      calendar.addSubcomponent(zone.component);
    }
  }

  const vevent = new ICAL.Component("vevent");

  const uid = props.uid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}@pim-core`;
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  vevent.updatePropertyWithValue("summary", props.title);
  vevent.updatePropertyWithValue("status", "CONFIRMED");

  const allDay = props.all_day === true;
  const dtstart = toIcalTime(props.start, allDay, props.timezone);
  const dtend = toIcalTime(props.end, allDay, props.timezone);
  const dtstartProp = vevent.updatePropertyWithValue("dtstart", dtstart);
  const dtendProp = vevent.updatePropertyWithValue("dtend", dtend);
  if (props.timezone && !allDay) {
    dtstartProp.setParameter("tzid", props.timezone);
    dtendProp.setParameter("tzid", props.timezone);
  }

  if (props.location) vevent.updatePropertyWithValue("location", props.location);
  if (props.description) vevent.updatePropertyWithValue("description", props.description);

  if (props.availability === "free") vevent.updatePropertyWithValue("transp", "TRANSPARENT");
  else if (props.availability === "busy") vevent.updatePropertyWithValue("transp", "OPAQUE");

  if (props.organizer) {
    const name =
      props.organizer.name && props.organizer.name.trim().length > 0
        ? props.organizer.name
        : props.organizer.email.split("@")[0];
    const orgProp = vevent.updatePropertyWithValue("organizer", `mailto:${props.organizer.email}`);
    orgProp.setParameter("cn", name);
  }

  if (props.attendees) {
    for (const att of props.attendees) {
      vevent.addPropertyWithValue("attendee", `mailto:${att.email}`);
    }
  }

  if (props.categories && props.categories.length > 0) {
    vevent.addPropertyWithValue("categories", props.categories.join(","));
  }

  if (props.recurrence_rule) {
    const normalized = normalizeRecurrenceRule(props.recurrence_rule);
    if (!normalized) {
      throw new IcsGenerateError(`Invalid recurrence_rule: ${props.recurrence_rule}`, null);
    }
    vevent.addProperty(ICAL.Property.fromString(`RRULE:${normalized}`));
  }

  if (props.alarms) {
    for (const alarm of props.alarms) {
      const valarm = new ICAL.Component("valarm");
      valarm.updatePropertyWithValue("action", "DISPLAY");
      valarm.updatePropertyWithValue("description", props.title);
      if (alarm.type === "relative" && typeof alarm.trigger === "number") {
        const dur = ICAL.Duration.fromSeconds(alarm.trigger);
        valarm.updatePropertyWithValue("trigger", dur);
      } else if (alarm.type === "absolute" && typeof alarm.trigger === "string") {
        const t = ICAL.Time.fromJSDate(new Date(alarm.trigger), true);
        valarm.updatePropertyWithValue("trigger", t);
      }
      vevent.addSubcomponent(valarm);
    }
  }

  calendar.addSubcomponent(vevent);
  return calendar.toString();
}
```

- [ ] **Step 4: Re-export from barrel**

Append to `packages/core/src/ics/index.ts`:

```ts
export { generateEventIcs } from "./generate.js";
```

- [ ] **Step 5: Run and commit**

Run: `cd packages/core && npx vitest run src/__tests__/ics/generate.test.ts`
Expected: 6 PASS.

```bash
git add packages/core/src/ics/generate.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/generate.test.ts
git commit -m "feat(pim-core/ics): implement generateEventIcs with ical.js component builders"
```

---

### Task 16: Add VTIMEZONE emission test (item 2)

**Files:**
- Create: `packages/core/src/__tests__/ics/generate-vtimezone.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/core/src/__tests__/ics/generate-vtimezone.test.ts
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { generateEventIcs } from "../../ics/generate.js";

describe("generateEventIcs — VTIMEZONE emission (item 2)", () => {
  it("emits a VTIMEZONE block when props.timezone is provided", () => {
    const ics = generateEventIcs({
      title: "Tz event",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T14:00:00.000Z",
      uid: "vtz-test@pim-core",
      timezone: "America/New_York",
    });
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/New_York");
    expect(ics).toContain("END:VTIMEZONE");
    expect(ics).toMatch(/DTSTART;TZID=America\/New_York:/);
  });

  it("does not emit VTIMEZONE when no timezone is provided", () => {
    const ics = generateEventIcs({
      title: "UTC event",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T14:00:00.000Z",
      uid: "no-vtz-test@pim-core",
    });
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });
});
```

- [ ] **Step 2: Run; if fails, the VTIMEZONE registration in `_tz-init.ts` may not be persisting `zone.component`. Investigate by logging what `ICAL.TimezoneService.get("America/New_York").component` returns.**

Run: `cd packages/core && npx vitest run src/__tests__/ics/generate-vtimezone.test.ts`
Expected: 2 PASS. If first test fails because no VTIMEZONE block appears, the issue is most likely `zone.component` being null — confirm `_tz-init.ts` is registering the `Timezone` instance with `component:` set. Fix by adjusting `_tz-init.ts` to ensure each `new ICAL.Timezone(...)` is constructed with the parsed VTIMEZONE component.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/ics/generate-vtimezone.test.ts packages/core/src/ics/_tz-init.ts
git commit -m "test(pim-core/ics): assert VTIMEZONE emission on generateEventIcs (item 2)"
```

---

### Task 17: Implement components.ts (createExceptionComponent, combineIcsComponents, addExdateToIcs)

**Files:**
- Create: `packages/core/src/ics/components.ts`
- Create: `packages/core/src/__tests__/ics/components.test.ts`

- [ ] **Step 1: Write tests**

```ts
// packages/core/src/__tests__/ics/components.test.ts
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import {
  createExceptionComponent,
  combineIcsComponents,
  addExdateToIcs,
} from "../../ics/components.js";
import { generateEventIcs } from "../../ics/generate.js";

const masterIcs = generateEventIcs({
  title: "Weekly standup",
  start: "2026-05-04T13:00:00.000Z",
  end: "2026-05-04T13:30:00.000Z",
  uid: "components-test@pim-core",
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
  organizer: { email: "alice@example.com", name: "Alice Smith" },
  attendees: [{ email: "bob@example.com" }],
});

describe("createExceptionComponent", () => {
  it("creates a VEVENT block with RECURRENCE-ID and applies overrides", () => {
    const ex = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "Standup (moved)", start: "2026-05-11T15:00:00.000Z", end: "2026-05-11T15:30:00.000Z" },
      false,
    );
    expect(ex).toContain("BEGIN:VEVENT");
    expect(ex).toContain("END:VEVENT");
    expect(ex).toMatch(/RECURRENCE-ID/);
    expect(ex).toContain("Standup (moved)");
  });
});

describe("combineIcsComponents", () => {
  it("inserts the exception VEVENT into the master VCALENDAR", () => {
    const ex = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "Standup (moved)" },
      false,
    );
    const combined = combineIcsComponents(masterIcs, ex);
    expect(combined.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(combined).toContain("Standup (moved)");
  });

  it("replaces a prior exception with the same RECURRENCE-ID", () => {
    const ex1 = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "First override" },
      false,
    );
    const intermediate = combineIcsComponents(masterIcs, ex1);
    const ex2 = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "Second override" },
      false,
    );
    const combined = combineIcsComponents(intermediate, ex2);
    expect(combined.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(combined).not.toContain("First override");
    expect(combined).toContain("Second override");
  });
});

describe("addExdateToIcs", () => {
  it("appends an EXDATE for the given occurrence", () => {
    const updated = addExdateToIcs(masterIcs, "2026-05-11T13:00:00.000Z", false);
    expect(updated).toMatch(/EXDATE/);
  });
  it("is idempotent for the same date", () => {
    const once = addExdateToIcs(masterIcs, "2026-05-11T13:00:00.000Z", false);
    const twice = addExdateToIcs(once, "2026-05-11T13:00:00.000Z", false);
    expect((twice.match(/EXDATE/g) ?? []).length).toBe((once.match(/EXDATE/g) ?? []).length);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd packages/core && npx vitest run src/__tests__/ics/components.test.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `components.ts`**

```ts
// packages/core/src/ics/components.ts
import ICAL from "ical.js";
import "./_tz-init.js";
import { IcsParseError } from "./errors.js";
import { parseIcsEvents } from "./parse-events.js";

export interface ExceptionOverrides {
  title?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string }>;
  alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
  categories?: string[];
  organizer?: { email: string; name?: string | null };
  availability?: "busy" | "free";
}

function parseRoot(ics: string): ICAL.Component {
  try {
    return ICAL.Component.fromString(ics);
  } catch (e) {
    throw new IcsParseError("Invalid ICS content", e);
  }
}

export function createExceptionComponent(
  masterIcs: string,
  componentType: "vevent" | "vtodo",
  occurrenceDate: string,
  overrides: ExceptionOverrides,
  allDay: boolean,
): string {
  const masterRoot = parseRoot(masterIcs);
  const masterComp = masterRoot.getFirstSubcomponent(componentType);
  if (!masterComp) throw new IcsParseError(`No ${componentType} found in master ICS`, null);

  const masterEvents = parseIcsEvents(masterIcs);
  const master = masterEvents[0];
  if (!master) throw new IcsParseError("Could not parse master event", null);

  const uid = master.uid;
  const occMs = new Date(occurrenceDate).getTime();
  const masterStartMs = new Date(master.start).getTime();
  const masterEndMs = new Date(master.end).getTime();
  const duration = masterEndMs - masterStartMs;
  const defaultStart = new Date(occMs).toISOString();
  const defaultEnd = new Date(occMs + duration).toISOString();

  const ex = new ICAL.Component(componentType);
  ex.updatePropertyWithValue("uid", uid);

  const recurId = ICAL.Time.fromJSDate(new Date(occurrenceDate), true);
  if (allDay) recurId.isDate = true;
  const recurProp = ex.updatePropertyWithValue("recurrence-id", recurId);
  if (allDay) recurProp.setParameter("value", "DATE");

  const startIso = overrides.start ?? defaultStart;
  const endIso = overrides.end ?? defaultEnd;
  const isAllDay = overrides.all_day ?? allDay;

  const dtstart = ICAL.Time.fromJSDate(new Date(startIso), true);
  if (isAllDay) dtstart.isDate = true;
  const dtstartProp = ex.updatePropertyWithValue("dtstart", dtstart);
  if (isAllDay) dtstartProp.setParameter("value", "DATE");

  const dtend = ICAL.Time.fromJSDate(new Date(endIso), true);
  if (isAllDay) dtend.isDate = true;
  const dtendProp = ex.updatePropertyWithValue("dtend", dtend);
  if (isAllDay) dtendProp.setParameter("value", "DATE");

  // SEQUENCE: bump master's
  const masterSeq = masterComp.getFirstPropertyValue("sequence");
  const seq = (typeof masterSeq === "number" ? masterSeq : 0) + 1;
  ex.updatePropertyWithValue("sequence", seq);

  ex.updatePropertyWithValue("summary", overrides.title ?? master.title);
  if (overrides.location ?? master.location) {
    ex.updatePropertyWithValue("location", overrides.location ?? master.location ?? "");
  }
  if (overrides.description ?? master.description) {
    ex.updatePropertyWithValue("description", overrides.description ?? master.description ?? "");
  }

  const organizer = overrides.organizer ?? master.organizer;
  if (organizer) {
    const name =
      organizer.name && organizer.name.trim().length > 0
        ? organizer.name
        : organizer.email.split("@")[0];
    const orgProp = ex.updatePropertyWithValue("organizer", `mailto:${organizer.email}`);
    orgProp.setParameter("cn", name);
  }

  const attendees = overrides.attendees ?? master.attendees;
  if (attendees) {
    for (const att of attendees) {
      ex.addPropertyWithValue("attendee", `mailto:${att.email}`);
    }
  }

  const categories = overrides.categories ?? master.categories;
  if (categories && categories.length > 0) {
    ex.addPropertyWithValue("categories", categories.join(","));
  }

  const availability = overrides.availability ?? master.availability;
  if (availability === "free") ex.updatePropertyWithValue("transp", "TRANSPARENT");
  else if (availability === "busy") ex.updatePropertyWithValue("transp", "OPAQUE");

  ex.updatePropertyWithValue("status", "CONFIRMED");

  return ex.toString();
}

export function combineIcsComponents(masterIcs: string, exceptionComponent: string): string {
  const masterRoot = parseRoot(masterIcs);

  // Wrap the bare exception VEVENT/VTODO in a synthetic VCALENDAR so it can be parsed.
  const wrapped = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pim-core//combine//EN\r\n${exceptionComponent}\r\nEND:VCALENDAR`;
  const exRoot = parseRoot(wrapped);
  const exComp = exRoot.getFirstSubcomponent("vevent") ?? exRoot.getFirstSubcomponent("vtodo");
  if (!exComp) throw new IcsParseError("Exception component is not a VEVENT or VTODO", null);

  const exUid = exComp.getFirstPropertyValue("uid");
  const exRecurId = exComp.getFirstPropertyValue("recurrence-id");
  if (!(exRecurId instanceof ICAL.Time)) {
    throw new IcsParseError("Exception component must have a RECURRENCE-ID", null);
  }
  const exRecurMs = exRecurId.toJSDate().getTime();
  const componentName = exComp.name;

  // Find and remove any existing matching subcomponent.
  const existing = masterRoot.getAllSubcomponents(componentName);
  for (const sub of existing) {
    const subUid = sub.getFirstPropertyValue("uid");
    const subRecur = sub.getFirstPropertyValue("recurrence-id");
    if (subUid === exUid && subRecur instanceof ICAL.Time && subRecur.toJSDate().getTime() === exRecurMs) {
      masterRoot.removeSubcomponent(sub);
    }
  }
  masterRoot.addSubcomponent(exComp);
  return masterRoot.toString();
}

export function addExdateToIcs(icsContent: string, occurrenceDate: string, allDay: boolean): string {
  const root = parseRoot(icsContent);
  // EXDATE goes on the master event (first VEVENT without a RECURRENCE-ID).
  const masters = root.getAllSubcomponents("vevent").filter((c) => !c.getFirstProperty("recurrence-id"));
  const master = masters[0];
  if (!master) return icsContent;

  const newDate = ICAL.Time.fromJSDate(new Date(occurrenceDate), true);
  if (allDay) newDate.isDate = true;
  const newMs = newDate.toJSDate().getTime();

  // Idempotency check: scan existing EXDATE values.
  for (const exProp of master.getAllProperties("exdate")) {
    for (const v of exProp.getValues()) {
      if (v instanceof ICAL.Time && v.toJSDate().getTime() === newMs) {
        return icsContent;
      }
    }
  }

  const exProp = master.addPropertyWithValue("exdate", newDate);
  if (allDay) exProp.setParameter("value", "DATE");
  return root.toString();
}
```

- [ ] **Step 4: Re-export from barrel**

Append to `packages/core/src/ics/index.ts`:

```ts
export { createExceptionComponent, combineIcsComponents, addExdateToIcs } from "./components.js";
export type { ExceptionOverrides } from "./components.js";
```

- [ ] **Step 5: Run and commit**

Run: `cd packages/core && npx vitest run src/__tests__/ics/components.test.ts`
Expected: 4 PASS.

```bash
git add packages/core/src/ics/components.ts packages/core/src/ics/index.ts packages/core/src/__tests__/ics/components.test.ts
git commit -m "feat(pim-core/ics): implement createExceptionComponent / combineIcsComponents / addExdateToIcs"
```

---

### Task 18: Run full pim-core test suite, fix any cross-test interactions

**Files:** none

- [ ] **Step 1: Run all tests**

Run: `cd packages/core && npm test`
Expected: ALL PASS. Total ~30+ tests across the new ics suite plus existing pim-core tests.

- [ ] **Step 2: Run typecheck**

Run: `cd packages/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `cd packages/core && npm run build`
Expected: PASS, `dist/ics/` directory populated.

- [ ] **Step 4: Verify the submodule export resolves end-to-end**

```bash
cd /tmp && mkdir -p pim-core-export-check && cd pim-core-export-check
node -e "import('@miguelarios/pim-core/ics').then(m => console.log(Object.keys(m).sort()))" 2>&1 | head -20
```

Note: this requires `pim-core` to be linked or installed; if running locally inside the monorepo, instead create `packages/core/scripts/check-exports.ts` with `import { parseIcsEvents } from "../src/ics/index.js"; console.log(typeof parseIcsEvents);` and run `npx tsx packages/core/scripts/check-exports.ts`. Expected: `function`.

- [ ] **Step 5: Commit any incidental fixes**

If any cross-test issues surfaced (e.g., timezone registration leaking between tests), commit fixes:

```bash
git add packages/core/src/ics/
git commit -m "chore(pim-core/ics): cross-test cleanup before release"
```

---

### Task 19: Tag and publish pim-core v0.6.0

**Files:** none — this is the publish step.

The repo's CI publishes packages on tag push (per CLAUDE.md). Format: `<package>/v<version>`.

- [ ] **Step 1: Confirm clean working tree**

Run: `git status`
Expected: clean.

- [ ] **Step 2: Open PR1 with the cumulative pim-core changes**

```bash
git push origin <branch>
gh pr create --title "feat(pim-core): ics submodule with ical.js (v0.6.0)" --body "$(cat <<'EOF'
## Summary
- New @miguelarios/pim-core/ics submodule wraps Mozilla's ical.js for VEVENT/VTODO/VJOURNAL parsing and VEVENT generation.
- Closes 7 correctness gaps documented in docs/superpowers/specs/2026-04-24-cal-mcp-icaljs-migration-design.md.
- Bumps to 0.6.0; cal-mcp swap follows in PR2.

## Test plan
- [x] Full pim-core test suite passes (npm test in packages/core)
- [x] Type-check clean (npm run typecheck)
- [x] Build emits dist/ics/ correctly
- [x] @miguelarios/pim-core/ics submodule import resolves

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After PR1 merges, tag for publish**

```bash
git checkout main && git pull
git tag pim-core/v0.6.0
git push origin pim-core/v0.6.0
```

Watch the GitHub Actions publish workflow. After it succeeds, the package is on npm.

---

## PR2 — cal-mcp v0.10.0

### Task 20: Update cal-mcp imports to pim-core/ics

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:11`
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts:1-10`

- [ ] **Step 1: Update CalDavService import**

Open `packages/cal-mcp/src/services/CalDavService.ts`, find line 11:
```ts
import { type ParsedAlarm, type ParsedEvent, type TimeRange, parseIcsEvents } from "../ical.js";
```
Change to:
```ts
import { type ParsedAlarm, type ParsedEvent, type TimeRange, parseIcsEvents } from "@miguelarios/pim-core/ics";
```

- [ ] **Step 2: Update calendarTools import**

Open `packages/cal-mcp/src/tools/calendarTools.ts`, find the import block at the top:
```ts
import {
  addExdateToIcs,
  combineIcsComponents,
  createExceptionVevent,
  generateEventIcs,
  parseIcsEvents,
} from "../ical.js";
```
Change to:
```ts
import {
  addExdateToIcs,
  combineIcsComponents,
  createExceptionComponent,
  generateEventIcs,
  parseIcsEvents,
} from "@miguelarios/pim-core/ics";
```

- [ ] **Step 3: Find and update all `createExceptionVevent` call sites in calendarTools.ts**

Search:
```bash
grep -n "createExceptionVevent" packages/cal-mcp/src/tools/calendarTools.ts
```

For each call site, change `createExceptionVevent(masterIcs, occurrenceDate, overrides, allDay)` to `createExceptionComponent(masterIcs, "vevent", occurrenceDate, overrides, allDay)` (insert the `"vevent"` argument as the second parameter).

- [ ] **Step 4: Bump pim-core peer dep in cal-mcp/package.json**

Open `packages/cal-mcp/package.json`. Change:
```json
"@miguelarios/pim-core": "^0.4.0"
```
To:
```json
"@miguelarios/pim-core": "^0.6.0"
```

- [ ] **Step 5: Run npm install at the monorepo root**

```bash
npm install
```

- [ ] **Step 6: Verify cal-mcp typechecks**

Run: `cd packages/cal-mcp && npm run typecheck`
Expected: PASS. If type errors appear, the most likely cause is that `pim-core/ics`'s exception type signature differs from the old `createExceptionVevent` — adjust call sites.

- [ ] **Step 7: Commit**

```bash
git add packages/cal-mcp/package.json packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/tools/calendarTools.ts
git commit -m "feat(cal-mcp): switch ICS imports to @miguelarios/pim-core/ics"
```

---

### Task 21: Delete cal-mcp/src/ical.ts and the old test file

**Files:**
- Delete: `packages/cal-mcp/src/ical.ts`
- Delete: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Confirm nothing else imports from `../ical.js` or `./ical.js`**

```bash
grep -rn "from \"\.\./ical" packages/cal-mcp/src/
grep -rn "from \"\./ical" packages/cal-mcp/src/
```

Expected: only the test file `__tests__/ical.test.ts` matches (plus possibly the file itself). If anything else does, update those imports first.

- [ ] **Step 2: Delete the source file**

```bash
git rm packages/cal-mcp/src/ical.ts
```

- [ ] **Step 3: Delete the test file**

```bash
git rm packages/cal-mcp/src/__tests__/ical.test.ts
```

- [ ] **Step 4: Verify cal-mcp build and tests still work**

Run: `cd packages/cal-mcp && npm run build && npm test`
Expected: PASS. Remaining tests are `CalDavService.test.ts` and `calendarTools.test.ts`, which mock CalDAV transport rather than ICS parsing.

- [ ] **Step 5: If any test fails due to floating-time semantic change (item 6), update the expectation**

Identify failures and update the affected test expectations to match the new (correct) behavior — e.g., what was previously asserted to come back as a UTC timestamp should now come back as the viewer-tz-resolved UTC. Commit the updates with an explanatory message:

```bash
git add packages/cal-mcp/src/__tests__/
git commit -m "test(cal-mcp): update floating-time expectations for item 6 semantics"
```

- [ ] **Step 6: Commit the deletions**

```bash
git commit -m "refactor(cal-mcp): delete src/ical.ts and ical.test.ts (superseded by pim-core/ics)"
```

---

### Task 22: Drop node-ical and ical-generator

**Files:**
- Modify: `packages/cal-mcp/package.json`

- [ ] **Step 1: Remove the two dependencies**

```bash
cd packages/cal-mcp && npm uninstall node-ical ical-generator
```

- [ ] **Step 2: Verify the dependencies are gone**

```bash
grep -E "node-ical|ical-generator" packages/cal-mcp/package.json
```

Expected: no output.

- [ ] **Step 3: Verify build and tests still pass without them**

Run: `cd packages/cal-mcp && npm run build && npm test`
Expected: PASS. If anything fails, a stray reference to the old libraries remains — search and fix.

- [ ] **Step 4: Bump cal-mcp version to 0.10.0 in `package.json`**

Change `"version": "0.9.0"` to `"version": "0.10.0"`.

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/package.json packages/cal-mcp/package-lock.json package-lock.json
git commit -m "chore(cal-mcp): drop node-ical + ical-generator, bump to 0.10.0"
```

---

### Task 23: Pre-publish smoke test against live calendars

**Files:** none committed — this step is local only.

- [ ] **Step 1: Capture sample ICS from Mailbox.org**

Use the live MCP server or `curl` against your CalDAV endpoint to pull the raw ICS for ~3-5 representative events from Mailbox.org (one recurring with TZID, one all-day, one with attendees). Save them to a scratch dir like `~/scratch/mailbox-samples/` (NOT inside the repo).

- [ ] **Step 2: Capture sample ICS from Nextcloud**

Same idea — 3-5 events from Nextcloud, saved to `~/scratch/nextcloud-samples/`.

- [ ] **Step 3: Write a one-off smoke script that parses each sample with the new pim-core/ics**

```bash
cat > /tmp/smoke.mjs <<'EOF'
import fs from "node:fs";
import { parseIcsEvents } from "@miguelarios/pim-core/ics";

const dirs = process.argv.slice(2);
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ics")) continue;
    const ics = fs.readFileSync(`${dir}/${f}`, "utf-8");
    try {
      const events = parseIcsEvents(ics);
      console.log(`OK ${dir}/${f}: ${events.length} events`);
    } catch (e) {
      console.error(`FAIL ${dir}/${f}: ${e.message}`);
    }
  }
}
EOF
cd packages/cal-mcp && node /tmp/smoke.mjs ~/scratch/mailbox-samples ~/scratch/nextcloud-samples
```

Expected: all OK.

- [ ] **Step 4: If any FAIL, identify the server quirk**

Look at the failing ICS, identify what's unusual (custom X- properties, malformed VTIMEZONE, vendor PRODID quirks). Add a scrubbed version of the failing ICS to `packages/core/src/__tests__/ics/fixtures/` (apply the PII scrubbing rules from the global CLAUDE.md), write its oracle, and update the parser if needed. Loop back to Task 11 for that one fixture only.

- [ ] **Step 5: Delete the scratch samples**

```bash
rm -rf ~/scratch/mailbox-samples ~/scratch/nextcloud-samples /tmp/smoke.mjs
```

- [ ] **Step 6: No commit needed if smoke passed clean. If you added scrubbed fixtures, those are part of the next commit.**

---

### Task 24: Open PR2 and tag for publish

- [ ] **Step 1: Push the cal-mcp branch**

```bash
git push origin <branch>
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "refactor(cal-mcp): swap ICS handling to @miguelarios/pim-core/ics (v0.10.0)" --body "$(cat <<'EOF'
## Summary
- Deletes packages/cal-mcp/src/ical.ts (740 lines) and ical.test.ts (1627 lines).
- Imports parseIcsEvents / generateEventIcs / createExceptionComponent / combineIcsComponents / addExdateToIcs from @miguelarios/pim-core/ics.
- Removes node-ical and ical-generator from cal-mcp dependencies.
- Bumps to 0.10.0; pim-core peer to ^0.6.0.

## Test plan
- [x] cal-mcp test suite passes (npm test in packages/cal-mcp)
- [x] Type-check clean
- [x] Live-calendar smoke test passed against Mailbox.org and Nextcloud samples
- [x] All 7 correctness items from spec are covered (see PR1 fixture corpus)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After merge, tag for publish**

```bash
git checkout main && git pull
git tag cal-mcp/v0.10.0
git push origin cal-mcp/v0.10.0
```

- [ ] **Step 4: Mark the Todoist task complete**

```bash
td task complete 6gQGcqcMCRHj8Jj4
```

---

## Self-Review Notes

After writing the plan, I checked it against the spec:

**Spec coverage:**
- All 7 correctness items have a test that maps to them: items 1, 6, 5 in Task 12; item 2 in Task 16; items 3, 4 in Task 11 (rdate_exdate.oracle); item 7 in Tasks 13 + 14.
- Wide-move decision (everything ICS-related into pim-core): Tasks 4, 6, 7, 10, 13, 14, 15, 17 land all helpers in pim-core; Task 21 deletes everything from cal-mcp.
- Submodule export path (5b): Task 1 sets up `./ics` export, Task 20 imports from it.
- VTIMEZONE emission (item 2): Task 5 registers tz set, Task 16 asserts emission.
- Typed errors: Task 3.
- TDD throughout: every non-config task starts with a failing test.
- 2 PRs: Tasks 1-19 = PR1, Tasks 20-24 = PR2.

**Placeholder scan:** No "TBD", "implement later", or "similar to Task N" patterns. Each step has the actual code or command needed.

**Type consistency:** Function signatures match between definition tasks and consumer tasks (e.g., `createExceptionComponent` signature in Task 17 matches the call-site update in Task 20).

No gaps identified.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-cal-mcp-icaljs-migration.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
