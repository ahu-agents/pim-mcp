# cal-mcp Schema Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add alarms, categories, CUTYPE, GEO, and read_only to cal-mcp so its responses are interchangeable with macos-calendar-mcp.

**Architecture:** All changes in `packages/cal-mcp`. Parsing uses node-ical's existing typed APIs (VAlarm, geo). ICS generation uses ical-generator's `createAlarm()`. read_only queries CalDAV privilege set via tsdav's raw `propfind()`. A `toEventFull` helper eliminates 4 copy-paste mapping sites (getEvent, getEventWithMeta, createEvent, updateEvent).

**Tech Stack:** TypeScript, node-ical (v0.20), ical-generator, tsdav, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-cal-mcp-schema-alignment-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/cal-mcp/src/ical.ts` | Modify | Add alarm/categories/geo/cutype parsing + alarm/categories generation |
| `packages/cal-mcp/src/services/CalDavService.ts` | Modify | Update types, add toEventFull helper, add privilege check |
| `packages/cal-mcp/src/tools/calendarTools.ts` | Modify | Add alarms/categories to tool schemas and handler |
| `packages/cal-mcp/src/__tests__/ical.test.ts` | Modify | Add parsing + generation tests |
| `packages/cal-mcp/src/__tests__/CalDavService.test.ts` | Modify | Add read_only + toEventFull tests |
| `packages/cal-mcp/src/__tests__/calendarTools.test.ts` | Modify | Add handler tests for new params |

---

### Task 1: Duration Parser + Alarm Parsing

**Files:**
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts`
- Modify: `packages/cal-mcp/src/ical.ts`

- [ ] **Step 1: Write failing tests for ISO 8601 duration parsing and alarm extraction**

Add these test constants and tests to `ical.test.ts`:

```typescript
const ALARM_RELATIVE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-rel@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting with Alarm",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_HOURS_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-hours@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT2H",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_DAYS_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-days@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-P1D",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_COMBINED_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-combined@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT1H30M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_ABSOLUTE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-abs@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER;VALUE=DATE-TIME:20260310T133000Z",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_MULTIPLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:alarm-multi@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT1H",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
```

Add test cases inside the `parseIcsEvents` describe block:

```typescript
it("parses VALARM with relative trigger (minutes)", () => {
  const events = parseIcsEvents(ALARM_RELATIVE_ICS);
  expect(events[0].alarms).toHaveLength(1);
  expect(events[0].alarms[0]).toMatchObject({
    type: "relative",
    trigger: -900,
    trigger_human: "15 minutes before",
  });
});

it("parses VALARM with relative trigger (hours)", () => {
  const events = parseIcsEvents(ALARM_HOURS_ICS);
  expect(events[0].alarms[0]).toMatchObject({
    type: "relative",
    trigger: -7200,
    trigger_human: "2 hours before",
  });
});

it("parses VALARM with relative trigger (days)", () => {
  const events = parseIcsEvents(ALARM_DAYS_ICS);
  expect(events[0].alarms[0]).toMatchObject({
    type: "relative",
    trigger: -86400,
    trigger_human: "1 day before",
  });
});

it("parses VALARM with combined duration", () => {
  const events = parseIcsEvents(ALARM_COMBINED_ICS);
  expect(events[0].alarms[0]).toMatchObject({
    type: "relative",
    trigger: -5400,
    trigger_human: "1 hour, 30 minutes before",
  });
});

it("parses VALARM with absolute trigger", () => {
  const events = parseIcsEvents(ALARM_ABSOLUTE_ICS);
  expect(events[0].alarms[0]).toMatchObject({
    type: "absolute",
    trigger: "2026-03-10T13:30:00.000Z",
  });
  expect(events[0].alarms[0].trigger_human).toContain("2026");
});

it("parses multiple VALARMs on one event", () => {
  const events = parseIcsEvents(ALARM_MULTIPLE_ICS);
  expect(events[0].alarms).toHaveLength(2);
  expect(events[0].alarms[0].trigger).toBe(-900);
  expect(events[0].alarms[1].trigger).toBe(-3600);
});

it("returns empty alarms array when no VALARM present", () => {
  const events = parseIcsEvents(SAMPLE_ICS);
  expect(events[0].alarms).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: FAIL — `alarms` property does not exist on ParsedEvent

- [ ] **Step 3: Implement duration parser and alarm parsing**

In `packages/cal-mcp/src/ical.ts`, add the duration parser function and alarm type before `parseIcsEvents`:

```typescript
export interface ParsedAlarm {
  type: "relative" | "absolute";
  trigger: number | string;
  trigger_human: string;
}

