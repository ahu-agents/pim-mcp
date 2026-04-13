# cal-mcp Bugfix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 open bugs found during live testing of cal-mcp against Mailbox.org CalDAV.

**Architecture:** Fixes span 3 files in cal-mcp (`ical.ts`, `CalDavService.ts`, `calendarTools.ts`) and 1 in pim-core (`config.ts`). Each task is independent except BUG-9 which depends on BUG-2. BUG-3 (timezone) is the largest change and touches pim-core + cal-mcp.

**Tech Stack:** TypeScript, node-ical (parsing + rrule expansion), ical-generator (ICS creation), tsdav (CalDAV client), Vitest

**Bug tracking doc:** `docs/2026-03-13-cal-mcp-testing-bugs.md`

**Note on BUG-5:** After reviewing all tool schemas, param names are actually consistent (`calendar`/`uid` everywhere). `find_free_slots` uses `calendars` (plural array) which is intentional. BUG-5 is invalid — update the bug doc to mark it as NOT A BUG.

---

## Chunk 1: Quick Fixes (BUG-4, BUG-6, BUG-8)

These are small, isolated fixes that can each be done in minutes.

---

### Task 1: BUG-4 — Parse attendee PARTSTAT and ROLE from ICS

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:54-63` (attendee parsing loop)
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts` (add attendee param tests)

The `node-ical` attendee object has `params.PARTSTAT` (e.g., "ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION") and `params.ROLE` (e.g., "REQ-PARTICIPANT", "OPT-PARTICIPANT", "CHAIR"). Currently hardcoded to `null`.

- [ ] **Step 1: Write failing tests for attendee status and role parsing**

Add to `packages/cal-mcp/src/__tests__/ical.test.ts` inside the `parseIcsEvents` describe block:

```typescript
it("parses attendee PARTSTAT and ROLE", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:attendee-test",
    "DTSTART:20260315T100000Z",
    "DTEND:20260315T110000Z",
    "SUMMARY:Meeting",
    "ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:alice@example.com",
    "ATTENDEE;CN=Bob;PARTSTAT=DECLINED;ROLE=OPT-PARTICIPANT:mailto:bob@example.com",
    "ATTENDEE;PARTSTAT=TENTATIVE:mailto:carol@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcsEvents(ics);
  expect(events).toHaveLength(1);
  expect(events[0].attendees).toHaveLength(3);

  expect(events[0].attendees[0]).toMatchObject({
    email: "alice@example.com",
    name: "Alice",
    status: "accepted",
    role: "req-participant",
  });
  expect(events[0].attendees[1]).toMatchObject({
    email: "bob@example.com",
    name: "Bob",
    status: "declined",
    role: "opt-participant",
  });
  expect(events[0].attendees[2]).toMatchObject({
    email: "carol@example.com",
    name: null,
    status: "tentative",
    role: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "parses attendee PARTSTAT"`
Expected: FAIL — status and role are `null`

- [ ] **Step 3: Fix attendee parsing in ical.ts**

In `packages/cal-mcp/src/ical.ts`, replace line 62:

```typescript
// OLD:
attendees.push({ email, name, status: null, role: null });

// NEW:
const status = typeof att === "string" ? null : (att.params?.PARTSTAT?.toLowerCase() ?? null);
const role = typeof att === "string" ? null : (att.params?.ROLE?.toLowerCase() ?? null);
attendees.push({ email, name, status, role });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts
git commit -m "fix(cal-mcp): parse attendee PARTSTAT and ROLE from ICS"
```

---

### Task 2: BUG-6 — Fix update_event by passing UID to generateEventIcs

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:28-36,107-128` (EventCreateProps + generateEventIcs)
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts` (add UID test)
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts:501-514` (update_event handler)

The `generateEventIcs` function doesn't accept a UID parameter. `ical-generator` auto-generates a random UID. For updates, the ICS must contain the original event UID or the CalDAV server rejects/ignores the update.

`ical-generator` supports `event.uid('custom-uid')` — verified via `node -e "..."`.

- [ ] **Step 1: Write failing test for UID in generated ICS**

Add to `packages/cal-mcp/src/__tests__/ical.test.ts` inside the `generateEventIcs` describe block:

```typescript
it("sets custom UID when provided", () => {
  const ics = generateEventIcs({
    title: "Test",
    start: "2026-03-15T10:00:00Z",
    end: "2026-03-15T11:00:00Z",
    uid: "custom-uid-123",
  });
  expect(ics).toContain("UID:custom-uid-123");
});

