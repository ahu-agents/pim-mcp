# cal-mcp Unified Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate cal-mcp to the unified calendar MCP spec v1.1 agreed with macos-calendar-mcp — rename fields, add tools, change response format. Breaking change release 0.3.0.

**Architecture:** Bottom-up TDD migration in dependency order: types/parsing (ical.ts) → service (CalDavService.ts) → tools (calendarTools.ts) → version bump. Each layer's tests are updated first, then the implementation.

**Tech Stack:** TypeScript, Vitest, tsdav, node-ical, ical-generator, @modelcontextprotocol/sdk

**Reference docs:**
- Design spec: `docs/superpowers/specs/2026-03-11-cal-mcp-unified-schema-migration-design.md`
- Unified spec: `docs/specs/unified-calendar-mcp-spec-v1.md`

---

## Chunk 1: Types & Parsing Layer

### Task 1: Update ParsedEvent and EventCreateProps types + tests (ical.ts)

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:4-27`
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts`

- [ ] **Step 1: Update test assertions for new field names**

In `packages/cal-mcp/src/__tests__/ical.test.ts`, update the parse test to assert new field names:

```typescript
it("parses a single VEVENT from iCalendar string", () => {
  const events = parseIcsEvents(SAMPLE_ICS);
  expect(events).toHaveLength(1);
  expect(events[0].uid).toBe("evt-1@example.com");
  expect(events[0].title).toBe("Team Meeting");          // was summary
  expect(events[0].location).toBe("Office Room A");
  expect(events[0].description).toBe("Weekly standup");
  expect(events[0].status).toBe("confirmed");            // lowercase
  expect(events[0].availability).toBe("busy");            // was transparency/OPAQUE
  expect(events[0].all_day).toBe(false);                  // NEW
  expect(events[0].start).toContain("2026-03-10");
  expect(events[0].end).toContain("2026-03-10");
});
```

Update the multi-event test:

```typescript
it("parses multiple VEVENTs from iCalendar string", () => {
  const events = parseIcsEvents(MULTI_EVENT_ICS);
  expect(events).toHaveLength(2);
  expect(events.map((e) => e.title).sort()).toEqual(["Afternoon Meeting", "Morning Meeting"]);
});
```

Add an all-day event test:

```typescript
const ALL_DAY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-1@example.com
DTSTART;VALUE=DATE:20260310
DTEND;VALUE=DATE:20260311
SUMMARY:Company Holiday
END:VEVENT
END:VCALENDAR`;

it("detects all-day events", () => {
  const events = parseIcsEvents(ALL_DAY_ICS);
  expect(events).toHaveLength(1);
  expect(events[0].all_day).toBe(true);
  expect(events[0].title).toBe("Company Holiday");
});
```

Add a nullable fields test:

```typescript
it("returns null for absent nullable fields", () => {
  const MINIMAL_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:min-1@example.com
DTSTART:20260310T140000Z
DTEND:20260310T150000Z
SUMMARY:Minimal
END:VEVENT
END:VCALENDAR`;
  const events = parseIcsEvents(MINIMAL_ICS);
  expect(events[0].location).toBeNull();
  expect(events[0].description).toBeNull();
  expect(events[0].status).toBeNull();
  expect(events[0].availability).toBeNull();
  expect(events[0].organizer).toBeNull();
  expect(events[0].attendees).toEqual([]);
  expect(events[0].recurrence_rule).toBeNull();
  expect(events[0].created).toBeNull();
  expect(events[0].last_modified).toBeNull();
  expect(events[0].url).toBeNull();
});
```

- [ ] **Step 2: Update generateEventIcs tests for `title`**

```typescript
describe("generateEventIcs", () => {
  it("generates valid iCalendar string with required fields", () => {
    const ics = generateEventIcs({
      title: "Test Event",             // was summary
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("Test Event");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("includes optional fields when provided", () => {
    const ics = generateEventIcs({
      title: "Lunch",                  // was summary
      start: "2026-03-10T12:00:00Z",
      end: "2026-03-10T13:00:00Z",
      location: "Cafe",
      description: "Team lunch",
    });
    expect(ics).toContain("Cafe");
    expect(ics).toContain("Team lunch");
  });

  it("includes attendees when provided", () => {
    const ics = generateEventIcs({
      title: "Meeting",                // was summary
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
      attendees: [{ email: "bob@example.com", name: "Bob" }],
    });
    expect(ics).toContain("bob@example.com");
  });

  it("generates all-day event when all_day is true", () => {
    const ics = generateEventIcs({
      title: "Day Off",
      start: "2026-03-10",
      end: "2026-03-11",
      all_day: true,
    });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("Day Off");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: FAIL — `title` not a property on ParsedEvent, `availability` doesn't exist, etc.

- [ ] **Step 4: Update ParsedEvent interface in ical.ts**

Replace the `ParsedEvent` interface (lines 4-18) in `packages/cal-mcp/src/ical.ts`:

```typescript
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
  attendees: Array<{ name: string | null; email: string; status: string | null; role: string | null }>;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  is_recurring: boolean;
}
```

- [ ] **Step 5: Update EventCreateProps interface**

Replace `EventCreateProps` (lines 20-27) in `packages/cal-mcp/src/ical.ts`:

```typescript
export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
}
```

- [ ] **Step 6: Update parseIcsEvents implementation**

Replace the `events.push({...})` block (lines 65-79) in `packages/cal-mcp/src/ical.ts`:

```typescript
    // Map transparency to availability
    const rawTransparency = vevent.transparency?.toUpperCase();
    let availability: string | null = null;
    if (rawTransparency === "OPAQUE") availability = "busy";
    else if (rawTransparency === "TRANSPARENT") availability = "free";

    // Detect all-day: node-ical sets datetype to "date" for VALUE=DATE
    const allDay = (vevent as any).datetype === "date";

    events.push({
      uid: vevent.uid || "",
      title: vevent.summary || "",
      start: vevent.start ? new Date(vevent.start).toISOString() : "",
      end: vevent.end ? new Date(vevent.end).toISOString() : "",
      all_day: allDay,
      location: vevent.location ?? null,
      description: vevent.description ?? null,
      status: vevent.status ? vevent.status.toLowerCase() : null,
      availability,
      url: (vevent as any).url ?? null,
      attendees: attendees.length > 0 ? attendees : [],
      organizer: organizer ?? null,
      recurrence_rule: vevent.rrule?.toString() ?? null,
      created: vevent.created ? new Date(vevent.created).toISOString() : null,
      last_modified: vevent.lastmodified ? new Date(vevent.lastmodified).toISOString() : null,
      is_recurring: !!vevent.rrule,
    });