/**
 * Parse an ISO 8601 duration string (e.g., -PT15M, -P1DT2H30M) into seconds.
 * Returns negative for before-event, positive for after-event.
 */
function parseDurationToSeconds(duration: string): number {
  const negative = duration.startsWith("-");
  const match = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (!match) return 0;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const minutes = parseInt(match[3] || "0", 10);
  const seconds = parseInt(match[4] || "0", 10);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return negative ? -total : total;
}

/**
 * Format seconds offset into human-readable string.
 */
function formatTriggerHuman(seconds: number): string {
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
    const secs = abs;
    parts.push(`${secs} ${secs === 1 ? "second" : "seconds"}`);
  }
  return `${parts.join(", ")} ${suffix}`;
}

function parseAlarm(alarm: { trigger: string; action: string }): ParsedAlarm {
  const trigger = alarm.trigger;
  // Absolute trigger: looks like a date-time (contains digits and T, no P prefix)
  if (/^\d{8}T\d{6}/.test(trigger)) {
    const date = new Date(
      trigger.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, "$1-$2-$3T$4:$5:$6Z"),
    );
    return {
      type: "absolute",
      trigger: date.toISOString(),
      trigger_human: date.toISOString(),
    };
  }
  // Relative trigger: ISO 8601 duration
  const seconds = parseDurationToSeconds(trigger);
  return {
    type: "relative",
    trigger: seconds,
    trigger_human: formatTriggerHuman(seconds),
  };
}
```

Add `alarms` to the `ParsedEvent` interface:

```typescript
alarms: ParsedAlarm[];
```

In `parseIcsEvents`, in the `baseProps` construction (after the organizer parsing), add alarm parsing:

```typescript
const alarms: ParsedAlarm[] = [];
if (vevent.alarms) {
  for (const alarm of vevent.alarms) {
    alarms.push(parseAlarm(alarm));
  }
}
```

Add `alarms` to the `baseProps` object:

```typescript
alarms,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: All alarm tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): parse VALARM alarms from ICS events"
```

---

### Task 2: Categories, CUTYPE, and GEO Parsing

**Files:**
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts`
- Modify: `packages/cal-mcp/src/ical.ts`

- [ ] **Step 1: Write failing tests for categories, CUTYPE, and GEO**

Add test constants to `ical.test.ts`:

```typescript
const CATEGORIES_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:cat-1@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Tagged Event",
  "CATEGORIES:Meeting,Project-X",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const CATEGORIES_SINGLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:cat-single@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Single Cat",
  "CATEGORIES:Work",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const GEO_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:geo-1@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Located Event",
  "GEO:37.386013;-122.082932",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const CUTYPE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:cutype-1@example.com",
  "DTSTART:20260310T140000Z",
  "DTEND:20260310T150000Z",
  "SUMMARY:Meeting",
  "ATTENDEE;CN=Alice;CUTYPE=INDIVIDUAL:mailto:alice@example.com",
  "ATTENDEE;CN=Room A;CUTYPE=ROOM:mailto:rooma@example.com",
  "ATTENDEE;CN=Projector;CUTYPE=RESOURCE:mailto:projector@example.com",
  "ATTENDEE;CN=Engineering;CUTYPE=GROUP:mailto:eng@example.com",
  "ATTENDEE;CN=Bob:mailto:bob@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
```

Add test cases:

```typescript
it("parses CATEGORIES with multiple values", () => {
  const events = parseIcsEvents(CATEGORIES_ICS);
  expect(events[0].categories).toEqual(["Meeting", "Project-X"]);
});

it("parses CATEGORIES with single value", () => {
  const events = parseIcsEvents(CATEGORIES_SINGLE_ICS);
  expect(events[0].categories).toEqual(["Work"]);
});

it("returns empty categories array when none present", () => {
  const events = parseIcsEvents(SAMPLE_ICS);
  expect(events[0].categories).toEqual([]);
});

it("parses GEO property", () => {
  const events = parseIcsEvents(GEO_ICS);
  expect(events[0].geo).toEqual({
    latitude: 37.386013,
    longitude: -122.082932,
  });
});

it("returns null geo when not present", () => {
  const events = parseIcsEvents(SAMPLE_ICS);
  expect(events[0].geo).toBeNull();
});

it("returns null geo when GEO has malformed values", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:geo-bad@example.com",
    "DTSTART:20260310T140000Z",
    "DTEND:20260310T150000Z",
    "SUMMARY:Bad Geo",
    "GEO:;",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = parseIcsEvents(ics);
  expect(events[0].geo).toBeNull();
});

it("parses CUTYPE on attendees", () => {
  const events = parseIcsEvents(CUTYPE_ICS);
  expect(events[0].attendees).toHaveLength(5);
  expect(events[0].attendees[0].type).toBe("person");
  expect(events[0].attendees[1].type).toBe("room");
  expect(events[0].attendees[2].type).toBe("resource");
  expect(events[0].attendees[3].type).toBe("group");
  expect(events[0].attendees[4].type).toBe("unknown");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: FAIL — `categories`, `geo`, `type` properties don't exist

- [ ] **Step 3: Implement categories, CUTYPE, and GEO parsing**

In `packages/cal-mcp/src/ical.ts`, update the `ParsedEvent` interface to add new fields:

```typescript
categories: string[];
geo: { latitude: number; longitude: number } | null;
```

Update attendee type to include `type`:

```typescript
attendees: Array<{
  name: string | null;
  email: string;
  status: string | null;
  role: string | null;
  type: string;
}>;
```

In the CUTYPE mapping constant (add near top of file):

```typescript
const CUTYPE_MAP: Record<string, string> = {
  INDIVIDUAL: "person",
  ROOM: "room",
  RESOURCE: "resource",
  GROUP: "group",
};
```

In the attendee parsing loop, add CUTYPE extraction:

```typescript
const cutype =
  typeof att === "string" ? "unknown" : (CUTYPE_MAP[att.params?.CUTYPE ?? ""] ?? "unknown");
attendees.push({ email, name, status, role, type: cutype });
```

For categories (after attendee parsing):

```typescript
const rawCategories = (vevent as any).categories;
let categories: string[] = [];
if (rawCategories) {
  if (Array.isArray(rawCategories)) {
    categories = rawCategories.flatMap((c: string | string[]) =>
      Array.isArray(c) ? c : [c],
    );
  } else if (typeof rawCategories === "string") {
    categories = [rawCategories];
  }
}
```

For GEO (after categories). Note: `geo` is typed as `any` on node-ical's `VEvent`, so no cast needed:

```typescript
const rawGeo = vevent.geo;
let geo: { latitude: number; longitude: number } | null = null;
if (rawGeo && typeof rawGeo.lat === "number" && typeof rawGeo.lon === "number" &&
    !isNaN(rawGeo.lat) && !isNaN(rawGeo.lon)) {
  geo = { latitude: rawGeo.lat, longitude: rawGeo.lon };
}
```

Add `categories` and `geo` to `baseProps`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: All new tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): parse categories, CUTYPE, and GEO from ICS events"
```

---

### Task 3: Alarm and Categories ICS Generation

**Files:**
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts`
- Modify: `packages/cal-mcp/src/ical.ts`

- [ ] **Step 1: Write failing tests for alarm and categories generation**

Add tests in the `generateEventIcs` describe block:

```typescript
it("generates ICS with relative alarm", () => {
  const ics = generateEventIcs({
    title: "Alarm Test",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    alarms: [{ type: "relative", trigger: -900 }],
  });
  expect(ics).toContain("BEGIN:VALARM");
  expect(ics).toContain("END:VALARM");
  // ical-generator uses positive seconds for triggerBefore
  expect(ics).toContain("TRIGGER:-PT15M");
});

it("generates ICS with absolute alarm", () => {
  const ics = generateEventIcs({
    title: "Alarm Test",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    alarms: [{ type: "absolute", trigger: "2026-03-10T13:30:00Z" }],
  });
  expect(ics).toContain("BEGIN:VALARM");
  expect(ics).toContain("20260310T133000Z");
});

it("generates ICS with multiple alarms", () => {
  const ics = generateEventIcs({
    title: "Alarm Test",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    alarms: [
      { type: "relative", trigger: -900 },
      { type: "relative", trigger: -3600 },
    ],
  });
  const alarmCount = (ics.match(/BEGIN:VALARM/g) || []).length;
  expect(alarmCount).toBe(2);
});