it("auto-generates UID when not provided", () => {
  const ics = generateEventIcs({
    title: "Test",
    start: "2026-03-15T10:00:00Z",
    end: "2026-03-15T11:00:00Z",
  });
  expect(ics).toMatch(/UID:.+/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "sets custom UID"`
Expected: FAIL — UID is random, not "custom-uid-123"

- [ ] **Step 3: Add uid to EventCreateProps and generateEventIcs**

In `packages/cal-mcp/src/ical.ts`:

Add `uid` to the `EventCreateProps` interface:

```typescript
export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
  uid?: string;
}
```

In `generateEventIcs`, after `const event = calendar.createEvent(eventOptions);` add:

```typescript
if (props.uid) {
  event.uid(props.uid);
}
```

- [ ] **Step 4: Pass UID in update_event handler**

In `packages/cal-mcp/src/tools/calendarTools.ts`, in the `update_event` case (around line 501), add `uid` to the `generateEventIcs` call. Find the existing call:

```typescript
const icsString = generateEventIcs({
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
});
```

Add `uid: args.uid as string,` as the first property in the object.

- [ ] **Step 5: Run all tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts packages/cal-mcp/src/tools/calendarTools.ts
git commit -m "fix(cal-mcp): pass event UID to generateEventIcs for updates"
```

---

### Task 3: BUG-8 — Add descriptions to create_events_batch schema

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts:236-256` (batch items schema)

This is a schema-only change. The `items` properties lack descriptions. The `required` array already exists (line 256: `required: ["title", "start", "end"]`) — only descriptions are missing.

- [ ] **Step 1: Update the batch event item schema**

In `packages/cal-mcp/src/tools/calendarTools.ts`, replace the `items` object inside `create_events_batch` (lines 236-256):

```typescript
items: {
  type: "object",
  properties: {
    title: { type: "string", description: "Event title" },
    start: {
      type: "string",
      description: "Start time (ISO 8601)",
    },
    end: { type: "string", description: "End time (ISO 8601)" },
    all_day: {
      type: "boolean",
      description: "All-day event flag (default: false)",
    },
    location: { type: "string", description: "Event location" },
    description: {
      type: "string",
      description: "Event description",
    },
    attendees: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email: { type: "string", description: "Attendee email address" },
          name: { type: "string", description: "Attendee display name" },
        },
        required: ["email"],
      },
      description: "List of attendees",
    },
  },
  required: ["title", "start", "end"],
},
```

This matches the `create_event` schema exactly.

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cal-mcp/src/tools/calendarTools.ts
git commit -m "fix(cal-mcp): add field descriptions to create_events_batch schema"
```

---

### Task 4: Update bug doc — mark BUG-5 as invalid

**Files:**
- Modify: `docs/2026-03-13-cal-mcp-testing-bugs.md`

- [ ] **Step 1: Update BUG-5 status**

Change BUG-5's status line to:
```
- **Status:** NOT A BUG — all tools consistently use `calendar`/`uid`. `find_free_slots` uses `calendars` (plural array) which is intentional. Original report was caused by tester error.
```

- [ ] **Step 2: Fix BUG-8 description accuracy**

BUG-8 says "no descriptions and no `required` array" — the `required` array already exists. Update to: "The `events` array items schema has bare `{ type: "string" }` for fields with no descriptions. The `required` array exists but field descriptions are missing, so agents have no guidance on formats (e.g., ISO 8601 for dates)."

- [ ] **Step 3: Fix BUG-3 env var name**

BUG-3 suggests `CALDAV_TIMEZONE` but the implementation uses `PIM_TIMEZONE` (since it applies to both cal-mcp and email-mcp). Update the bug doc to reference `PIM_TIMEZONE`.

- [ ] **Step 4: Commit**

```bash
git add docs/2026-03-13-cal-mcp-testing-bugs.md
git commit -m "docs: mark BUG-5 as not a bug"
```

---

## Chunk 2: Recurring Event Expansion (BUG-2, BUG-9)

BUG-9 (free slot overlap) is likely caused by BUG-2 (recurring events returning original dates instead of occurrences). The `findFreeSlots` method uses event start/end times from `parseIcsEvents` — if those are wrong (original date instead of occurrence date), the busy intervals will be wrong, causing incorrect free slot boundaries.

Fix BUG-2 first, then verify if BUG-9 resolves automatically.

---

