# cal-mcp Recurring Event Instance Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `span: "this"` for update_event and delete_event on recurring events, plus `occurrence_date` on all event responses.

**Architecture:** Add `occurrence_date` to ParsedEvent/EventSummary/EventFull types, populate during RRULE expansion. Add ICS string manipulation functions (EXDATE insertion, exception VEVENT creation, component combining) for CalDAV RECURRENCE-ID operations. Update handlers to use these for `span: "this"`.

**Tech Stack:** TypeScript, node-ical, ical-generator, tsdav, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-cal-mcp-recurrence-instances-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/cal-mcp/src/ical.ts` | Modify | Add `occurrence_date` to ParsedEvent, populate during expansion, add ICS manipulation functions |
| `packages/cal-mcp/src/services/CalDavService.ts` | Modify | Add `occurrence_date` to EventSummary/EventFull, add `fetchRawCalendarObject()`, update `toEventFull()`/listEvents mapping |
| `packages/cal-mcp/src/tools/calendarTools.ts` | Modify | Update tool schemas (span enum, occurrence_date param), update handlers for span="this" |
| `packages/cal-mcp/src/__tests__/ical.test.ts` | Modify | Tests for occurrence_date population, ICS manipulation functions |
| `packages/cal-mcp/src/__tests__/CalDavService.test.ts` | Modify | Tests for fetchRawCalendarObject, occurrence_date in responses |
| `packages/cal-mcp/src/__tests__/calendarTools.test.ts` | Modify | Tests for span="this" handler flows |

---

### Task 1: Add `occurrence_date` to types and parsing

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:11-37` (ParsedEvent interface)
- Modify: `packages/cal-mcp/src/ical.ts:221-270` (parseIcsEvents — baseProps and expansion)
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:23-33` (EventSummary interface)
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:238-248` (listEvents mapping)
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:620-643` (toEventFull)
- Test: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Write failing tests for occurrence_date in parsed events**

Add to `ical.test.ts` inside the `describe("recurrence expansion")` block:

```typescript
it("sets occurrence_date on expanded recurring instances", () => {
  const events = parseIcsEvents(weeklyIcs, {
    start: "2026-03-01T00:00:00Z",
    end: "2026-03-15T00:00:00Z",
  });
  expect(events.length).toBe(2);
  for (const evt of events) {
    expect(evt.occurrence_date).toBe(evt.start);
  }
});

it("sets occurrence_date to null for non-recurring events", () => {
  const singleIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:single-event",
    "DTSTART:20260310T140000Z",
    "DTEND:20260310T150000Z",
    "SUMMARY:One-off",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = parseIcsEvents(singleIcs);
  expect(events[0].occurrence_date).toBeNull();
});

it("sets occurrence_date to null for master event (no range)", () => {
  const events = parseIcsEvents(weeklyIcs);
  expect(events[0].occurrence_date).toBeNull();
});