it("generates ICS with categories", () => {
  const ics = generateEventIcs({
    title: "Tagged Event",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    categories: ["Meeting", "Project-X"],
  });
  expect(ics).toContain("CATEGORIES:Meeting,Project-X");
});

it("generates ICS with alarms and categories together", () => {
  const ics = generateEventIcs({
    title: "Full Event",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    alarms: [{ type: "relative", trigger: -600 }],
    categories: ["Work"],
  });
  expect(ics).toContain("BEGIN:VALARM");
  expect(ics).toContain("CATEGORIES:Work");
});

it("alarm round-trip: generate then parse preserves alarms", () => {
  const ics = generateEventIcs({
    title: "Round Trip",
    start: "2026-03-10T14:00:00Z",
    end: "2026-03-10T15:00:00Z",
    alarms: [{ type: "relative", trigger: -900 }],
  });
  const parsed = parseIcsEvents(ics);
  expect(parsed[0].alarms).toHaveLength(1);
  expect(parsed[0].alarms[0].type).toBe("relative");
  expect(parsed[0].alarms[0].trigger).toBe(-900);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: FAIL — `alarms` and `categories` not recognized on EventCreateProps

- [ ] **Step 3: Implement alarm and categories generation**

In `packages/cal-mcp/src/ical.ts`, add to `EventCreateProps`:

```typescript
alarms?: Array<{
  type: "relative" | "absolute";
  trigger: number | string;
}>;
categories?: string[];
```

In `generateEventIcs`, after `event.status(ICalEventStatus.CONFIRMED)` and the existing attendee/uid/timezone blocks, add alarm generation:

```typescript
if (props.alarms) {
  for (const alarm of props.alarms) {
    if (alarm.type === "relative" && typeof alarm.trigger === "number") {
      // RFC uses negative = before, ical-generator uses triggerBefore with positive seconds
      event.createAlarm({
        type: ICalAlarmType.display,
        triggerBefore: Math.abs(alarm.trigger),
      });
    } else if (alarm.type === "absolute" && typeof alarm.trigger === "string") {
      event.createAlarm({
        type: ICalAlarmType.display,
        trigger: new Date(alarm.trigger),
      });
    }
  }
}
```

Add the import at the top of ical.ts:

```typescript
import ical, { ICalEventStatus, ICalAlarmType } from "ical-generator";
```

For categories, after `calendar.toString()` but before returning, insert the CATEGORIES line:

```typescript
let icsString = calendar.toString();

if (props.categories && props.categories.length > 0) {
  const categoriesLine = `CATEGORIES:${props.categories.join(",")}`;
  icsString = icsString.replace("END:VEVENT", `${categoriesLine}\r\nEND:VEVENT`);
}

return icsString;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: All generation tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): generate alarms and categories in ICS output"
```

---

### Task 4: Update EventFull Type + toEventFull Helper

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

**Important:** All existing CalDavService test mocks that return `ParsedEvent` objects will need `alarms: [], categories: [], geo: null` added, and attendee mocks will need `type: "unknown"` (or appropriate value). Update every mock return value throughout `CalDavService.test.ts` that includes ParsedEvent fields — there are approximately 8+ mocks across getEvent, createEvent, updateEvent, getEventWithMeta, and cache tests.

- [ ] **Step 1: Update existing mocks and write new test for EventFull**

First, update ALL existing mock `ParsedEvent` return values in `CalDavService.test.ts` to include the new fields (`alarms: [], categories: [], geo: null`, and `type: "unknown"` on attendees).

Then add the new test:

```typescript
it("getEvent returns new fields (alarms, categories, geo, attendee type)", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  const { parseIcsEvents } = await import("../ical.js");
  (parseIcsEvents as any).mockReturnValue([
    {
      uid: "evt-full",
      title: "Full Event",
      start: "2026-03-10T14:00:00.000Z",
      end: "2026-03-10T15:00:00.000Z",
      all_day: false,
      location: "Office",
      description: "Test",
      status: "confirmed",
      availability: "busy",
      url: null,
      attendees: [
        { email: "alice@example.com", name: "Alice", status: "accepted", role: "req-participant", type: "person" },
        { email: "rooma@example.com", name: "Room A", status: null, role: null, type: "room" },
      ],
      organizer: { email: "miguel@example.com", name: "Miguel" },
      recurrence_rule: null,
      is_recurring: false,
      created: null,
      last_modified: null,
      alarms: [{ type: "relative", trigger: -900, trigger_human: "15 minutes before" }],
      categories: ["Meeting", "Project-X"],
      geo: { latitude: 37.386, longitude: -122.083 },
    },
  ]);
  __mockClient.fetchCalendarObjects.mockResolvedValue([
    { data: "...", url: "/cal/evt-full.ics", etag: '"e1"' },
  ]);

  const event = await service.getEvent("mailbox/Work", "evt-full");

  expect(event.alarms).toHaveLength(1);
  expect(event.alarms[0].trigger).toBe(-900);
  expect(event.categories).toEqual(["Meeting", "Project-X"]);
  expect(event.geo).toEqual({ latitude: 37.386, longitude: -122.083 });
  expect(event.attendees[0].type).toBe("person");
  expect(event.attendees[1].type).toBe("room");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: FAIL — `alarms`, `categories`, `geo` don't exist on EventFull

- [ ] **Step 3: Update EventFull type and extract toEventFull helper**

In `packages/cal-mcp/src/services/CalDavService.ts`, update the imports:

```typescript
import { type ParsedEvent, type ParsedAlarm, type TimeRange, parseIcsEvents } from "../ical.js";
```

Update `EventFull` to add new fields:

```typescript
export interface EventFull extends EventSummary {
  description: string | null;
  url: string | null;
  availability: string | null;
  attendees: Array<{
    name: string | null;
    email: string;
    status: string | null;
    role: string | null;
    type: string;
  }>;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  alarms: ParsedAlarm[];
  categories: string[];
  geo: { latitude: number; longitude: number } | null;
}
```

Add the `toEventFull` helper as a private method on `CalDavService`:

```typescript
private toEventFull(event: ParsedEvent, calendarId: string): EventFull {
  return {
    uid: event.uid,
    calendar_id: calendarId,
    title: event.title,
    start: event.start,
    end: event.end,
    all_day: event.all_day,
    location: event.location,
    status: event.status,
    is_recurring: event.is_recurring,
    description: event.description,
    url: event.url,
    availability: event.availability,
    attendees: event.attendees,
    organizer: event.organizer,
    recurrence_rule: event.recurrence_rule,
    created: event.created,
    last_modified: event.last_modified,
    alarms: event.alarms,
    categories: event.categories,
    geo: event.geo,
  };
}
```

Replace all 5 inline mapping sites with `this.toEventFull(event, calendarId)`:

1. `getEvent` (around line 241) — replace the return object with `return this.toEventFull(event, calendarId);`
2. `getEventWithMeta` (around line 283) — replace `event: { uid: ... }` with `event: this.toEventFull(event, calendarId),`
3. `createEvent` (around line 335) — replace the return object
4. `updateEvent` (around line 403) — replace the return object

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS (existing tests should also pass since the shape is a superset)

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): add alarms/categories/geo/cutype to EventFull, extract toEventFull helper"
```

---

### Task 5: read_only via CalDAV Privileges

**Files:**
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`

- [ ] **Step 1: Write failing tests for read_only privilege detection**

In `CalDavService.test.ts`, add a new describe block inside the `listCalendars` describe:

```typescript
it("returns read_only: false when privilege set includes write", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  __mockClient.propfind.mockResolvedValue([
    {
      props: {
        currentUserPrivilegeSet: {
          privilege: [{ write: {} }, { read: {} }],
        },
      },
    },
  ]);

  const calendars = await service.listCalendars();
  const workCal = calendars.find((c) => c.display_name === "Work");
  expect(workCal?.read_only).toBe(false);
});

it("returns read_only: true when privilege set lacks write", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  __mockClient.propfind.mockResolvedValue([
    {
      props: {
        currentUserPrivilegeSet: {
          privilege: [{ read: {} }],
        },
      },
    },
  ]);

  const calendars = await service.listCalendars();
  // All calendars from this provider should be read_only
  expect(calendars.every((c) => c.read_only)).toBe(true);
});