### Task 5: BUG-2 — Expand recurring events into occurrences

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:38-105` (parseIcsEvents function)
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts` (add recurrence tests)

`node-ical` provides `vevent.rrule.between(startDate, endDate)` which returns occurrence dates within a range. The event duration can be calculated from `end - start` of the original event. Each occurrence gets the original event's properties but with adjusted start/end.

The `parseIcsEvents` function needs to accept an optional time range. When provided, recurring events are expanded into individual occurrences within that range. When not provided (e.g., `get_event`, `import_ics`), the original event is returned as-is.

**Known limitation:** EXDATE (exception dates for cancelled occurrences) is not handled by `rrule.between()`. Recurring events with cancelled instances may produce phantom occurrences. This can be addressed in a follow-up.

**Safety note:** Add a defensive check for `typeof vevent.rrule.between === 'function'` since `node-ical` may not always expose a full RRule instance.

**Double-expansion safety:** When the CalDAV server supports `expand: true` (passed in `fetchCalendarObjects`), it returns individual occurrences without RRULE. In that case `vevent.rrule` is falsy and client-side expansion is skipped. This provides defense in depth for servers that don't support server-side expansion.

- [ ] **Step 1: Write failing tests for recurrence expansion**

Add to `packages/cal-mcp/src/__tests__/ical.test.ts`:

```typescript
describe("recurrence expansion", () => {
  const weeklyIcs = [
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

  it("expands recurring event into occurrences within range", () => {
    const events = parseIcsEvents(weeklyIcs, {
      start: "2026-03-01T00:00:00Z",
      end: "2026-03-15T00:00:00Z",
    });
    expect(events.length).toBe(2); // Two Thursdays in Mar 1-14
    expect(events[0].uid).toBe("weekly-meeting");
    expect(events[0].title).toBe("Weekly Standup");
    expect(events[0].location).toBe("Room A");
    expect(events[0].is_recurring).toBe(true);
    // Each occurrence should have 1-hour duration
    for (const evt of events) {
      const start = new Date(evt.start).getTime();
      const end = new Date(evt.end).getTime();
      expect(end - start).toBe(3600000); // 1 hour
    }
  });

  it("returns original event when no range is provided", () => {
    const events = parseIcsEvents(weeklyIcs);
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe("2026-01-01T10:00:00.000Z");
  });

  it("returns empty array when no occurrences fall in range", () => {
    const events = parseIcsEvents(weeklyIcs, {
      start: "2027-01-01T00:00:00Z",
      end: "2027-01-31T00:00:00Z",
    });
    expect(events).toHaveLength(0);
  });

  it("preserves non-recurring events unchanged when range is provided", () => {
    const singleIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:single-event",
      "DTSTART:20260310T140000Z",
      "DTEND:20260310T150000Z",
      "SUMMARY:One-off Meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcsEvents(singleIcs, {
      start: "2026-03-01T00:00:00Z",
      end: "2026-03-31T00:00:00Z",
    });
    expect(events).toHaveLength(1);
    expect(events[0].start).toBe("2026-03-10T14:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "recurrence expansion"`
Expected: FAIL — `parseIcsEvents` doesn't accept a second argument

- [ ] **Step 3: Implement recurrence expansion in parseIcsEvents**

In `packages/cal-mcp/src/ical.ts`, modify the `parseIcsEvents` function signature and add expansion logic:

```typescript
export interface TimeRange {
  start: string;
  end: string;
}

export function parseIcsEvents(icsContent: string, range?: TimeRange): ParsedEvent[] {
  if (!icsContent.trim()) return [];

  const parsed = nodeIcal.parseICS(icsContent);
  const events: ParsedEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (component.type !== "VEVENT") continue;
    const vevent = component as nodeIcal.VEvent;

    // Build base event properties (attendees, organizer, etc.)
    // ... (existing attendee/organizer/availability code stays the same) ...

    const baseProps = {
      uid: vevent.uid || "",
      title: vevent.summary || "",
      all_day: (vevent as any).datetype === "date",
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
    };

    // If recurring and a range is provided, expand occurrences
    if (vevent.rrule && range && typeof vevent.rrule.between === "function") {
      const originalStart = new Date(vevent.start);
      const originalEnd = new Date(vevent.end);
      const duration = originalEnd.getTime() - originalStart.getTime();

      const occurrences = vevent.rrule.between(
        new Date(range.start),
        new Date(range.end),
        true, // inclusive
      );

      for (const occStart of occurrences) {
        const occEnd = new Date(occStart.getTime() + duration);
        events.push({
          ...baseProps,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
        });
      }
    } else {
      // Non-recurring, or no range provided — return as-is
      events.push({
        ...baseProps,
        start: vevent.start ? new Date(vevent.start).toISOString() : "",
        end: vevent.end ? new Date(vevent.end).toISOString() : "",
      });
    }
  }

  return events;
}
```

