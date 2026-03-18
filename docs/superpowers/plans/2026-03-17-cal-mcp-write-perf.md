# cal-mcp Write Path Performance Optimization

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `updateEvent` from 7 network calls to 2, and similarly optimize `createEvent`/`deleteEvent`, by eliminating redundant fetches and adding explicit write response checking.

**Architecture:** Add `fetchCalendars` cache, `getEventWithMeta` method, response checking on tsdav writes, and construct `EventFull` from local ICS instead of re-fetching. All changes in CalDavService + handler layer.

**Tech Stack:** TypeScript, tsdav, vitest, pim-core ErrorCode

**Spec:** `docs/superpowers/specs/2026-03-17-cal-mcp-write-perf-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/errors.ts` | Modify:1-23 | Add `WRITE_FAILED` to ErrorCode enum |
| `packages/cal-mcp/src/services/CalDavService.ts` | Modify | Cache, `getEventWithMeta`, response checking, build-from-ICS |
| `packages/cal-mcp/src/tools/calendarTools.ts` | Modify:501-549 | Use `getEventWithMeta`, pass `meta` to write methods |
| `packages/cal-mcp/src/__tests__/CalDavService.test.ts` | Modify | New + updated tests |

---

## Chunk 1: ErrorCode + Response Checking + Tests

### Task 1: Add WRITE_FAILED to ErrorCode enum

**Files:**
- Modify: `packages/core/src/errors.ts:1-23`

- [ ] **Step 1: Add WRITE_FAILED to the enum**

In `packages/core/src/errors.ts`, add after line 22 (`OPERATION_FAILED`):

```typescript
  WRITE_FAILED = "WRITE_FAILED",
```

- [ ] **Step 2: Verify build**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/errors.ts
git commit -m "feat(core): add WRITE_FAILED to ErrorCode enum"
```

---

### Task 2: Add response checking to write methods + tests

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:255-311`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Write failing tests for response checking**

Add to `CalDavService.test.ts` inside the `createEvent` describe block:

```typescript
    it("throws CalendarError when server returns non-ok response", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      __mockClient.createCalendarObject.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        service.createEvent("mailbox/Work", "BEGIN:VCALENDAR\nEND:VCALENDAR", "new-evt"),
      ).rejects.toThrow("Failed to create event: 500 Internal Server Error");
    });
```

Add to `updateEvent` describe block:

```typescript
    it("throws CalendarError when server returns non-ok response", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      // findCalendarObject succeeds
      (parseIcsEvents as any).mockReturnValueOnce([{ uid: "evt-1" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValueOnce([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      __mockClient.updateCalendarObject.mockResolvedValue({
        ok: false,
        status: 412,
        statusText: "Precondition Failed",
      });

      await expect(
        service.updateEvent("mailbox/Work", "evt-1", "BEGIN:VCALENDAR\nEND:VCALENDAR"),
      ).rejects.toThrow("Failed to update event: 412 Precondition Failed");
    });
```

Add to `deleteEvent` describe block:

```typescript
    it("throws CalendarError when server returns non-ok response", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      (parseIcsEvents as any).mockReturnValue([{ uid: "evt-1" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      __mockClient.deleteCalendarObject.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(service.deleteEvent("mailbox/Work", "evt-1")).rejects.toThrow(
        "Failed to delete event: 404 Not Found",
      );
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: 3 new tests FAIL (no response checking yet)

- [ ] **Step 3: Add response checking to all three write methods**

In `CalDavService.ts`, add the `CalendarError` import if not already present (it is — line 4), and import `ErrorCode` (already imported).

Update `createEvent` (lines 255-271). Replace:

```typescript
      await client.createCalendarObject({
        calendar,
        iCalString: icalString,
        filename: `${uid}.ics`,
      });
      return await this.getEvent(calendarId, uid);