it("sets occurrence_date from RECURRENCE-ID on exception VEVENTs", () => {
  const icsWithException = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "DTSTART:20260101T100000Z",
    "DTEND:20260101T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=52",
    "SUMMARY:Weekly Standup",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "RECURRENCE-ID:20260305T100000Z",
    "DTSTART:20260305T140000Z",
    "DTEND:20260305T150000Z",
    "SUMMARY:Rescheduled Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  // Without range, both master and exception are returned
  const events = parseIcsEvents(icsWithException);
  const exception = events.find((e) => e.title === "Rescheduled Standup");
  expect(exception).toBeDefined();
  expect(exception!.occurrence_date).toBe("2026-03-05T10:00:00.000Z");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "occurrence_date"`
Expected: FAIL — `occurrence_date` not on ParsedEvent.

- [ ] **Step 3: Add occurrence_date to ParsedEvent**

In `ical.ts`, add to `ParsedEvent` interface (after `alarms`):

```typescript
occurrence_date: string | null;
```

- [ ] **Step 4: Populate occurrence_date in parseIcsEvents**

In `parseIcsEvents()`, update `baseProps` (around line 221):

```typescript
const baseProps: Omit<ParsedEvent, "start" | "end" | "occurrence_date"> = {
  // ... existing fields unchanged ...
};
```

In the RRULE expansion loop (around line 255-261), add `occurrence_date`:

```typescript
events.push({
  ...baseProps,
  start: formatTime(occStart.toISOString()),
  end: formatTime(occEnd.toISOString()),
  occurrence_date: formatTime(occStart.toISOString()),
});
```

In the non-recurring / no-range branch (around line 265-269), detect RECURRENCE-ID for exception VEVENTs:

```typescript
// Detect RECURRENCE-ID for exception VEVENTs
const recurrenceId = (vevent as any).recurrenceid;
const occDate = recurrenceId
  ? formatTime(new Date(recurrenceId).toISOString())
  : null;

events.push({
  ...baseProps,
  start: vevent.start ? formatTime(new Date(vevent.start).toISOString()) : "",
  end: vevent.end ? formatTime(new Date(vevent.end).toISOString()) : "",
  occurrence_date: occDate,
});
```

Note: node-ical exposes RECURRENCE-ID as `vevent.recurrenceid` (lowercase, no hyphen) — it's a Date object when present. Exception VEVENTs don't have RRULE, so they fall into this non-recurring branch but still need `occurrence_date` set from their RECURRENCE-ID.

- [ ] **Step 5: Add occurrence_date to EventSummary and EventFull**

In `CalDavService.ts`, add to `EventSummary` (after `is_recurring`):

```typescript
occurrence_date: string | null;
```

Update `listEvents()` mapping (around line 238-248) to include:

```typescript
occurrence_date: event.occurrence_date,
```

Update `toEventFull()` (around line 620-643) to include:

```typescript
occurrence_date: event.occurrence_date,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: PASS (all existing tests should still pass — they don't assert against occurrence_date)

- [ ] **Step 7: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): add occurrence_date to event types and RRULE expansion"
```

---

### Task 2: Add `addExdateToIcs()` function

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts`
- Test: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe("addExdateToIcs")` block to `ical.test.ts`:

```typescript
describe("addExdateToIcs", () => {
  const masterIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "DTSTART:20260101T100000Z",
    "DTEND:20260101T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=52",
    "SUMMARY:Weekly Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("inserts EXDATE line for a timed event", () => {
    const result = addExdateToIcs(masterIcs, "2026-03-05T10:00:00.000Z", false);
    expect(result).toContain("EXDATE:20260305T100000Z");
    expect(result).toContain("END:VEVENT");
    // EXDATE should be before END:VEVENT
    const exdateIdx = result.indexOf("EXDATE:20260305T100000Z");
    const endIdx = result.indexOf("END:VEVENT");
    expect(exdateIdx).toBeLessThan(endIdx);
  });

  it("inserts EXDATE with VALUE=DATE for all-day events", () => {
    const allDayIcs = masterIcs.replace(
      "DTSTART:20260101T100000Z\r\nDTEND:20260101T110000Z",
      "DTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102",
    );
    const result = addExdateToIcs(allDayIcs, "2026-03-05", true);
    expect(result).toContain("EXDATE;VALUE=DATE:20260305");
  });

  it("is idempotent — does not add duplicate EXDATE", () => {
    const first = addExdateToIcs(masterIcs, "2026-03-05T10:00:00.000Z", false);
    const second = addExdateToIcs(first, "2026-03-05T10:00:00.000Z", false);
    const count = (second.match(/EXDATE/g) || []).length;
    expect(count).toBe(1);
  });

  it("preserves all other ICS content", () => {
    const result = addExdateToIcs(masterIcs, "2026-03-05T10:00:00.000Z", false);
    expect(result).toContain("UID:weekly-meeting");
    expect(result).toContain("RRULE:FREQ=WEEKLY;COUNT=52");
    expect(result).toContain("SUMMARY:Weekly Standup");
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("END:VCALENDAR");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "addExdateToIcs"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement addExdateToIcs**

Add to `ical.ts` and export:

```typescript
export function addExdateToIcs(
  icsContent: string,
  occurrenceDate: string,
  allDay: boolean,
): string {
  // Format the EXDATE value
  const date = new Date(occurrenceDate);
  let exdateLine: string;
  if (allDay) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    exdateLine = `EXDATE;VALUE=DATE:${dateStr}`;
  } else {
    const dtStr = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    exdateLine = `EXDATE:${dtStr}`;
  }

  // Check for existing EXDATE with same date (idempotency)
  if (icsContent.includes(exdateLine)) {
    return icsContent;
  }

  // Insert before the first END:VEVENT
  return icsContent.replace("END:VEVENT", `${exdateLine}\r\nEND:VEVENT`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "addExdateToIcs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): add addExdateToIcs for EXDATE insertion"
```

---

### Task 3: Add `createExceptionVevent()` function

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts`
- Test: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe("createExceptionVevent")` block:

```typescript
describe("createExceptionVevent", () => {
  const masterIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "DTSTART:20260101T100000Z",
    "DTEND:20260101T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=52",
    "SUMMARY:Weekly Standup",
    "LOCATION:Room A",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("creates exception VEVENT with RECURRENCE-ID and overridden title", () => {
    const result = createExceptionVevent(masterIcs, "2026-03-05T10:00:00.000Z", {
      title: "Special Standup",
    }, false);
    expect(result).toContain("BEGIN:VEVENT");
    expect(result).toContain("END:VEVENT");
    expect(result).toContain("UID:weekly-meeting");
    expect(result).toContain("RECURRENCE-ID:20260305T100000Z");
    expect(result).toContain("SUMMARY:Special Standup");
    // Inherits non-overridden properties
    expect(result).toContain("LOCATION:Room A");
  });

  it("overrides start and end times", () => {
    const result = createExceptionVevent(masterIcs, "2026-03-05T10:00:00.000Z", {
      start: "2026-03-05T14:00:00.000Z",
      end: "2026-03-05T15:00:00.000Z",
    }, false);
    expect(result).toContain("DTSTART:20260305T140000Z");
    expect(result).toContain("DTEND:20260305T150000Z");
  });

  it("uses original occurrence time when start/end not overridden", () => {
    const result = createExceptionVevent(masterIcs, "2026-03-05T10:00:00.000Z", {
      title: "Renamed",
    }, false);
    // Should use the occurrence date's time, not the master's original DTSTART
    expect(result).toContain("DTSTART:20260305T100000Z");
    expect(result).toContain("DTEND:20260305T110000Z");
  });

  it("handles all-day events with VALUE=DATE format", () => {
    const result = createExceptionVevent(masterIcs, "2026-03-05", {
      title: "All Day Exception",
    }, true);
    expect(result).toContain("RECURRENCE-ID;VALUE=DATE:20260305");
    expect(result).toContain("DTSTART;VALUE=DATE:");
  });

  it("includes SEQUENCE property", () => {
    const result = createExceptionVevent(masterIcs, "2026-03-05T10:00:00.000Z", {
      title: "Updated",
    }, false);
    expect(result).toMatch(/SEQUENCE:\d+/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement createExceptionVevent**

Add to `ical.ts` and export. Uses string construction since ical-generator doesn't support RECURRENCE-ID:

```typescript
export function createExceptionVevent(
  masterIcs: string,
  occurrenceDate: string,
  overrides: {
    title?: string;
    start?: string;
    end?: string;
    all_day?: boolean;
    location?: string;
    description?: string;
    attendees?: Array<{ email: string; name?: string }>;
    alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
    categories?: string[];
  },
  allDay: boolean,
): string {
  // Parse master to extract base properties
  const masterEvents = parseIcsEvents(masterIcs);
  const master = masterEvents[0];
  if (!master) throw new Error("Could not parse master event from ICS");

  const uid = master.uid;
  const date = new Date(occurrenceDate);

  // Format dates for iCal
  const formatIcalDate = (iso: string, isAllDay: boolean): string => {
    const d = new Date(iso);
    if (isAllDay) return d.toISOString().slice(0, 10).replace(/-/g, "");
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };

  // Determine effective values (override or inherit)
  const title = overrides.title ?? master.title;
  const location = overrides.location ?? master.location;
  const description = overrides.description ?? master.description;
  const isAllDay = overrides.all_day ?? allDay;

  // For start/end: default to the occurrence's original time (not master's DTSTART)
  const occDuration = new Date(master.end).getTime() - new Date(master.start).getTime();
  const defaultStart = occurrenceDate;
  const defaultEnd = new Date(date.getTime() + occDuration).toISOString();
  const effectiveStart = overrides.start ?? defaultStart;
  const effectiveEnd = overrides.end ?? defaultEnd;

  // Build RECURRENCE-ID line
  const recurrenceId = isAllDay
    ? `RECURRENCE-ID;VALUE=DATE:${formatIcalDate(occurrenceDate, true)}`
    : `RECURRENCE-ID:${formatIcalDate(occurrenceDate, false)}`;

  // Build DTSTART/DTEND lines
  const dtstart = isAllDay
    ? `DTSTART;VALUE=DATE:${formatIcalDate(effectiveStart, true)}`
    : `DTSTART:${formatIcalDate(effectiveStart, false)}`;
  const dtend = isAllDay
    ? `DTEND;VALUE=DATE:${formatIcalDate(effectiveEnd, true)}`
    : `DTEND:${formatIcalDate(effectiveEnd, false)}`;

  // Extract SEQUENCE from master (default 0), increment
  const seqMatch = masterIcs.match(/SEQUENCE:(\d+)/);
  const sequence = (seqMatch ? Number.parseInt(seqMatch[1], 10) : 0) + 1;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    recurrenceId,
    dtstart,
    dtend,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${title}`,
  ];

  if (location) lines.push(`LOCATION:${location}`);
  if (description) lines.push(`DESCRIPTION:${description}`);

  // Attendees
  const attendees = overrides.attendees ?? master.attendees;
  if (attendees) {
    for (const att of attendees) {
      const cn = att.name ? `;CN=${att.name}` : "";
      lines.push(`ATTENDEE${cn}:mailto:${att.email}`);
    }
  }

  // Categories
  const categories = overrides.categories ?? master.categories;
  if (categories && categories.length > 0) {
    lines.push(`CATEGORIES:${categories.join(",")}`);
  }

  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");

  return lines.join("\r\n");
}
```

Note: Alarms on exception VEVENTs can be added later — for now we inherit the master's alarms via the client. This keeps the initial implementation focused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "createExceptionVevent"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): add createExceptionVevent for RECURRENCE-ID exceptions"
```

---

### Task 4: Add `combineIcsComponents()` function

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts`
- Test: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("combineIcsComponents", () => {
  const masterIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "DTSTART:20260101T100000Z",
    "DTEND:20260101T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=52",
    "SUMMARY:Weekly Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const exceptionVevent = [
    "BEGIN:VEVENT",
    "UID:weekly-meeting",
    "RECURRENCE-ID:20260305T100000Z",
    "DTSTART:20260305T140000Z",
    "DTEND:20260305T150000Z",
    "SUMMARY:Rescheduled Standup",
    "END:VEVENT",
  ].join("\r\n");

  it("inserts exception VEVENT before END:VCALENDAR", () => {
    const result = combineIcsComponents(masterIcs, exceptionVevent);
    expect(result).toContain("RECURRENCE-ID:20260305T100000Z");
    expect(result).toContain("SUMMARY:Rescheduled Standup");
    // Both VEVENTs present
    const veventCount = (result.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(2);
    // Ends with END:VCALENDAR
    expect(result.trimEnd()).toMatch(/END:VCALENDAR$/);
  });

  it("removes existing exception with same RECURRENCE-ID before inserting", () => {
    // First combine
    const first = combineIcsComponents(masterIcs, exceptionVevent);
    // Second combine with updated exception
    const updatedException = exceptionVevent.replace(
      "SUMMARY:Rescheduled Standup",
      "SUMMARY:Updated Standup",
    );
    const result = combineIcsComponents(first, updatedException);
    // Should have exactly 2 VEVENTs (master + new exception), not 3
    const veventCount = (result.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(2);
    expect(result).toContain("SUMMARY:Updated Standup");
    expect(result).not.toContain("SUMMARY:Rescheduled Standup");
  });

  it("preserves VTIMEZONE and other components", () => {
    const icsWithTz = masterIcs.replace(
      "BEGIN:VEVENT",
      "BEGIN:VTIMEZONE\r\nTZID:America/Chicago\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT",
    );
    const result = combineIcsComponents(icsWithTz, exceptionVevent);
    expect(result).toContain("VTIMEZONE");
    expect(result).toContain("TZID:America/Chicago");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement combineIcsComponents**

```typescript
export function combineIcsComponents(
  masterIcs: string,
  exceptionVevent: string,
): string {
  let ics = masterIcs;

  // Extract RECURRENCE-ID from the new exception to find existing match
  const recIdMatch = exceptionVevent.match(/RECURRENCE-ID[^:]*:(.+)/);
  if (recIdMatch) {
    const recIdValue = recIdMatch[1].trim();
    // Remove any existing exception VEVENT with the same RECURRENCE-ID
    // Match from BEGIN:VEVENT through END:VEVENT that contains this RECURRENCE-ID
    const regex = new RegExp(
      `BEGIN:VEVENT\\r?\\n(?:(?!BEGIN:VEVENT)[\\s\\S])*?RECURRENCE-ID[^:]*:${recIdValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?END:VEVENT\\r?\\n?`,
    );
    ics = ics.replace(regex, "");
  }

  // Insert exception VEVENT before END:VCALENDAR
  return ics.replace("END:VCALENDAR", `${exceptionVevent}\r\nEND:VCALENDAR`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "combineIcsComponents"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "feat(cal-mcp): add combineIcsComponents for merging exception VEVENTs"
```

---

### Task 5: Add `fetchRawCalendarObject()` to CalDavService

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`
- Test: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Write failing test**

Add to `CalDavService.test.ts`:

```typescript
describe("fetchRawCalendarObject", () => {
  it("returns raw ICS data, url, and etag for a given uid", async () => {
    const rawIcs = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:test-uid\r\nEND:VEVENT\r\nEND:VCALENDAR";
    mockFetchCalendarObjects.mockResolvedValueOnce([
      { url: "/cal/obj1.ics", etag: '"etag-123"', data: rawIcs },
    ]);

    const result = await service.fetchRawCalendarObject("testprovider/Work", "test-uid");
    expect(result.data).toBe(rawIcs);
    expect(result.url).toBe("/cal/obj1.ics");
    expect(result.etag).toBe('"etag-123"');
  });

  it("throws EVENT_NOT_FOUND when uid not found", async () => {
    mockFetchCalendarObjects.mockResolvedValueOnce([]);

    await expect(
      service.fetchRawCalendarObject("testprovider/Work", "nonexistent"),
    ).rejects.toThrow("not found");
  });
});
```

**Important:** CalDavService.test.ts uses a tsdav mock that exposes `__mockClient` with methods like `fetchCalendarObjects`, `login`, `fetchCalendars`. The test file also mocks `ical.js` module-level with `parseIcsEvents`. You must use the EXISTING mock patterns — do NOT create standalone `mockFetchCalendarObjects` variables. Instead, use `__mockClient.fetchCalendarObjects.mockResolvedValueOnce(...)` and ensure the `parseIcsEvents` mock returns events with matching UIDs. Read the existing test file's mock setup carefully before writing tests.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement fetchRawCalendarObject**

Add to `CalDavService` class (public method wrapping the existing private `findCalendarObject`):

```typescript
async fetchRawCalendarObject(
  calendarId: string,
  uid: string,
): Promise<{ data: string; url: string; etag: string }> {
  const { account, calendarName } = this.resolveAccount(calendarId);
  try {
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, calendarName, account.id);
    const obj = await this.findCalendarObject(client, calendar, uid);
    if (!obj.data || !obj.etag) {
      throw new CalendarError(
        `Calendar object for "${uid}" has no data or etag`,
        ErrorCode.EVENT_NOT_FOUND,
        uid,
      );
    }
    return { data: obj.data, url: obj.url, etag: obj.etag };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts -t "fetchRawCalendarObject"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): add fetchRawCalendarObject to CalDavService"
```

---

### Task 6: Update tool schemas and implement `span: "this"` handlers

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts`
- Test: `packages/cal-mcp/src/__tests__/calendarTools.test.ts`

- [ ] **Step 1: Update tool schemas**

In `calendarTools.ts`:

1. **update_event** (around line 231-235): Change `span` enum from `["this", "future", "all"]` to `["this", "all"]`. Add `occurrence_date` property:

```typescript
occurrence_date: {
  type: "string",
  description:
    "ISO 8601 date of the specific occurrence to modify. Required when span is 'this' on a recurring event. Get this value from list_events results.",
},
span: {
  type: "string",
  enum: ["this", "all"],
  description: "Recurring event scope. 'this' modifies only this occurrence, 'all' modifies the entire series. Default: this.",
},
```

2. **delete_event** (around line 254-258): Same changes — add `occurrence_date` property, update `span` enum from `["this", "future", "all"]` to `["this", "all"]`. Both `update_event` AND `delete_event` schemas must have `"future"` removed from the enum.

- [ ] **Step 2: Update mock setup in calendarTools.test.ts**

Add `fetchRawCalendarObject` to the mock service:

```typescript
const mockService = {
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  getEventWithMeta: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  findFreeSlots: vi.fn(),
  fetchRawCalendarObject: vi.fn(),
};
```

- [ ] **Step 3: Write failing tests for span="this" update**

Add import for `addExdateToIcs`, `createExceptionVevent`, `combineIcsComponents` from ical.ts in the test file (they'll be needed to verify the handler calls the right functions). Actually, since the handler calls service methods, we test at the handler level via mocks:

```typescript
describe("update_event span=this on recurring event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates exception VEVENT when span=this on recurring event", async () => {
    const masterIcs = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      "UID:weekly", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z",
      "RRULE:FREQ=WEEKLY;COUNT=52", "SUMMARY:Standup", "LOCATION:Room A",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");

    mockService.getEventWithMeta.mockResolvedValueOnce({
      event: {
        uid: "weekly", title: "Standup", is_recurring: true,
        start: "2026-01-01T10:00:00.000Z", end: "2026-01-01T11:00:00.000Z",
        all_day: false, location: "Room A", recurrence_rule: "FREQ=WEEKLY;COUNT=52",
        description: null, attendees: [], alarms: [], categories: [], geo: null,
        organizer: null, status: null, availability: null, url: null,
        created: null, last_modified: null, calendar_id: "prov/Cal",
        occurrence_date: null,
      },
      meta: { url: "/cal/weekly.ics", etag: '"etag-1"' },
    });

    mockService.fetchRawCalendarObject.mockResolvedValueOnce({
      data: masterIcs,
      url: "/cal/weekly.ics",
      etag: '"etag-1"',
    });

    // updateEvent return value is ignored for span="this" — handler constructs response from overrides
    mockService.updateEvent.mockResolvedValueOnce({});

    const result = await handleCalendarTool(
      "update_event",
      {
        calendar: "prov/Cal",
        uid: "weekly",
        title: "Renamed Standup",
        span: "this",
        occurrence_date: "2026-03-05T10:00:00.000Z",
      },
      mockService as any,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.event.title).toBe("Renamed Standup");

    // Verify updateEvent was called with combined ICS containing RECURRENCE-ID
    expect(mockService.updateEvent).toHaveBeenCalledWith(
      "prov/Cal",
      "weekly",
      expect.stringContaining("RECURRENCE-ID"),
      expect.objectContaining({ url: "/cal/weekly.ics" }),
    );
  });

  it("returns VALIDATION_FAILED when span=this + recurring + no occurrence_date", async () => {
    mockService.getEventWithMeta.mockResolvedValueOnce({
      event: { uid: "weekly", is_recurring: true, all_day: false, occurrence_date: null },
      meta: { url: "/cal/weekly.ics", etag: '"etag-1"' },
    });

    const result = await handleCalendarTool(
      "update_event",
      { calendar: "prov/Cal", uid: "weekly", title: "New Title", span: "this" },
      mockService as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("occurrence_date");
  });

});
```

- [ ] **Step 4: Write failing tests for span="this" delete**

```typescript
describe("delete_event span=this on recurring event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds EXDATE when span=this on recurring event", async () => {
    const masterIcs = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      "UID:weekly", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z",
      "RRULE:FREQ=WEEKLY;COUNT=52", "SUMMARY:Standup",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");

    mockService.getEventWithMeta.mockResolvedValueOnce({
      event: { uid: "weekly", is_recurring: true, all_day: false, occurrence_date: null },
      meta: { url: "/cal/weekly.ics", etag: '"etag-1"' },
    });

    mockService.fetchRawCalendarObject.mockResolvedValueOnce({
      data: masterIcs,
      url: "/cal/weekly.ics",
      etag: '"etag-1"',
    });

    mockService.updateEvent.mockResolvedValueOnce({});

    const result = await handleCalendarTool(
      "delete_event",
      {
        calendar: "prov/Cal",
        uid: "weekly",
        span: "this",
        occurrence_date: "2026-03-05T10:00:00.000Z",
      },
      mockService as any,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.deleted).toBe(true);

    // Verify updateEvent was called with ICS containing EXDATE
    expect(mockService.updateEvent).toHaveBeenCalledWith(
      "prov/Cal",
      "weekly",
      expect.stringContaining("EXDATE"),
      expect.objectContaining({ url: "/cal/weekly.ics" }),
    );
  });

  it("returns VALIDATION_FAILED when span=this + recurring + no occurrence_date", async () => {
    mockService.getEventWithMeta.mockResolvedValueOnce({
      event: { uid: "weekly", is_recurring: true, all_day: false, occurrence_date: null },
      meta: { url: "/cal/weekly.ics", etag: '"etag-1"' },
    });

    const result = await handleCalendarTool(
      "delete_event",
      { calendar: "prov/Cal", uid: "weekly", span: "this" },
      mockService as any,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("occurrence_date");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: FAIL — handlers still return not_implemented.

- [ ] **Step 6: Implement update_event span="this" handler**

In `calendarTools.ts`, add imports at the top:

```typescript
import { addExdateToIcs, combineIcsComponents, createExceptionVevent, generateEventIcs, parseIcsEvents } from "../ical.js";
```

Replace the `case "update_event"` block (lines 569-612):

```typescript
case "update_event": {
  const span = (args.span as string) ?? "this";
  const occurrenceDate = args.occurrence_date as string | undefined;
  const { event: existing, meta } = await service.getEventWithMeta(
    args.calendar as string,
    args.uid as string,
  );

  if (existing.is_recurring && span === "future") {
    return error("not_implemented", "Recurring event future-instance modification is not yet supported");
  }

  if (existing.is_recurring && span === "this") {
    if (!occurrenceDate) {
      return error("validation_error", "occurrence_date is required when modifying a single occurrence of a recurring event");
    }

    const { data: masterIcs, url, etag } = await service.fetchRawCalendarObject(
      args.calendar as string,
      args.uid as string,
    );

    // Validate occurrence_date matches an RRULE instance or existing RECURRENCE-ID
    const masterEvents = parseIcsEvents(masterIcs);
    const masterEvent = masterEvents.find((e) => e.recurrence_rule);
    if (masterEvent) {
      // Expand a narrow range around the target date to check validity
      const targetDate = new Date(occurrenceDate);
      const dayBefore = new Date(targetDate.getTime() - 86400000).toISOString();
      const dayAfter = new Date(targetDate.getTime() + 86400000).toISOString();
      const expanded = parseIcsEvents(masterIcs, { start: dayBefore, end: dayAfter });
      const existingExceptions = masterEvents.filter((e) => e.occurrence_date);
      const isValidOccurrence = expanded.some((e) => e.start === occurrenceDate) ||
        existingExceptions.some((e) => e.occurrence_date === occurrenceDate);
      if (!isValidOccurrence) {
        return error("validation_error", `occurrence_date ${occurrenceDate} does not match any occurrence of this recurring event`);
      }
    }

    const overrides: Record<string, unknown> = {};
    if (args.title !== undefined) overrides.title = args.title;
    if (args.start !== undefined) overrides.start = args.start;
    if (args.end !== undefined) overrides.end = args.end;
    if (args.all_day !== undefined) overrides.all_day = args.all_day;
    if (args.location !== undefined) overrides.location = args.location;
    if (args.description !== undefined) overrides.description = args.description;
    if (args.attendees !== undefined) overrides.attendees = args.attendees;
    if (args.alarms !== undefined) overrides.alarms = args.alarms;
    if (args.categories !== undefined) overrides.categories = args.categories;

    const exceptionVevent = createExceptionVevent(
      masterIcs,
      occurrenceDate,
      overrides as any,
      existing.all_day,
    );
    const combinedIcs = combineIcsComponents(masterIcs, exceptionVevent);
    await service.updateEvent(
      args.calendar as string,
      args.uid as string,
      combinedIcs,
      { url, etag },
    );

    // Construct response from overrides + existing (don't rely on updateEvent return
    // which would return the master VEVENT, not the exception)
    const occDuration = new Date(existing.end).getTime() - new Date(existing.start).getTime();
    const occEnd = overrides.end ?? new Date(new Date(occurrenceDate).getTime() + occDuration).toISOString();
    const exceptionEvent: Record<string, unknown> = {
      ...existing,
      title: overrides.title ?? existing.title,
      start: overrides.start ?? occurrenceDate,
      end: occEnd,
      all_day: overrides.all_day ?? existing.all_day,
      location: overrides.location ?? existing.location,
      description: overrides.description ?? existing.description,
      attendees: overrides.attendees ?? existing.attendees,
      alarms: overrides.alarms ?? existing.alarms,
      categories: overrides.categories ?? existing.categories,
      occurrence_date: occurrenceDate,
      recurrence_rule: null, // exception is not itself recurring
    };
    return ok({ event: exceptionEvent });
  }

  // span === "all" or non-recurring — existing behavior
  const icsString = generateEventIcs({
    uid: args.uid as string,
    title: (args.title as string) ?? existing.title,
    start: (args.start as string) ?? existing.start,
    end: (args.end as string) ?? existing.end,
    all_day: (args.all_day as boolean) ?? existing.all_day,
    location: (args.location as string) ?? existing.location ?? undefined,
    description: (args.description as string) ?? existing.description ?? undefined,
    attendees:
      (args.attendees as Array<{ email: string; name?: string }> | undefined) ??
      existing.attendees?.map((a: { email: string; name?: string | null }) => ({
        email: a.email,
        name: a.name ?? undefined,
      })),
    alarms:
      (args.alarms as Array<{ type: "relative" | "absolute"; trigger: number | string }> | undefined) ??
      existing.alarms?.map((a: any) => ({ type: a.type, trigger: a.trigger })),
    categories: (args.categories as string[] | undefined) ?? existing.categories,
    timezone: getTimezone(),
  });
  const event = await service.updateEvent(
    args.calendar as string,
    args.uid as string,
    icsString,
    meta,
  );
  return ok({ event });
}
```

- [ ] **Step 7: Implement delete_event span="this" handler**

Replace the `case "delete_event"` block (lines 614-632):

```typescript
case "delete_event": {
  const span = (args.span as string) ?? "all";
  const occurrenceDate = args.occurrence_date as string | undefined;

  if (span === "this") {
    const { event: existing, meta } = await service.getEventWithMeta(
      args.calendar as string,
      args.uid as string,
    );

    if (!existing.is_recurring) {
      // Non-recurring: just delete normally
      await service.deleteEvent(args.calendar as string, args.uid as string, meta);
      return ok({ deleted: true, uid: args.uid });
    }

    if (!occurrenceDate) {
      return error("validation_error", "occurrence_date is required when deleting a single occurrence of a recurring event");
    }

    const { data: masterIcs, url, etag } = await service.fetchRawCalendarObject(
      args.calendar as string,
      args.uid as string,
    );

    // Add EXDATE to exclude this occurrence
    let updatedIcs = addExdateToIcs(masterIcs, occurrenceDate, existing.all_day);

    // Remove any existing exception VEVENT for this date
    const recIdDate = new Date(occurrenceDate);
    const formattedRecId = existing.all_day
      ? recIdDate.toISOString().slice(0, 10).replace(/-/g, "")
      : recIdDate.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const exceptionRegex = new RegExp(
      `BEGIN:VEVENT\\r?\\n(?:(?!BEGIN:VEVENT)[\\s\\S])*?RECURRENCE-ID[^:]*:${formattedRecId}[\\s\\S]*?END:VEVENT\\r?\\n?`,
    );
    updatedIcs = updatedIcs.replace(exceptionRegex, "");

    await service.updateEvent(
      args.calendar as string,
      args.uid as string,
      updatedIcs,
      { url, etag },
    );
    return ok({ deleted: true, uid: args.uid });
  }

  if (span === "future") {
    const { event: existing } = await service.getEventWithMeta(
      args.calendar as string,
      args.uid as string,
    );
    if (existing.is_recurring) {
      return error("not_implemented", "Recurring event future-instance deletion is not yet supported");
    }
  }

  // span === "all" — existing behavior
  await service.deleteEvent(args.calendar as string, args.uid as string);
  return ok({ deleted: true, uid: args.uid });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: PASS

- [ ] **Step 9: Format and commit**

```bash
npm run format
git add packages/cal-mcp/src/tools/calendarTools.ts packages/cal-mcp/src/__tests__/calendarTools.test.ts
git commit -m "feat(cal-mcp): implement span=this for update_event and delete_event on recurring events"
```

---

### Task 7: Fix list_events detail_level="full" occurrence_date preservation

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts:454-459` (list_events full detail fetch)
- Test: `packages/cal-mcp/src/__tests__/calendarTools.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it("list_events detail_level=full preserves occurrence_date from summary", async () => {
  mockService.listEvents.mockResolvedValueOnce([
    {
      uid: "weekly", calendar_id: "prov/Cal", title: "Standup",
      start: "2026-03-05T10:00:00Z", end: "2026-03-05T11:00:00Z",
      all_day: false, location: null, status: null, is_recurring: true,
      occurrence_date: "2026-03-05T10:00:00Z",
    },
  ]);
  mockService.getEvent.mockResolvedValueOnce({
    uid: "weekly", calendar_id: "prov/Cal", title: "Standup",
    start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z",
    all_day: false, is_recurring: true, occurrence_date: null,
    // ... master event with null occurrence_date
  });

  const result = await handleCalendarTool(
    "list_events",
    { start: "2026-03-01", end: "2026-03-31", detail_level: "full" },
    mockService as any,
  );

  const parsed = JSON.parse(result.content[0].text);
  // Should preserve occurrence_date from summary, not master's null
  expect(parsed.events[0].occurrence_date).toBe("2026-03-05T10:00:00Z");
});
```

- [ ] **Step 2: Fix the handler**

In the `list_events` handler (around lines 454-459), update the full-detail fetch to preserve `occurrence_date` and occurrence-specific `start`/`end`:

```typescript
if (detailLevel === "full") {
  const fullEvents = [];
  for (const evt of events) {
    const full = await service.getEvent(evt.calendar_id, evt.uid);
    // Preserve occurrence-specific fields from the summary (expanded occurrence)
    fullEvents.push({
      ...full,
      start: evt.start,
      end: evt.end,
      occurrence_date: evt.occurrence_date,
    });
  }
  return ok({ events: fullEvents });
}
```

Apply the same fix in `get_today_events` (around lines 490-495) and `search_events` (around lines 521-525).

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cal-mcp/src/tools/calendarTools.ts packages/cal-mcp/src/__tests__/calendarTools.test.ts
git commit -m "fix(cal-mcp): preserve occurrence_date in detail_level=full list results"
```

---

### Task 8: Full test suite + build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all cal-mcp tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run full monorepo build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Run full monorepo tests**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: No errors.

- [ ] **Step 5: Final commit if any formatting fixes**

```bash
npm run format && git add -A && git commit -m "chore(cal-mcp): fix formatting"
```

---

## Dependency Order

```
Task 1 (occurrence_date types + parsing) — standalone
Task 2 (addExdateToIcs) — standalone
Task 3 (createExceptionVevent) — depends on Task 1 (uses parseIcsEvents with occurrence_date)
Task 4 (combineIcsComponents) — standalone
Task 5 (fetchRawCalendarObject) — standalone

Tasks 1, 2, 4, 5 can run in parallel.
Task 3 depends on Task 1.

Task 6 (handlers) — depends on all of 1-5
Task 7 (detail_level fix) — depends on Task 1
Task 8 (verification) — depends on all
```

**Parallelizable groups:**
- **Group A:** Tasks 1, 2, 4, 5 — independent infrastructure
- **Group B:** Task 3 — after Task 1
- **Group C:** Tasks 6, 7 — after Group A + B
- **Group D:** Task 8 — after all