Refactor the function so the attendee/organizer/availability extraction happens before the branching. The existing code (lines 48–101) builds these inline then pushes one event. Instead, extract the shared properties into `baseProps`, then push either expanded occurrences or the single event.

- [ ] **Step 4: Run ical tests**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts`
Expected: ALL PASS (including existing tests — the `range` param is optional)

- [ ] **Step 5: Pass time range to parseIcsEvents in service methods**

In `packages/cal-mcp/src/services/CalDavService.ts`, update the calls to `parseIcsEvents` that have a time range available:

**listEvents** (around line 183): The method already has `start` and `end` params. After fetching calendar objects, the parsing loop currently does:
```typescript
const parsed = parseIcsEvents(obj.data!);
```
Change to:
```typescript
const parsed = parseIcsEvents(obj.data!, { start, end });
```

**findFreeSlots** (around line 340): Similarly has start/end. Change:
```typescript
const parsed = parseIcsEvents(obj.data!);
```
To:
```typescript
const parsed = parseIcsEvents(obj.data!, { start, end });
```

**Do NOT** pass range to `getEvent` or `import_ics` — those should return the original event.

Update the import in CalDavService.ts to include `TimeRange`:
```typescript
import { parseIcsEvents, generateEventIcs, type TimeRange } from "../ical.js";
```

- [ ] **Step 6: Update CalDavService tests**

In `packages/cal-mcp/src/__tests__/CalDavService.test.ts`, update mocked `parseIcsEvents` calls to expect the range argument. The mock is set up at the top of the file. Find where `parseIcsEvents` is called in tests and verify the mock handles the extra argument (it should, since mocks ignore extra args by default).

- [ ] **Step 7: Run all cal-mcp tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "fix(cal-mcp): expand recurring events into occurrences within queried range"
```

---

### Task 6: BUG-9 — Verify free slot overlap is resolved by BUG-2 fix

After BUG-2 is fixed, the `findFreeSlots` method will receive correct occurrence dates instead of original event dates. This should resolve the overlap issue.

- [ ] **Step 1: Review findFreeSlots busy interval logic**

Read `packages/cal-mcp/src/services/CalDavService.ts:330-500` and verify:
- Events are fetched via `listEvents` (which now expands recurrences)
- Busy intervals use the event's `start`/`end` (now correct occurrence dates)
- Interval merging logic at lines 369-383 handles adjacent/overlapping intervals correctly

- [ ] **Step 2: Add a targeted test if needed**

If the overlap is NOT caused by BUG-2 (i.e., it persists with non-recurring events), add a test in `CalDavService.test.ts` for the `findFreeSlots` method with events at non-round-number times (e.g., 9:50 AM) and verify the free slot ends exactly at the event start.

The existing `findFreeSlots` tests in `CalDavService.test.ts` (lines 330-586) use round times. Add:

```typescript
it("ends free slot exactly at event start time", () => {
  // Mock an event starting at 14:50 (not a round hour)
  mockParseIcsEvents.mockReturnValue([{
    uid: "odd-time",
    title: "Odd Time Event",
    start: "2026-03-15T14:50:00.000Z",
    end: "2026-03-15T16:00:00.000Z",
    all_day: false,
    availability: "busy",
    status: "confirmed",
  }]);

  const slots = await service.findFreeSlots(
    ["mailbox/Calendar"],
    "2026-03-15T13:00:00.000Z",
    "2026-03-15T17:00:00.000Z",
    30,
  );

  // First free slot should end exactly at 14:50
  expect(slots[0].end).toBe("2026-03-15T14:50:00.000Z");
});
```

- [ ] **Step 3: Update BUG-9 status in bug doc**

If resolved: mark as "FIXED — resolved by BUG-2 recurrence expansion fix"
If not resolved: document the remaining issue and fix the interval logic.

- [ ] **Step 4: Commit if changes were made**

```bash
git add packages/cal-mcp/src/__tests__/CalDavService.test.ts docs/2026-03-13-cal-mcp-testing-bugs.md
git commit -m "test(cal-mcp): verify free slot boundaries after recurrence fix"
```