```

With:

```typescript
      const response = await client.createCalendarObject({
        calendar,
        iCalString: icalString,
        filename: `${uid}.ics`,
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to create event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }
      return await this.getEvent(calendarId, uid);
```

Update `updateEvent` (lines 273-292). Replace:

```typescript
      await client.updateCalendarObject({
        calendarObject: {
          url: obj.url,
          etag: obj.etag,
          data: icalString,
        },
      });
      return await this.getEvent(calendarId, uid);
```

With:

```typescript
      const response = await client.updateCalendarObject({
        calendarObject: {
          url: obj.url,
          etag: obj.etag,
          data: icalString,
        },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to update event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }
      return await this.getEvent(calendarId, uid);
```

Update `deleteEvent` (lines 294-311). Replace:

```typescript
      await client.deleteCalendarObject({
        calendarObject: {
          url: obj.url,
          etag: obj.etag,
        },
      });
```

With:

```typescript
      const response = await client.deleteCalendarObject({
        calendarObject: {
          url: obj.url,
          etag: obj.etag,
        },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to delete event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): add explicit response checking on CalDAV write operations"
```

---

## Chunk 2: fetchCalendars Cache

### Task 3: Add fetchCalendars cache + tests

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts:65-133`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Write failing tests for cache behavior**

Add a new describe block in `CalDavService.test.ts`:

```typescript
  describe("fetchCalendars cache", () => {
    it("caches fetchCalendars result and reuses on second findCalendar call", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "evt-1",
          title: "Event",
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
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      // Two getEvent calls to the same provider
      await service.getEvent("mailbox/Work", "evt-1");
      await service.getEvent("mailbox/Work", "evt-1");

      // fetchCalendars should only be called once (cached after first)
      expect(__mockClient.fetchCalendars).toHaveBeenCalledTimes(1);
    });

    it("listCalendars always fetches fresh and populates cache", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "evt-1",
          title: "Event",
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
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      // listCalendars fetches fresh
      await service.listCalendars();
      // getEvent should use the cache populated by listCalendars
      await service.getEvent("mailbox/Work", "evt-1");

      // fetchCalendars called 2 times for listCalendars (one per account),
      // then 0 more for getEvent (cache hit)
      expect(__mockClient.fetchCalendars).toHaveBeenCalledTimes(2);
    });

    it("invalidates cache on write error", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      (parseIcsEvents as any).mockReturnValue([
        {
          uid: "evt-1",
          title: "Event",
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
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      // First call populates the cache
      await service.getEvent("mailbox/Work", "evt-1");
      expect(__mockClient.fetchCalendars).toHaveBeenCalledTimes(1);

      // Simulate a write error (non-CalendarError triggers cache invalidation)
      __mockClient.updateCalendarObject.mockRejectedValue(new Error("network failure"));

      await expect(
        service.updateEvent("mailbox/Work", "evt-1", "BEGIN:VCALENDAR\nEND:VCALENDAR"),
      ).rejects.toThrow();

      // Next call should re-fetch calendars (cache was invalidated)
      await service.getEvent("mailbox/Work", "evt-1");
      expect(__mockClient.fetchCalendars).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: 2 new tests FAIL (no cache yet)

- [ ] **Step 3: Implement the cache**

In `CalDavService.ts`, add a cache field at line 67 (after `clients`):

```typescript
  private calendarsCache: Map<string, any[]> = new Map();
```

Update `findCalendar` (lines 117-133). Replace:

```typescript
  private async findCalendar(
    client: DAVClient,
    calendarName: string,
    providerId: string,
  ): Promise<any> {
    const calendars = await client.fetchCalendars();
    const calendar = calendars.find(
      (c) => (typeof c.displayName === "string" ? c.displayName : "") === calendarName,
    );
    if (!calendar) {
      throw new CalendarError(
        `Calendar "${calendarName}" not found on provider "${providerId}"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    return calendar;
  }
```

With:

```typescript
  private async findCalendar(
    client: DAVClient,
    calendarName: string,
    providerId: string,
  ): Promise<any> {
    let calendars = this.calendarsCache.get(providerId);
    if (!calendars) {
      calendars = await client.fetchCalendars();
      this.calendarsCache.set(providerId, calendars);
    }
    const calendar = calendars.find(
      (c) => (typeof c.displayName === "string" ? c.displayName : "") === calendarName,
    );
    if (!calendar) {
      throw new CalendarError(
        `Calendar "${calendarName}" not found on provider "${providerId}"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    return calendar;
  }
```

Update `listCalendars` (lines 151-176). After `const calendars = await client.fetchCalendars();` (line 157), add:

```typescript
        this.calendarsCache.set(providerId, calendars);
```

Add cache invalidation to the write error paths. In the `catch` block of `createEvent`, `updateEvent`, and `deleteEvent`, add before the `throw`:

```typescript
        this.calendarsCache.delete(account.id);
```

Note: `account` is already in scope from `resolveAccount` at the top of each method.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "perf(cal-mcp): cache fetchCalendars per account to reduce network calls"
```

---

## Chunk 3: getEventWithMeta + Eliminate Redundant Fetches

### Task 4: Add getEventWithMeta method + tests

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Write failing test for getEventWithMeta**

Add a new describe block in `CalDavService.test.ts`:

```typescript
  describe("getEventWithMeta", () => {
    it("returns event and CalDAV object metadata (url, etag)", async () => {
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
          attendees: [],
          organizer: null,
          recurrence_rule: null,
          is_recurring: false,
          created: null,
          last_modified: null,
        },
      ]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "BEGIN:VCALENDAR...END:VCALENDAR", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      const { event, meta } = await service.getEventWithMeta("mailbox/Work", "evt-1");

      expect(event.uid).toBe("evt-1");
      expect(event.title).toBe("Team Meeting");
      expect(event.calendar_id).toBe("mailbox/Work");
      expect(meta.url).toBe("/cal/evt-1.ics");
      expect(meta.etag).toBe('"e1"');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: FAIL — `getEventWithMeta` does not exist

- [ ] **Step 3: Implement getEventWithMeta**

Export the `CalendarObjectMeta` interface and add the method in `CalDavService.ts`.

After the `FindFreeSlotsOptions` interface (line 63), add:

```typescript
export interface CalendarObjectMeta {
  url: string;
  etag?: string;
}
```

After `getEvent` (line 253), add:

```typescript
  async getEventWithMeta(
    calendarId: string,
    uid: string,
  ): Promise<{ event: EventFull; meta: CalendarObjectMeta }> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const obj = await this.findCalendarObject(client, calendar, uid);
      const parsed = parseIcsEvents(obj.data!, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

      return {
        event: {
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
        },
        meta: { url: obj.url, etag: obj.etag },
      };
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "feat(cal-mcp): add getEventWithMeta to return event + CalDAV object metadata"
```

---

### Task 5: Add optional meta param to updateEvent/deleteEvent + tests

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Write failing tests for meta skip behavior**

Add to the `updateEvent` describe block:

```typescript
    it("skips findCalendarObject when meta is provided", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      const fullEvent = {
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
      };

      __mockClient.updateCalendarObject.mockResolvedValue({ ok: true });
      // parseIcsEvents called only for building EventFull from ICS (no findCalendarObject)
      (parseIcsEvents as any).mockReturnValue([fullEvent]);

      const result = await service.updateEvent(
        "mailbox/Work",
        "evt-1",
        "BEGIN:VCALENDAR\nUPDATED\nEND:VCALENDAR",
        { url: "/cal/evt-1.ics", etag: '"e1"' },
      );

      expect(result.uid).toBe("evt-1");
      expect(result.title).toBe("Updated Meeting");
      // fetchCalendarObjects should NOT have been called (meta provided)
      expect(__mockClient.fetchCalendarObjects).not.toHaveBeenCalled();
      expect(__mockClient.updateCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: expect.objectContaining({
            url: "/cal/evt-1.ics",
            etag: '"e1"',
          }),
        }),
      );
    });
```

Add to the `deleteEvent` describe block:

```typescript
    it("skips findCalendarObject when meta is provided", async () => {
      const { __mockClient } = (await import("tsdav")) as any;

      __mockClient.deleteCalendarObject.mockResolvedValue({ ok: true });

      await service.deleteEvent("mailbox/Work", "evt-1", { url: "/cal/evt-1.ics", etag: '"e1"' });

      // fetchCalendarObjects should NOT have been called (meta provided)
      expect(__mockClient.fetchCalendarObjects).not.toHaveBeenCalled();
      expect(__mockClient.deleteCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: expect.objectContaining({
            url: "/cal/evt-1.ics",
            etag: '"e1"',
          }),
        }),
      );
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: 2 new tests FAIL (methods don't accept `meta` param yet)

- [ ] **Step 3: Update updateEvent to accept optional meta**

In `CalDavService.ts`, replace the `updateEvent` method with:

```typescript
  async updateEvent(
    calendarId: string,
    uid: string,
    icalString: string,
    meta?: CalendarObjectMeta,
  ): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const objUrl = meta?.url;
      const objEtag = meta?.etag;

      let url: string;
      let etag: string | undefined;
      if (objUrl) {
        url = objUrl;
        etag = objEtag;
      } else {
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const obj = await this.findCalendarObject(client, calendar, uid);
        url = obj.url;
        etag = obj.etag;
      }

      const response = await client.updateCalendarObject({
        calendarObject: { url, etag, data: icalString },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to update event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }

      const parsed = parseIcsEvents(icalString, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found in ICS`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

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
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 4: Update deleteEvent to accept optional meta**

Replace the `deleteEvent` method with:

```typescript
  async deleteEvent(calendarId: string, uid: string, meta?: CalendarObjectMeta): Promise<void> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);

      let url: string;
      let etag: string | undefined;
      if (meta?.url) {
        url = meta.url;
        etag = meta.etag;
      } else {
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const obj = await this.findCalendarObject(client, calendar, uid);
        url = obj.url;
        etag = obj.etag;
      }

      const response = await client.deleteCalendarObject({
        calendarObject: { url, etag },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to delete event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "perf(cal-mcp): skip redundant fetchCalendarObjects when meta is provided"
```

---

### Task 6: Drop post-write re-fetch from createEvent

**Files:**
- Modify: `packages/cal-mcp/src/services/CalDavService.ts`
- Modify: `packages/cal-mcp/src/__tests__/CalDavService.test.ts`

- [ ] **Step 1: Update existing createEvent test**

The existing test at line 210 mocks `parseIcsEvents` for the post-write `getEvent` call. Replace the entire `it("creates a calendar object and returns the created event"` test with:

```typescript
    it("creates a calendar object and returns event built from ICS", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      __mockClient.createCalendarObject.mockResolvedValue({ ok: true });

      // parseIcsEvents called to build EventFull from ICS (no re-fetch)
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

      const result = await service.createEvent(
        "mailbox/Work",
        "BEGIN:VCALENDAR\nEND:VCALENDAR",
        "new-evt",
      );

      expect(result.uid).toBe("new-evt");
      expect(result.title).toBe("New Event");
      expect(result.calendar_id).toBe("mailbox/Work");
      expect(__mockClient.createCalendarObject).toHaveBeenCalled();
      // Should NOT call fetchCalendarObjects (no post-write re-fetch)
      expect(__mockClient.fetchCalendarObjects).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: FAIL (createEvent still calls `this.getEvent()` which calls fetchCalendarObjects)

- [ ] **Step 3: Replace createEvent post-write re-fetch with local ICS parsing**

Replace `createEvent` in `CalDavService.ts`:

```typescript
  async createEvent(calendarId: string, icalString: string, uid: string): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const response = await client.createCalendarObject({
        calendar,
        iCalString: icalString,
        filename: `${uid}.ics`,
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to create event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }

      const parsed = parseIcsEvents(icalString, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found in ICS`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

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
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cal-mcp && npx vitest run src/__tests__/CalDavService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cal-mcp/src/services/CalDavService.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "perf(cal-mcp): build EventFull from ICS instead of post-write re-fetch"
```

---

## Chunk 4: Wire Up Handler + Update Existing updateEvent Test

### Task 7: Update handler to use getEventWithMeta and pass meta

**Files:**
- Modify: `packages/cal-mcp/src/tools/calendarTools.ts:501-549`

- [ ] **Step 1: Update the update_event handler**

In `calendarTools.ts`, replace the `update_event` case (lines 501-534):

```typescript
      case "update_event": {
        const span = (args.span as string) ?? "this";
        const { event: existing, meta } = await service.getEventWithMeta(
          args.calendar as string,
          args.uid as string,
        );

        if (existing.is_recurring && (span === "this" || span === "future")) {
          return error(
            "not_implemented",
            "Recurring event instance modification is not yet supported",
          );
        }

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

- [ ] **Step 2: Add `CalendarObjectMeta` to the import on line 4**

In `calendarTools.ts`, update line 4:

```typescript
import type { CalDavService, CalendarObjectMeta, EventSummary } from "../services/CalDavService.js";
```

- [ ] **Step 3: Update the delete_event handler for span=this/future path**

Replace the `delete_event` case (lines 536-549):

```typescript
      case "delete_event": {
        const span = (args.span as string) ?? "all";
        let meta: CalendarObjectMeta | undefined;
        if (span === "this" || span === "future") {
          const result = await service.getEventWithMeta(
            args.calendar as string,
            args.uid as string,
          );
          if (result.event.is_recurring) {
            return error(
              "not_implemented",
              "Recurring event instance deletion is not yet supported",
            );
          }
          meta = result.meta;
        }
        await service.deleteEvent(args.calendar as string, args.uid as string, meta);
        return ok({ deleted: true, uid: args.uid });
      }
```

- [ ] **Step 4: Update the existing updateEvent test mock setup**

The existing `updateEvent` test (line 254) mocks `fetchCalendarObjects` twice (once for findCalendarObject, once for post-write getEvent). Since `updateEvent` now builds from ICS and the handler calls `getEventWithMeta` instead, the mock setup for tests that exercise the handler through the service should be updated. However, the service-level test with `meta` provided (Task 5) already covers the optimized path. The existing service-level test without `meta` still exercises the fallback path and should continue to work — update the mock to not expect the post-write re-fetch:

Replace the existing `updateEvent` → `"updates an existing calendar object and returns the updated event"` test:

```typescript
    it("updates an existing calendar object and returns the updated event", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");

      // findCalendarObject call
      (parseIcsEvents as any).mockReturnValueOnce([{ uid: "evt-1" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValueOnce([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      __mockClient.updateCalendarObject.mockResolvedValue({ ok: true });

      // parseIcsEvents for building EventFull from ICS (no re-fetch)
      const fullEvent = {
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
      };
      (parseIcsEvents as any).mockReturnValueOnce([fullEvent]);

      const result = await service.updateEvent(
        "mailbox/Work",
        "evt-1",
        "BEGIN:VCALENDAR\nUPDATED\nEND:VCALENDAR",
      );

      expect(result.uid).toBe("evt-1");
      expect(result.title).toBe("Updated Meeting");
      expect(__mockClient.updateCalendarObject).toHaveBeenCalled();
    });
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/cal-mcp && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Run full project tests**

Run: `npm test`
Expected: All tests PASS across all packages

- [ ] **Step 7: Commit**

```bash
git add packages/cal-mcp/src/tools/calendarTools.ts packages/cal-mcp/src/__tests__/CalDavService.test.ts
git commit -m "perf(cal-mcp): wire handler to use getEventWithMeta and pass meta to writes"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors (fix any formatting issues with `npm run format`)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Build all packages**

Run: `npm run build`
Expected: clean build