```

Also update the attendee mapping (lines 39-53) to use `| null` types:

```typescript
    const attendees: Array<{
      name: string | null;
      email: string;
      status: string | null;
      role: string | null;
    }> = [];
    if (vevent.attendee) {
      const attendeeList = Array.isArray(vevent.attendee) ? vevent.attendee : [vevent.attendee];
      for (const att of attendeeList) {
        const email =
          typeof att === "string"
            ? att.replace("mailto:", "")
            : (att.val || "").replace("mailto:", "");
        const name = typeof att === "string" ? null : (att.params?.CN ?? null);
        attendees.push({ email, name, status: null, role: null });
      }
    }
```

Update the organizer mapping (lines 56-63):

```typescript
    let organizer: { name: string | null; email: string } | null = null;
    if (vevent.organizer) {
      const org = vevent.organizer;
      organizer = {
        email: (typeof org === "string" ? org : org.val || "").replace("mailto:", ""),
        name: typeof org === "string" ? null : (org.params?.CN ?? null),
      };
    }
```

- [ ] **Step 7: Update generateEventIcs implementation**

Replace `generateEventIcs` (lines 85-105) in `packages/cal-mcp/src/ical.ts`:

```typescript
export function generateEventIcs(props: EventCreateProps): string {
  const calendar = ical({ name: "cal-mcp" });

  const eventOptions: Parameters<typeof calendar.createEvent>[0] = {
    start: new Date(props.start),
    end: new Date(props.end),
    summary: props.title,
  };
  if (props.all_day) eventOptions.allDay = true;
  if (props.location) eventOptions.location = props.location;
  if (props.description) eventOptions.description = props.description;

  const event = calendar.createEvent(eventOptions);

  if (props.attendees) {
    for (const att of props.attendees) {
      event.createAttendee({ email: att.email, name: att.name });
    }
  }

  return calendar.toString();
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "refactor(cal-mcp): rename ParsedEvent fields to unified spec (title, availability, snake_case)"
```

---

## Chunk 2: Service Layer

### Task 2: Update CalDavService types, tests, and implementation

> **Note:** Type interfaces and method implementations are updated together in a single task to avoid a broken intermediate commit. Do NOT commit types separately.

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts` (types + method implementations)
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Update type interfaces in CalDavService.ts**

Replace lines 11-50 in `packages/cal-mcp/src/services/CalDavService.ts` with the new interfaces. See design spec for exact types — key changes: `calendarId` → `calendar_id`, `displayName` → `display_name`, `summary` → `title`, add `all_day`, `color`, `source`, `read_only`, `availability`, `url`, `recurrence_rule`, `last_modified`, `excludeCalendars`, `includeAllDayAsBusy`. Use `| null` not `?` on EventFull response fields.

```typescript
export interface CalendarInfo {
  calendar_id: string;
  display_name: string;
  color: string | null;
  source: string;
  read_only: boolean;
  url: string;
  ctag?: string;
}

export interface EventSummary {
  uid: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  status: string | null;
  is_recurring: boolean;
}

export interface EventFull extends EventSummary {
  description: string | null;
  url: string | null;
  availability: string | null;
  attendees: Array<{ name: string | null; email: string; status: string | null; role: string | null }>;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
}

export interface FreeSlot {
  start: string;
  end: string;
  duration: number;
}

export interface FindFreeSlotsOptions {
  ignoreTentative?: boolean;
  preferredStart?: string;
  preferredEnd?: string;
  excludeCalendars?: string[];
  includeAllDayAsBusy?: boolean;
}
```

- [ ] **Step 2: Update listCalendars test assertions**

In `packages/cal-mcp/src/__tests__/CalDavService.test.ts`, update the `listCalendars` describe block:

```typescript
  describe("listCalendars", () => {
    it("fetches calendars from all providers and returns provider-prefixed IDs", async () => {
      const calendars = await service.listCalendars();
      expect(calendars).toHaveLength(4);

      const mailboxCals = calendars.filter((c) => c.calendar_id.startsWith("mailbox/"));
      expect(mailboxCals).toHaveLength(2);
      expect(mailboxCals[0].calendar_id).toBe("mailbox/Work");
      expect(mailboxCals[0].display_name).toBe("Work");
      expect(mailboxCals[0].source).toBe("mailbox");
      expect(mailboxCals[0].color).toBeNull();
      expect(mailboxCals[0].read_only).toBe(false);

      const ncCals = calendars.filter((c) => c.calendar_id.startsWith("nextcloud/"));
      expect(ncCals).toHaveLength(2);
    });

    // keep the DAVClient config test unchanged
  });
```

- [ ] **Step 2: Update listEvents test assertions**

```typescript
  describe("listEvents", () => {
    it("fetches events with time range and returns EventSummary array", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");
      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "evt-1",
          title: "Team Meeting",
          start: "2026-03-10T14:00:00.000Z",
          end: "2026-03-10T15:00:00.000Z",
          all_day: false,
          location: "Office",
          status: "confirmed",
          recurrence_rule: null,
          is_recurring: false,
        },
      ]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "BEGIN:VCALENDAR...END:VCALENDAR", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      const events = await service.listEvents(
        "mailbox/Work",
        "2026-03-10T00:00:00Z",
        "2026-03-10T23:59:59Z",
      );

      expect(events).toHaveLength(1);
      expect(events[0].uid).toBe("evt-1");
      expect(events[0].calendar_id).toBe("mailbox/Work");
      expect(events[0].title).toBe("Team Meeting");
      expect(events[0].is_recurring).toBe(false);
      expect(events[0].all_day).toBe(false);
      expect(events[0].location).toBe("Office");
    });

    // keep the unknown provider test unchanged
  });
```

- [ ] **Step 3: Update getEvent test assertions**

```typescript
  describe("getEvent", () => {
    it("fetches a single event by UID and returns full details", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");
      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "evt-1",
          title: "Team Meeting",
          start: "2026-03-10T14:00:00.000Z",
          end: "2026-03-10T15:00:00.000Z",
          all_day: false,
          location: "Office",
          description: "Weekly standup",
          status: "confirmed",
          availability: "busy",
          url: null,
          attendees: [{ email: "bob@example.com", name: "Bob", status: null, role: null }],
          organizer: { email: "miguel@example.com", name: "Miguel" },
          recurrence_rule: null,
          is_recurring: false,
          created: null,
          last_modified: null,
        },
      ]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "BEGIN:VCALENDAR...END:VCALENDAR", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      const event = await service.getEvent("mailbox/Work", "evt-1");

      expect(event.uid).toBe("evt-1");
      expect(event.calendar_id).toBe("mailbox/Work");
      expect(event.title).toBe("Team Meeting");
      expect(event.description).toBe("Weekly standup");
      expect(event.availability).toBe("busy");
      expect(event.attendees).toHaveLength(1);
      expect(event.organizer?.email).toBe("miguel@example.com");
      expect(event.recurrence_rule).toBeNull();
      expect(event.url).toBeNull();
    });

    // keep the event-not-found test unchanged
  });
```

- [ ] **Step 4: Update findFreeSlots test data to use new field names**

Update all `parseIcsEvents` mock return values in the `findFreeSlots` describe block to use new field names (`title` instead of `summary`, `availability` instead of `transparency`). The mock data should use:
- `availability: "busy"` instead of `transparency: "OPAQUE"`
- `availability: "free"` instead of `transparency: "TRANSPARENT"`
- `status: "tentative"` instead of `status: "TENTATIVE"` (lowercase)
- Add `all_day: false` to all existing mock events

Add new tests for `excludeCalendars` and `includeAllDayAsBusy`:

```typescript
    it("excludes events from excluded calendars", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "Blocked",
          start: "2026-03-10T09:00:00.000Z",
          end: "2026-03-10T17:00:00.000Z",
          all_day: false,
          status: "confirmed",
          availability: "busy",
          calendar_id: "mailbox/Work",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
        { excludeCalendars: ["mailbox/Work"] },
      );

      // Excluded calendar — entire range is free
      expect(slots).toHaveLength(1);
      expect(slots[0].duration).toBe(540);
    });

    it("skips all-day events by default", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "Holiday",
          start: "2026-03-10T00:00:00.000Z",
          end: "2026-03-11T00:00:00.000Z",
          all_day: true,
          status: "confirmed",
          availability: "busy",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
      );

      // All-day events skipped by default — entire range free
      expect(slots).toHaveLength(1);
      expect(slots[0].duration).toBe(540);
    });

    it("blocks all-day events when includeAllDayAsBusy is true", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "Holiday",
          start: "2026-03-10T00:00:00.000Z",
          end: "2026-03-11T00:00:00.000Z",
          all_day: true,
          status: "confirmed",
          availability: "busy",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
        { includeAllDayAsBusy: true },
      );

      // All-day blocks entire range — no free slots
      expect(slots).toHaveLength(0);
    });
```

- [ ] **Step 5: Add test for createEvent returning EventFull**

```typescript
  describe("createEvent", () => {
    it("creates a calendar object and returns the created event", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      // First call: createCalendarObject succeeds
      __mockClient.createCalendarObject.mockResolvedValue({ ok: true });

      // Second call: getEvent fetches the created event back
      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "new-evt",
          title: "New Event",
          start: "2026-03-10T14:00:00.000Z",
          end: "2026-03-10T15:00:00.000Z",
          all_day: false,
          location: null,
          description: null,
          status: null,
          availability: null,
          url: null,
          attendees: [],
          organizer: null,
          recurrence_rule: null,
          is_recurring: false,
          created: null,
          last_modified: null,
        },
      ]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "...", url: "/cal/new-evt.ics", etag: '"e1"' },
      ]);

      const result = await service.createEvent("mailbox/Work", "BEGIN:VCALENDAR\nEND:VCALENDAR", "new-evt");

      expect(result.uid).toBe("new-evt");
      expect(result.title).toBe("New Event");
      expect(__mockClient.createCalendarObject).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 6: Add test for updateEvent returning EventFull**

```typescript
  describe("updateEvent", () => {
    it("updates an existing calendar object and returns the updated event", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      // findCalendarObject call
      (parseIcsEvents as any).mockReturnValueOnce([{ uid: "evt-1" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValueOnce([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      __mockClient.updateCalendarObject.mockResolvedValue({ ok: true });

      // getEvent fetch-after-write
      (parseIcsEvents as any).mockReturnValueOnce([
        {
          uid: "evt-1",
          title: "Updated Meeting",
          start: "2026-03-10T14:00:00.000Z",
          end: "2026-03-10T15:00:00.000Z",
          all_day: false,
          location: null,
          description: null,
          status: null,
          availability: null,
          url: null,
          attendees: [],
          organizer: null,
          recurrence_rule: null,
          is_recurring: false,
          created: null,
          last_modified: null,
        },
      ]);
      __mockClient.fetchCalendarObjects.mockResolvedValueOnce([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e2"' },
      ]);

      const result = await service.updateEvent("mailbox/Work", "evt-1", "BEGIN:VCALENDAR\nUPDATED\nEND:VCALENDAR");

      expect(result.uid).toBe("evt-1");
      expect(result.title).toBe("Updated Meeting");
      expect(__mockClient.updateCalendarObject).toHaveBeenCalled();
    });

    // keep the event-not-found test unchanged
  });
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: FAIL — implementation still uses old field names.

- [ ] **Step 8: Update listCalendars implementation**

In `packages/cal-mcp/src/services/CalDavService.ts`, update `listCalendars()` (lines 125-149):

```typescript
  async listCalendars(): Promise<CalendarInfo[]> {
    const allCalendars: CalendarInfo[] = [];

    for (const [providerId, account] of this.accounts) {
      const client = this.createClient(account);
      try {
        await client.login();
        const calendars = await client.fetchCalendars();
        for (const cal of calendars) {
          const displayName = (typeof cal.displayName === "string" ? cal.displayName : "") || "";
          allCalendars.push({
            calendar_id: `${providerId}/${displayName}`,
            display_name: displayName,
            color: (cal as any).calendarColor ?? null,
            source: providerId,
            read_only: false,
            url: cal.url,
            ctag: cal.ctag,
          });
        }
      } catch (error) {
        throw toPimError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return allCalendars;
  }
```

- [ ] **Step 9: Update listEvents implementation**

Update `listEvents()` (lines 151-188) — change the mapping:

```typescript
          summaries.push({
            uid: event.uid,
            calendar_id: calendarId,
            title: event.title,
            start: event.start,
            end: event.end,
            all_day: event.all_day,
            location: event.location,
            status: event.status,
            is_recurring: event.is_recurring,
          });
```

- [ ] **Step 10: Update getEvent implementation**

Update `getEvent()` (lines 190-225) — change the mapping:

```typescript
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
      };
```

- [ ] **Step 11: Update createEvent to return EventFull (fetch-after-write)**

Change `createEvent` signature and implementation:

```typescript
  async createEvent(calendarId: string, icalString: string, uid: string): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);
    const client = this.createClient(account);

    try {
      await client.login();
      const calendar = await this.findCalendar(client, calendarName, account.id);
      await client.createCalendarObject({
        calendar,
        iCalString: icalString,
        filename: `${crypto.randomUUID()}.ics`,
      });
      // Fetch-after-write to return the created event
      return await this.getEvent(calendarId, uid);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 12: Update updateEvent to return EventFull (fetch-after-write)**

Change `updateEvent` signature and implementation:

```typescript
  async updateEvent(calendarId: string, uid: string, icalString: string): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);
    const client = this.createClient(account);

    try {
      await client.login();
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const obj = await this.findCalendarObject(client, calendar, uid);
      await client.updateCalendarObject({
        calendarObject: {
          url: obj.url,
          etag: obj.etag,
          data: icalString,
        },
      });
      // Fetch-after-write to return the updated event
      return await this.getEvent(calendarId, uid);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 13: Update findFreeSlots to use new field names and add filtering**

Update the event collection in `findFreeSlots()` to include `all_day` and `calendar_id`:

```typescript
    const allEvents: Array<{
      start: string;
      end: string;
      status: string | null;
      availability: string | null;
      all_day: boolean;
      calendar_id: string;
    }> = [];

    for (const calendarId of calendarIds) {
      // Skip excluded calendars
      if (options.excludeCalendars?.includes(calendarId)) continue;

      try {
        const { account, calendarName } = this.resolveAccount(calendarId);
        const client = this.createClient(account);
        await client.login();
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const objects = await client.fetchCalendarObjects({
          calendar,
          timeRange: { start, end },
          expand: true,
        });

        for (const obj of objects) {
          if (!obj.data) continue;
          const parsed = parseIcsEvents(obj.data);
          for (const event of parsed) {
            allEvents.push({
              start: event.start,
              end: event.end,
              status: event.status,
              availability: event.availability,
              all_day: event.all_day,
              calendar_id: calendarId,
            });
          }
        }
      } catch (error) {
        if (error instanceof CalendarError) throw error;
        throw toPimError(error instanceof Error ? error : new Error(String(error)));
      }
    }
```

Update the filter logic:

```typescript
    const busyIntervals = allEvents.filter((e) => {
      // Skip all-day events unless includeAllDayAsBusy
      if (e.all_day && !options.includeAllDayAsBusy) return false;
      // Skip free events
      if (e.availability === "free") return false;
      // Skip tentative when ignoreTentative
      if (options.ignoreTentative && e.status === "tentative") return false;
      // Everything else blocks
      return true;
    });
```

- [ ] **Step 14: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "refactor(cal-mcp): update CalDavService to unified spec fields and response types"
```

---

## Chunk 3: Tool Layer

### Task 4: Update tool schemas, response format, and existing tool handlers

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts`
- Modify: `packages/cal-mcp/src/__tests__/calendarTools.test.ts`

- [ ] **Step 1: Update calendarTools tests for new response format and field names**

Replace the entire test file `packages/cal-mcp/src/__tests__/calendarTools.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_TOOLS, handleCalendarTool } from "../tools/calendarTools.js";

const mockService = {
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  findFreeSlots: vi.fn(),
};

describe("calendarTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports 11 tool definitions", () => {
    expect(CALENDAR_TOOLS).toHaveLength(11);
    const names = CALENDAR_TOOLS.map((t) => t.name);
    expect(names).toContain("list_calendars");
    expect(names).toContain("list_events");
    expect(names).toContain("get_today_events");
    expect(names).toContain("search_events");
    expect(names).toContain("get_event");
    expect(names).toContain("create_event");
    expect(names).toContain("update_event");
    expect(names).toContain("delete_event");
    expect(names).toContain("create_events_batch");
    expect(names).toContain("import_ics");
    expect(names).toContain("find_free_slots");
  });

  it("create_event schema uses title not summary", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "create_event")!;
    const props = (tool.inputSchema as any).properties;
    expect(props.title).toBeDefined();
    expect(props.summary).toBeUndefined();
    expect(props.all_day).toBeDefined();
    expect((tool.inputSchema as any).required).toContain("title");
  });

  it("import_ics schema uses ics_content not icsContent", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "import_ics")!;
    const props = (tool.inputSchema as any).properties;
    expect(props.ics_content).toBeDefined();
    expect(props.icsContent).toBeUndefined();
  });

  it("find_free_slots schema has new params", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "find_free_slots")!;
    const props = (tool.inputSchema as any).properties;
    expect(props.preferred_start).toBeDefined();
    expect(props.preferred_end).toBeDefined();
    expect(props.exclude_calendars).toBeDefined();
    expect(props.include_all_day_as_busy).toBeDefined();
    expect(props.ignore_tentative).toBeDefined();
    // calendars is optional
    expect((tool.inputSchema as any).required).not.toContain("calendars");
  });

  it("list_events schema has detail_level and optional calendar", () => {
    const tool = CALENDAR_TOOLS.find((t) => t.name === "list_events")!;
    const props = (tool.inputSchema as any).properties;
    expect(props.detail_level).toBeDefined();
    expect((tool.inputSchema as any).required).toEqual(["start", "end"]);
  });

  describe("handleCalendarTool", () => {
    it("list_calendars wraps in { calendars } envelope", async () => {
      mockService.listCalendars.mockResolvedValue([
        { calendar_id: "mailbox/Work", display_name: "Work", color: null, source: "mailbox", read_only: false },
      ]);

      const result = await handleCalendarTool("list_calendars", {}, mockService as any);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.calendars).toHaveLength(1);
      expect(parsed.calendars[0].calendar_id).toBe("mailbox/Work");
    });

    it("list_events wraps in { events } envelope", async () => {
      mockService.listEvents.mockResolvedValue([
        { uid: "evt-1", calendar_id: "mailbox/Work", title: "Meeting" },
      ]);

      const result = await handleCalendarTool(
        "list_events",
        { calendar: "mailbox/Work", start: "2026-03-10T00:00:00Z", end: "2026-03-10T23:59:59Z" },
        mockService as any,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].title).toBe("Meeting");
    });

    it("get_event wraps in { event } envelope", async () => {
      mockService.getEvent.mockResolvedValue({ uid: "evt-1", title: "Meeting" });

      const result = await handleCalendarTool(
        "get_event",
        { calendar: "mailbox/Work", uid: "evt-1" },
        mockService as any,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.event.uid).toBe("evt-1");
    });

    it("create_event uses title param and wraps in { event } envelope", async () => {
      mockService.createEvent.mockResolvedValue({ uid: "new-1", title: "New Event" });

      const result = await handleCalendarTool(
        "create_event",
        { calendar: "mailbox/Work", title: "New Event", start: "2026-03-10T14:00:00Z", end: "2026-03-10T15:00:00Z" },
        mockService as any,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.event.uid).toBe("new-1");
    });

    it("delete_event returns { deleted, uid } envelope", async () => {
      mockService.deleteEvent.mockResolvedValue(undefined);

      const result = await handleCalendarTool(
        "delete_event",
        { calendar: "mailbox/Work", uid: "evt-1" },
        mockService as any,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.deleted).toBe(true);
      expect(parsed.uid).toBe("evt-1");
    });

    it("returns structured error for unknown tool", async () => {
      const result = await handleCalendarTool("unknown_tool", {}, mockService as any);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeDefined();
      expect(parsed.message).toBeDefined();
    });

    it("returns structured error with error code on service failure", async () => {
      mockService.listCalendars.mockRejectedValue(new Error("Connection failed"));

      const result = await handleCalendarTool("list_calendars", {}, mockService as any);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("backend_error");
      expect(parsed.message).toContain("Connection failed");
    });

    it("update_event returns not_implemented for span this on recurring event", async () => {
      mockService.getEvent.mockResolvedValue({
        uid: "evt-1", title: "Weekly", is_recurring: true,
        recurrence_rule: "FREQ=WEEKLY",
      });

      const result = await handleCalendarTool(
        "update_event",
        { calendar: "mailbox/Work", uid: "evt-1", title: "Changed", span: "this" },
        mockService as any,
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("not_implemented");
    });

    it("update_event succeeds with span this on non-recurring event", async () => {
      mockService.getEvent.mockResolvedValue({
        uid: "evt-1", title: "Meeting", is_recurring: false, recurrence_rule: null,
      });
      mockService.updateEvent.mockResolvedValue({
        uid: "evt-1", title: "Updated Meeting", is_recurring: false,
      });

      const result = await handleCalendarTool(
        "update_event",
        { calendar: "mailbox/Work", uid: "evt-1", title: "Updated Meeting" },
        mockService as any,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.event.title).toBe("Updated Meeting");
    });

    it("find_free_slots wraps in { slots, count } envelope", async () => {
      mockService.listCalendars.mockResolvedValue([
        { calendar_id: "mailbox/Work" },
      ]);
      mockService.findFreeSlots.mockResolvedValue([
        { start: "2026-03-10T10:00:00Z", end: "2026-03-10T12:00:00Z", duration: 120 },
      ]);

      const result = await handleCalendarTool(
        "find_free_slots",
        { start: "2026-03-10T08:00:00Z", end: "2026-03-10T17:00:00Z", duration: 30 },
        mockService as any,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.slots).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: FAIL — tool count is 9 not 11, old field names, no envelopes.

- [ ] **Step 3: Update CALENDAR_TOOLS array with new schemas**

Replace the entire `CALENDAR_TOOLS` array in `packages/cal-mcp/src/tools/calendarTools.ts`. This is the full replacement — all 11 tools with updated schemas. The tool definitions are long so the implementing agent should read the unified spec (`docs/specs/unified-calendar-mcp-spec-v1.md`) and the design spec for exact param names, types, required flags, and descriptions. Key changes:
- `create_event`: `summary` → `title`, add `all_day`
- `update_event`: `summary` → `title`, add `all_day`, add `span`
- `delete_event`: add `span`
- `create_events_batch`: `summary` → `title` in items
- `import_ics`: `icsContent` → `ics_content`
- `list_events`: add `detail_level`, make `calendar` optional (required = `["start", "end"]`)
- `find_free_slots`: make `calendars` optional, add `exclude_calendars`, `include_all_day_as_busy`, `ignore_tentative`, rename `preferredStart`/`preferredEnd` → `preferred_start`/`preferred_end`
- NEW: `get_today_events` with `calendar?`, `detail_level?`
- NEW: `search_events` with `query`, `calendar?`, `start?`, `end?`, `detail_level?`

- [ ] **Step 4: Update ok() and error() helpers**

Replace the helpers at the bottom of `calendarTools.ts`:

```typescript
function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function error(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}
```

- [ ] **Step 5: Update handleCalendarTool switch cases**

Replace the entire `handleCalendarTool` function body. Key changes per case:

**list_calendars:**
```typescript
case "list_calendars": {
  const calendars = await service.listCalendars();
  return ok({ calendars });
}
```

**list_events** (with optional calendar and detail_level):
```typescript
case "list_events": {
  const calendar = args.calendar as string | undefined;
  const detailLevel = (args.detail_level as string) ?? "summary";

  let events;
  if (calendar) {
    events = await service.listEvents(calendar, args.start as string, args.end as string);
  } else {
    const calendars = await service.listCalendars();
    events = [];
    for (const cal of calendars) {
      const calEvents = await service.listEvents(cal.calendar_id, args.start as string, args.end as string);
      events.push(...calEvents);
    }
  }

  if (detailLevel === "full") {
    const fullEvents = [];
    for (const evt of events) {
      fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
    }
    return ok({ events: fullEvents });
  }
  return ok({ events });
}
```

**get_today_events:**
```typescript
case "get_today_events": {
  const calendar = args.calendar as string | undefined;
  const detailLevel = (args.detail_level as string) ?? "summary";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  let events;
  if (calendar) {
    events = await service.listEvents(calendar, todayStart, todayEnd);
  } else {
    const calendars = await service.listCalendars();
    events = [];
    for (const cal of calendars) {
      const calEvents = await service.listEvents(cal.calendar_id, todayStart, todayEnd);
      events.push(...calEvents);
    }
  }

  if (detailLevel === "full") {
    const fullEvents = [];
    for (const evt of events) {
      fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
    }
    return ok({ events: fullEvents });
  }
  return ok({ events });
}
```

**search_events:**
```typescript
case "search_events": {
  const query = (args.query as string).toLowerCase();
  const calendar = args.calendar as string | undefined;
  const detailLevel = (args.detail_level as string) ?? "summary";
  const now = new Date();
  const start = (args.start as string) ?? new Date(now.getTime() - 90 * 86400000).toISOString();
  const end = (args.end as string) ?? new Date(now.getTime() + 90 * 86400000).toISOString();

  let summaryEvents;
  if (calendar) {
    summaryEvents = await service.listEvents(calendar, start, end);
  } else {
    const calendars = await service.listCalendars();
    summaryEvents = [];
    for (const cal of calendars) {
      const calEvents = await service.listEvents(cal.calendar_id, start, end);
      summaryEvents.push(...calEvents);
    }
  }

  if (detailLevel === "full") {
    // Fetch full details for ALL events, then filter against title+location+description
    const fullEvents = [];
    for (const evt of summaryEvents) {
      fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
    }
    const matched = fullEvents.filter((e) => {
      const title = e.title?.toLowerCase() ?? "";
      const location = e.location?.toLowerCase() ?? "";
      const description = e.description?.toLowerCase() ?? "";
      return title.includes(query) || location.includes(query) || description.includes(query);
    });
    return ok({ events: matched });
  }

  // Summary level: filter by title and location only (description not available)
  const matched = summaryEvents.filter((e) => {
    const title = e.title?.toLowerCase() ?? "";
    const location = e.location?.toLowerCase() ?? "";
    return title.includes(query) || location.includes(query);
  });
  return ok({ events: matched });
}
```

**get_event:**
```typescript
case "get_event": {
  const event = await service.getEvent(args.calendar as string, args.uid as string);
  return ok({ event });
}
```

**create_event** (uses `title`, extracts UID from generated ICS):
```typescript
case "create_event": {
  const icsString = generateEventIcs({
    title: args.title as string,
    start: args.start as string,
    end: args.end as string,
    all_day: (args.all_day as boolean) ?? false,
    location: args.location as string | undefined,
    description: args.description as string | undefined,
    attendees: args.attendees as Array<{ email: string; name?: string }> | undefined,
  });
  // Extract UID from generated ICS
  const uidMatch = icsString.match(/UID:(.+)/);
  const uid = uidMatch ? uidMatch[1].trim() : crypto.randomUUID();
  const event = await service.createEvent(args.calendar as string, icsString, uid);
  return ok({ event });
}
```

**update_event** (with span):
```typescript
case "update_event": {
  const span = (args.span as string) ?? "this";
  const existing = await service.getEvent(args.calendar as string, args.uid as string);

  // Check span on recurring events
  if (existing.is_recurring && (span === "this" || span === "future")) {
    return error("not_implemented", "Recurring event instance modification is not yet supported");
  }

  const icsString = generateEventIcs({
    title: (args.title as string) ?? existing.title,
    start: (args.start as string) ?? existing.start,
    end: (args.end as string) ?? existing.end,
    all_day: (args.all_day as boolean) ?? existing.all_day,
    location: (args.location as string) ?? existing.location ?? undefined,
    description: (args.description as string) ?? existing.description ?? undefined,
    attendees:
      (args.attendees as Array<{ email: string; name?: string }> | undefined) ??
      existing.attendees?.map((a) => ({ email: a.email, name: a.name ?? undefined })),
  });
  const event = await service.updateEvent(args.calendar as string, args.uid as string, icsString);
  return ok({ event });
}
```

**delete_event** (with span):
```typescript
case "delete_event": {
  const span = (args.span as string) ?? "all";
  if (span === "this" || span === "future") {
    // Check if event is recurring
    const existing = await service.getEvent(args.calendar as string, args.uid as string);
    if (existing.is_recurring) {
      return error("not_implemented", "Recurring event instance deletion is not yet supported");
    }
  }
  await service.deleteEvent(args.calendar as string, args.uid as string);
  return ok({ deleted: true, uid: args.uid });
}
```

**create_events_batch** (uses `title`):
```typescript
case "create_events_batch": {
  const eventInputs = args.events as Array<{
    title: string;
    start: string;
    end: string;
    all_day?: boolean;
    location?: string;
    description?: string;
    attendees?: Array<{ email: string; name?: string }>;
  }>;
  const createdEvents = [];
  for (const input of eventInputs) {
    const icsString = generateEventIcs(input);
    const uidMatch = icsString.match(/UID:(.+)/);
    const uid = uidMatch ? uidMatch[1].trim() : crypto.randomUUID();
    const event = await service.createEvent(args.calendar as string, icsString, uid);
    createdEvents.push(event);
  }
  return ok({ created: createdEvents.length, events: createdEvents });
}
```

**import_ics** (uses `ics_content`, uploads original ICS to preserve fidelity):
```typescript
case "import_ics": {
  const icsContent = args.ics_content as string;
  const parsed = parseIcsEvents(icsContent);
  if (parsed.length === 0) {
    return error("validation_error", "No events found in ICS content");
  }
  // Upload the original ICS content as-is to preserve all fields (attendees, rrules, etc.)
  await service.createEvent(args.calendar as string, icsContent, parsed[0].uid);
  // Fetch back each event for the response envelope
  const importedEvents = [];
  for (const evt of parsed) {
    try {
      const event = await service.getEvent(args.calendar as string, evt.uid);
      importedEvents.push(event);
    } catch {
      // Event may not be fetchable individually if multi-event ICS — skip
    }
  }
  return ok({ imported: parsed.length, events: importedEvents });
}
```

**find_free_slots** (optional calendars, new params):
```typescript
case "find_free_slots": {
  let calendarIds = args.calendars as string[] | undefined;
  if (!calendarIds || calendarIds.length === 0) {
    const allCals = await service.listCalendars();
    calendarIds = allCals.map((c) => c.calendar_id);
  }
  const slots = await service.findFreeSlots(
    calendarIds,
    args.start as string,
    args.end as string,
    args.duration as number,
    {
      preferredStart: args.preferred_start as string | undefined,
      preferredEnd: args.preferred_end as string | undefined,
      ignoreTentative: (args.ignore_tentative as boolean) ?? false,
      excludeCalendars: args.exclude_calendars as string[] | undefined,
      includeAllDayAsBusy: (args.include_all_day_as_busy as boolean) ?? false,
    },
  );
  return ok({ slots, count: slots.length });
}
```

**default + error handler:**
```typescript
      default:
        return error("validation_error", `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const calErr = err as any;
      if (calErr.code === "CALENDAR_NOT_FOUND" || calErr.code === "EVENT_NOT_FOUND") {
        return error("not_found", calErr.message);
      }
    }
    const pimError = toPimError(err instanceof Error ? err : new Error(String(err)));
    return error("backend_error", pimError.message);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/calendarTools.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/cal-mcp/src/tools/calendarTools.ts packages/cal-mcp/src/__tests__/calendarTools.test.ts
git commit -m "refactor(cal-mcp): update tool schemas, response envelopes, and error format to unified spec"
```

---

## Chunk 4: Version Bump & Final Verification

### Task 5: Version bump, cal-mcp-tools.json update, and final checks

**Files:**
- Modify: `packages/cal-mcp/package.json`
- Modify: `packages/cal-mcp/src/main.ts`
- Modify: `packages/cal-mcp/cal-mcp-tools.json` (regenerate from CALENDAR_TOOLS)

- [ ] **Step 1: Bump package.json version to 0.3.0**

In `packages/cal-mcp/package.json`, change `"version": "0.2.1"` to `"version": "0.3.0"`.

- [ ] **Step 2: Fix main.ts server version string**

In `packages/cal-mcp/src/main.ts`, change line 13:
```typescript
    { name: "@miguelarios/cal-mcp", version: "0.3.0" },
```

- [ ] **Step 3: Run all cal-mcp tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Run typecheck**

Run: `cd packages/cal-mcp && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Run full project build**

Run: `npm run build`
Expected: All packages build successfully.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass across all packages.

- [ ] **Step 7: Update cal-mcp-tools.json**

Regenerate `packages/cal-mcp/cal-mcp-tools.json` from the `CALENDAR_TOOLS` array — extract the tool name, description, and inputSchema for each of the 11 tools. This file is used for documentation/reference.

- [ ] **Step 8: Sync lock file**

Run: `npm install --package-lock-only`

- [ ] **Step 9: Commit**

```bash
git add packages/cal-mcp/package.json packages/cal-mcp/src/main.ts packages/cal-mcp/cal-mcp-tools.json package-lock.json
git commit -m "chore(cal-mcp): bump to v0.3.0 for unified schema breaking change"
```