it("defaults read_only: false when propfind returns no privilege info", async () => {
  const { __mockClient } = (await import("tsdav")) as any;
  __mockClient.propfind.mockResolvedValue([]);

  const calendars = await service.listCalendars();
  expect(calendars[0].read_only).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: First two new tests FAIL (read_only is hardcoded false); third test should PASS

- [ ] **Step 3: Implement privilege detection in listCalendars**

In `packages/cal-mcp/src/services/CalDavService.ts`, add a helper function to check privileges:

```typescript
private hasWritePrivilege(privileges: Array<Record<string, unknown>>): boolean {
  return privileges.some(
    (p) => p.write !== undefined || p["write-content"] !== undefined || p.bind !== undefined,
  );
}
```

**Approach:** `fetchCalendars()` does not cleanly support requesting `current-user-privilege-set` (tsdav does not export `DAVNamespaceShort` and may strip unrecognized props from responses). Instead, after `fetchCalendars()` populates the cache, make a separate `propfind()` call per calendar URL requesting just the privilege set:

```typescript
private async fetchPrivileges(
  client: DAVClient,
  calendarUrl: string,
): Promise<boolean> {
  try {
    const responses = await client.propfind({
      url: calendarUrl,
      props: {
        "d:current-user-privilege-set": {},
      },
      depth: "0",
    });
    const privSet = responses?.[0]?.props?.currentUserPrivilegeSet;
    if (!privSet) return true; // Default to writable
    const privileges = privSet.privilege;
    if (!privileges) return true;
    const privArray = Array.isArray(privileges) ? privileges : [privileges];
    return this.hasWritePrivilege(privArray);
  } catch {
    return true; // Default to writable on error
  }
}
```

In `listCalendars`, after the existing `fetchCalendars()` call, add the privilege check:

```typescript
for (const cal of calendars) {
  const displayName = (typeof cal.displayName === "string" ? cal.displayName : "") || "";
  const canWrite = await this.fetchPrivileges(client, cal.url);
  allCalendars.push({
    calendar_id: `${providerId}/${displayName}`,
    display_name: displayName,
    color: (cal as any).calendarColor ?? null,
    source: providerId,
    read_only: !canWrite,
    url: cal.url,
    ctag: cal.ctag,
  });
}
```

Update the mock in `CalDavService.test.ts` to also mock `propfind` on the mock client:

```typescript
// Add to mockClient in the vi.mock("tsdav") setup:
propfind: vi.fn().mockResolvedValue([]),
```

**Note for implementer:** After implementing, manually test against the real Nextcloud/Mailbox instances to verify that `propfind` returns the privilege set correctly and the parsing works. The prop name `d:current-user-privilege-set` and response field `currentUserPrivilegeSet` may need adjustment based on tsdav's XML-to-JS conversion. Test with a known subscribed calendar to verify `read_only: true`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): detect read_only calendars via CalDAV privilege set"
```

---

### Task 6: Tool Schema + Handler Updates

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts`
- Modify: `packages/cal-mcp/src/__tests__/calendarTools.test.ts`

- [ ] **Step 1: Write failing tests for new tool params and handler behavior**

In `calendarTools.test.ts`:

```typescript
it("create_event schema includes alarms and categories params", () => {
  const tool = CALENDAR_TOOLS.find((t) => t.name === "create_event")!;
  const props = (tool.inputSchema as any).properties;
  expect(props.alarms).toBeDefined();
  expect(props.categories).toBeDefined();
});

it("update_event schema includes alarms and categories params", () => {
  const tool = CALENDAR_TOOLS.find((t) => t.name === "update_event")!;
  const props = (tool.inputSchema as any).properties;
  expect(props.alarms).toBeDefined();
  expect(props.categories).toBeDefined();
});

it("create_events_batch schema includes alarms and categories in event items", () => {
  const tool = CALENDAR_TOOLS.find((t) => t.name === "create_events_batch")!;
  const eventProps = (tool.inputSchema as any).properties.events.items.properties;
  expect(eventProps.alarms).toBeDefined();
  expect(eventProps.categories).toBeDefined();
});
```

In the `handleCalendarTool` describe block:

```typescript
it("create_event passes alarms and categories to generateEventIcs", async () => {
  mockService.createEvent.mockResolvedValue({
    uid: "new-1",
    title: "Event with Alarm",
    alarms: [{ type: "relative", trigger: -900, trigger_human: "15 minutes before" }],
    categories: ["Work"],
  });

  const result = await handleCalendarTool(
    "create_event",
    {
      calendar: "mailbox/Work",
      title: "Event with Alarm",
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
      alarms: [{ type: "relative", trigger: -900 }],
      categories: ["Work"],
    },
    mockService as any,
  );

  expect(result.isError).toBeUndefined();
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.event.alarms).toHaveLength(1);
  expect(parsed.event.categories).toEqual(["Work"]);
});

it("update_event preserves existing alarms when not provided", async () => {
  mockService.getEventWithMeta.mockResolvedValue({
    event: {
      uid: "evt-1",
      title: "Meeting",
      is_recurring: false,
      recurrence_rule: null,
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
      all_day: false,
      location: null,
      description: null,
      attendees: [],
      alarms: [{ type: "relative", trigger: -900, trigger_human: "15 minutes before" }],
      categories: ["Meeting"],
    },
    meta: { url: "/cal/evt-1.ics", etag: '"e1"' },
  });
  mockService.updateEvent.mockResolvedValue({
    uid: "evt-1",
    title: "Updated Meeting",
    alarms: [{ type: "relative", trigger: -900, trigger_human: "15 minutes before" }],
    categories: ["Meeting"],
  });

  const result = await handleCalendarTool(
    "update_event",
    { calendar: "mailbox/Work", uid: "evt-1", title: "Updated Meeting" },
    mockService as any,
  );

  expect(result.isError).toBeUndefined();
  // Verify generateEventIcs was called — the important thing is that
  // alarms/categories from existing event are preserved
});

it("list_calendars handler passes through read_only field", async () => {
  mockService.listCalendars.mockResolvedValue([
    {
      calendar_id: "mailbox/Work",
      display_name: "Work",
      color: null,
      source: "mailbox",
      read_only: false,
    },
    {
      calendar_id: "mailbox/Holidays",
      display_name: "Holidays",
      color: null,
      source: "mailbox",
      read_only: true,
    },
  ]);

  const result = await handleCalendarTool("list_calendars", {}, mockService as any);
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.calendars[0].read_only).toBe(false);
  expect(parsed.calendars[1].read_only).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: Schema tests FAIL (no alarms/categories in tool schemas)

- [ ] **Step 3: Add alarms and categories to tool schemas and handler**

In `packages/cal-mcp/src/tools/calendarTools.ts`, add `alarms` and `categories` properties to the `create_event` tool schema (inside `properties`):

```typescript
alarms: {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["relative", "absolute"], description: "Alarm type" },
      trigger: {
        description: "Seconds offset (negative=before event) for relative, or ISO 8601 datetime for absolute",
      },
    },
    required: ["type", "trigger"],
  },
  description: "Event reminders/alarms",
},
categories: {
  type: "array",
  items: { type: "string" },
  description: "Event categories/tags",
},
```

Add the same to `update_event` and `create_events_batch` (in the event items properties).

In the `create_event` handler case, add to the `generateEventIcs` call:

```typescript
alarms: args.alarms as Array<{ type: "relative" | "absolute"; trigger: number | string }> | undefined,
categories: args.categories as string[] | undefined,
```

In the `update_event` handler case, add alarm/category preservation:

```typescript
alarms:
  (args.alarms as Array<{ type: "relative" | "absolute"; trigger: number | string }> | undefined) ??
  existing.alarms?.map((a: any) => ({ type: a.type, trigger: a.trigger })),
categories:
  (args.categories as string[] | undefined) ?? existing.categories,
```

In the `create_events_batch` handler, update the type for `eventInputs` to include the new fields:

```typescript
const eventInputs = args.events as Array<{
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
  alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
  categories?: string[];
}>;
```

And pass `alarms` and `categories` through in the `generateEventIcs` call for each event.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/tools/calendarTools.ts packages/cal-mcp/src/__tests__/calendarTools.test.ts
git commit -m "feat(cal-mcp): add alarms and categories to tool schemas and handler"
```

---

### Task 7: Full Test Suite + Build Verification

**Files:** None modified — verification only

- [ ] **Step 1: Run the full cal-mcp test suite**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run the full monorepo test suite**

Run: `npm test`
Expected: All tests PASS across all packages

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No lint errors (run `npm run format` first if needed)

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 6: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(cal-mcp): format and fix lint issues"
```

(Skip if no changes.)