---

## Chunk 3: Client Login Caching (BUG-7)

### Task 7: BUG-7 — Cache authenticated DAVClient per account

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:60-80` (constructor + createClient area)
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts` (verify login count)

CardDavService already solves this with `ensureConnected()`. CalDavService needs a similar pattern, but supporting multiple accounts (Map of clients keyed by account ID).

- [ ] **Step 1: Write a test that verifies login is called only once per account**

Add to `packages/cal-mcp/src/__tests__/CalDavService.test.ts`:

```typescript
describe("client caching", () => {
  it("reuses authenticated client across multiple calls for same account", async () => {
    const loginSpy = mockClient.login;
    loginSpy.mockClear();

    await service.listCalendars();
    await service.listEvents("mailbox/Calendar", "2026-03-01", "2026-03-31");
    await service.listEvents("mailbox/Calendar", "2026-04-01", "2026-04-30");

    // Should only login once per account (2 accounts for listCalendars, then reuse for listEvents)
    // listCalendars hits both accounts (mailbox + nextcloud) = 2 logins
    // listEvents hits mailbox only = 0 additional logins (cached)
    // Total: 2 logins
    expect(loginSpy).toHaveBeenCalledTimes(2);
  });
});
```

Note: The exact count depends on how the mock is structured. The current mock uses a single `mockClient` instance for all `DAVClient` instantiations, so this test may need adjustment. The key assertion is that `login()` is NOT called again for an account that's already been authenticated.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts -t "client caching"`
Expected: FAIL — login is called on every operation (currently ~5 times)

- [ ] **Step 3: Implement client caching**

In `packages/cal-mcp/src/services/CalDavService.ts`, add a client cache Map and replace `createClient`:

```typescript
export class CalDavService {
  private accounts: Map<string, CalDavAccount>;
  private clients: Map<string, DAVClient> = new Map();

  // ... constructor stays the same ...

  private createClient(account: CalDavAccount): DAVClient {
    return new DAVClient({
      serverUrl: account.url,
      credentials: { username: account.username, password: account.password },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

  private async getClient(account: CalDavAccount): Promise<DAVClient> {
    const existing = this.clients.get(account.id);
    if (existing) return existing;

    const client = this.createClient(account);
    await client.login();
    this.clients.set(account.id, client);
    return client;
  }
```

- [ ] **Step 4: Replace all `createClient` + `login()` calls with `getClient`**

In every public method, replace the pattern:
```typescript
const client = this.createClient(account);
// ...
await client.login();
```

With:
```typescript
const client = await this.getClient(account);
```

Methods to update (search for `this.createClient` and `client.login()`):
- `listCalendars` (~line 140-142)
- `listEvents` (~line 166-169)
- `getEvent` (~line 206-209)
- `createEvent` (~line 245-248)
- `updateEvent` (~line 264-267)
- `deleteEvent` (~line 286-289)
- `findFreeSlots` (~line 327-328)

Remove the `await client.login()` lines since `getClient` handles login.

- [ ] **Step 5: Run all tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: ALL PASS

Note: Some existing tests may need adjustment if they assert on `login` call counts or `DAVClient` constructor calls. The mock setup creates a shared `mockClient`, so caching behavior in tests depends on whether the mock returns the same instance. If tests fail, check that the mock's `DAVClient` constructor returns the same object (which it does — the current mock uses a singleton pattern).

- [ ] **Step 6: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "perf(cal-mcp): cache authenticated DAVClient per account"
```

---

## Chunk 4: Timezone Support (BUG-3)

This is the largest change. It adds timezone awareness to pim-core (shared utility), then uses it in cal-mcp for both reading and writing events. Email-mcp changes are out of scope for this plan but should follow the same pattern later.

### Task 8: Add timezone utility to pim-core

**Files:**
- Create: `packages/core/src/timezone.ts`
- Create: `packages/core/src/__tests__/timezone.test.ts`
- Modify: `packages/core/src/index.ts` (export new module)

The utility detects the user's timezone from the OS via `Intl.DateTimeFormat().resolvedOptions().timeZone`, with an optional `PIM_TIMEZONE` env var override. It provides functions to:
- Get the resolved timezone name (e.g., "America/Chicago")
- Format a UTC Date to an ISO string with timezone offset (e.g., `2026-03-14T10:00:00-05:00`)
- Parse a timestamp string and determine if it has an explicit timezone

- [ ] **Step 1: Write failing tests for timezone utility**

Create `packages/core/src/__tests__/timezone.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInTimezone, getTimezone, parseTimestamp } from "../timezone.js";

describe("getTimezone", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns OS timezone by default", () => {
    const tz = getTimezone();
    // Should return a valid IANA timezone string
    expect(tz).toMatch(/^[A-Za-z]+\/[A-Za-z_]+/);
  });

  it("returns PIM_TIMEZONE env var when set", () => {
    vi.stubEnv("PIM_TIMEZONE", "America/New_York");
    expect(getTimezone()).toBe("America/New_York");
  });

  it("falls back to OS timezone when PIM_TIMEZONE is empty", () => {
    vi.stubEnv("PIM_TIMEZONE", "");
    const tz = getTimezone();
    expect(tz).toMatch(/^[A-Za-z]+\/[A-Za-z_]+/);
  });
});

describe("formatInTimezone", () => {
  it("converts UTC date to timezone offset string", () => {
    // March 14 2026 15:00 UTC = 10:00 AM CDT (UTC-5)
    const result = formatInTimezone("2026-03-14T15:00:00.000Z", "America/Chicago");
    expect(result).toBe("2026-03-14T10:00:00-05:00");
  });

  it("handles DST transitions correctly", () => {
    // January is CST (UTC-6), March 8 2026 is after spring forward (CDT, UTC-5)
    const winter = formatInTimezone("2026-01-15T18:00:00.000Z", "America/Chicago");
    expect(winter).toBe("2026-01-15T12:00:00-06:00");

    const summer = formatInTimezone("2026-07-15T17:00:00.000Z", "America/Chicago");
    expect(summer).toBe("2026-07-15T12:00:00-05:00");
  });

  it("works with non-US timezones", () => {
    const result = formatInTimezone("2026-03-14T15:00:00.000Z", "Europe/Berlin");
    expect(result).toBe("2026-03-14T16:00:00+01:00");
  });
});

describe("parseTimestamp", () => {
  it("detects UTC timestamp", () => {
    const result = parseTimestamp("2026-03-14T15:00:00Z");
    expect(result.isUTC).toBe(true);
    expect(result.hasExplicitTimezone).toBe(false);
    expect(result.date.toISOString()).toBe("2026-03-14T15:00:00.000Z");
  });

  it("detects timestamp with timezone offset", () => {
    const result = parseTimestamp("2026-03-14T10:00:00-05:00");
    expect(result.isUTC).toBe(false);
    expect(result.hasExplicitTimezone).toBe(true);
    expect(result.date.toISOString()).toBe("2026-03-14T15:00:00.000Z");
    expect(result.offsetMinutes).toBe(-300);
  });

  it("treats bare timestamp as local (no timezone info)", () => {
    const result = parseTimestamp("2026-03-14T10:00:00");
    expect(result.isUTC).toBe(false);
    expect(result.hasExplicitTimezone).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/__tests__/timezone.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement timezone utility**

Create `packages/core/src/timezone.ts`:

```typescript
export function getTimezone(): string {
  const envTz = process.env.PIM_TIMEZONE;
  if (envTz && envTz.trim()) return envTz.trim();
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatInTimezone(isoUtcString: string, timezone: string): string {
  const date = new Date(isoUtcString);
  // Use Intl to get the offset for this specific date in this timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");
  const tzName = get("timeZoneName"); // e.g., "GMT-05:00" or "GMT+01:00"

  // Parse offset from tzName (format: "GMT±HH:MM" or "GMT" for UTC)
  const offsetMatch = tzName.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = offsetMatch ? offsetMatch[1] : "+00:00";

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

export interface ParsedTimestamp {
  date: Date;
  isUTC: boolean;
  hasExplicitTimezone: boolean;
  offsetMinutes?: number;
}

export function parseTimestamp(timestamp: string): ParsedTimestamp {
  const date = new Date(timestamp);

  if (timestamp.endsWith("Z")) {
    return { date, isUTC: true, hasExplicitTimezone: false };
  }

  const offsetMatch = timestamp.match(/([+-])(\d{2}):(\d{2})$/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const hours = Number.parseInt(offsetMatch[2], 10);
    const minutes = Number.parseInt(offsetMatch[3], 10);
    return {
      date,
      isUTC: false,
      hasExplicitTimezone: true,
      offsetMinutes: sign * (hours * 60 + minutes),
    };
  }

  return { date, isUTC: false, hasExplicitTimezone: false };
}
```

- [ ] **Step 4: Export from index.ts**

In `packages/core/src/index.ts`, add:

```typescript
export { getTimezone, formatInTimezone, parseTimestamp, type ParsedTimestamp } from "./timezone.js";
```

- [ ] **Step 5: Run all core tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/timezone.ts packages/core/src/__tests__/timezone.test.ts packages/core/src/index.ts
git commit -m "feat(core): add timezone detection and formatting utilities"
```

---

### Task 9: Apply timezone to cal-mcp read operations (output formatting)

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts` (format output timestamps)
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts` (update expected outputs)
- Modify: `packages/cal-mcp/src/services/CalDavService.ts` (pass timezone context)

All timestamps returned to the user should be in their local timezone. The conversion happens at the output layer — `parseIcsEvents` continues to work with UTC internally but formats the final output using `formatInTimezone`.

- [ ] **Step 1: Write a test for timezone-aware output**

Add to `packages/cal-mcp/src/__tests__/ical.test.ts`:

```typescript
it("formats event times in specified timezone", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:tz-test",
    "DTSTART:20260314T150000Z",
    "DTEND:20260314T160000Z",
    "SUMMARY:TZ Test",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcsEvents(ics, undefined, "America/Chicago");
  expect(events[0].start).toBe("2026-03-14T10:00:00-05:00");
  expect(events[0].end).toBe("2026-03-14T11:00:00-05:00");
});

it("returns UTC when no timezone is specified", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:utc-test",
    "DTSTART:20260314T150000Z",
    "DTEND:20260314T160000Z",
    "SUMMARY:UTC Test",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcsEvents(ics);
  expect(events[0].start).toBe("2026-03-14T15:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "formats event times"`
Expected: FAIL — third argument not accepted

- [ ] **Step 3: Add timezone parameter to parseIcsEvents**

In `packages/cal-mcp/src/ical.ts`, update the signature:

```typescript
import { formatInTimezone } from "@miguelarios/pim-core";

export function parseIcsEvents(icsContent: string, range?: TimeRange, timezone?: string): ParsedEvent[] {
```

When building event objects, format the timestamps:

```typescript
const formatTime = (date: Date): string => {
  const iso = date.toISOString();
  return timezone ? formatInTimezone(iso, timezone) : iso;
};
```

Then use `formatTime` for all timestamp outputs: `start`, `end`, `created`, `last_modified`.

- [ ] **Step 4: Pass timezone through CalDavService**

In `packages/cal-mcp/src/services/CalDavService.ts`, the service needs to know the timezone. Add it to the constructor:

```typescript
import { getTimezone } from "@miguelarios/pim-core";

export class CalDavService {
  private accounts: Map<string, CalDavAccount>;
  private clients: Map<string, DAVClient> = new Map();
  private timezone: string;

  constructor(config: CalDavConfig) {
    this.accounts = new Map(config.accounts.map((a) => [a.id, a]));
    this.timezone = getTimezone();
  }
```

Then pass `this.timezone` to all `parseIcsEvents` calls:

```typescript
// In listEvents:
const parsed = parseIcsEvents(obj.data!, { start, end }, this.timezone);

// In getEvent:
const parsed = parseIcsEvents(obj.data!, undefined, this.timezone);

// In findFreeSlots — keep using UTC internally for calculations:
const parsed = parseIcsEvents(obj.data!, { start, end });
// Then format the final slot output timestamps
```

**Important:** `findFreeSlots` should do its interval math in UTC (epoch milliseconds) and only convert the final slot `start`/`end` to the user's timezone before returning.

- [ ] **Step 5: Update existing tests**

Existing tests that check exact timestamp strings will need updating — either mock `getTimezone` to return "UTC" in tests, or update expected values. The cleanest approach is to stub `PIM_TIMEZONE=UTC` in the test setup to keep existing assertions working, and add new timezone-specific tests.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): output event timestamps in user's local timezone"
```

---

### Task 10: Apply timezone to cal-mcp write operations (event creation)

**Files:**
- Modify: `packages/cal-mcp/src/ical.ts:107-128` (generateEventIcs)
- Modify: `packages/cal-mcp/src/__tests__/ical.test.ts` (timezone in generated ICS)

When creating events, the ICS should use `DTSTART;TZID=America/Chicago:20260314T100000` instead of `DTSTART:20260314T150000Z`. The `ical-generator` library supports `event.timezone('America/Chicago')` — verified via testing.

**Risk:** `ical-generator`'s `timezone()` sets TZID on DTSTART/DTEND but may not include a full VTIMEZONE block in the ICS. Some CalDAV servers require VTIMEZONE for RFC compliance. After implementing, test the generated ICS against the live Mailbox.org CalDAV server to confirm acceptance. If rejected, `ical-generator` has a `timezone` option on the calendar level that can include VTIMEZONE definitions.

**Input handling:**
- UTC input (`2026-03-14T15:00:00Z`): Convert to user's timezone for the ICS → `DTSTART;TZID=America/Chicago:20260314T100000`
- Explicit offset input (`2026-03-14T10:00:00-05:00`): Use as-is, derive TZID from offset if possible, or use user's timezone
- Bare input (`2026-03-14T10:00:00`): Assume user's timezone

- [ ] **Step 1: Write failing tests for timezone-aware ICS generation**

Add to `packages/cal-mcp/src/__tests__/ical.test.ts`:

```typescript
describe("timezone in generated ICS", () => {
  it("generates ICS with user timezone when timezone is provided", () => {
    const ics = generateEventIcs({
      title: "Chicago Meeting",
      start: "2026-03-14T15:00:00Z",
      end: "2026-03-14T16:00:00Z",
      timezone: "America/Chicago",
    });
    expect(ics).toContain("TZID=America/Chicago");
    expect(ics).not.toContain("DTSTART:20260314T150000Z");
  });

  it("generates UTC ICS when no timezone is provided", () => {
    const ics = generateEventIcs({
      title: "UTC Meeting",
      start: "2026-03-14T15:00:00Z",
      end: "2026-03-14T16:00:00Z",
    });
    expect(ics).toContain("20260314T150000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/ical.test.ts -t "timezone in generated"`
Expected: FAIL

- [ ] **Step 3: Add timezone support to generateEventIcs**

In `packages/cal-mcp/src/ical.ts`, add `timezone?: string` to `EventCreateProps`:

```typescript
export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
  uid?: string;
  timezone?: string;
}
```

In `generateEventIcs`, after creating the event:

```typescript
if (props.timezone) {
  event.timezone(props.timezone);
}
```

`ical-generator` handles the TZID conversion automatically when `timezone()` is set — it converts the UTC Date objects to the specified timezone in the ICS output.

- [ ] **Step 4: Pass timezone in tool handlers**

In `packages/cal-mcp/src/tools/calendarTools.ts`, the `create_event`, `update_event`, and `create_events_batch` handlers should pass the user's timezone to `generateEventIcs`. Import `getTimezone` from pim-core and pass it:

```typescript
import { getTimezone } from "@miguelarios/pim-core";

// In create_event handler:
const icsString = generateEventIcs({
  ...input,
  timezone: getTimezone(),
});

// Same for update_event and create_events_batch
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cal-mcp/src/ical.ts packages/cal-mcp/src/__tests__/ical.test.ts packages/cal-mcp/src/tools/calendarTools.ts
git commit -m "feat(cal-mcp): create events with user's local timezone in ICS"
```

---

### Task 11: Version bump and publish

**Files:**
- Modify: `packages/core/package.json` (bump version)
- Modify: `packages/cal-mcp/package.json` (bump version + core dep)

- [ ] **Step 1: Bump pim-core to 0.3.0** (new feature: timezone utilities)

```bash
# In packages/core/package.json, change version to "0.3.0"
```

- [ ] **Step 2: Bump cal-mcp to 0.4.0** (breaking: timestamp output format changes from UTC to local)

```bash
# In packages/cal-mcp/package.json:
# - Change version to "0.4.0"
# - Change pim-core dep to "^0.3.0"
```

- [ ] **Step 3: Sync lockfile, build, test**

```bash
npm install --package-lock-only
npm run build
npm test
```

- [ ] **Step 4: Commit and tag**

```bash
git add packages/core/package.json packages/cal-mcp/package.json package-lock.json
git commit -m "chore: bump pim-core to 0.3.0, cal-mcp to 0.4.0 for timezone support"
git tag pim-core/v0.3.0
git tag cal-mcp/v0.4.0
git push origin main
git push origin pim-core/v0.3.0
git push origin cal-mcp/v0.4.0
```

**Important:** Push `pim-core` tag first and wait for it to publish before pushing `cal-mcp` tag, since cal-mcp depends on the new core version.

- [ ] **Step 5: Update bug doc — mark all fixed bugs**

Update `docs/2026-03-13-cal-mcp-testing-bugs.md` with fix statuses and release versions.
