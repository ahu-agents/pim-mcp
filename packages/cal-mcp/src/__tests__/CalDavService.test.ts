import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalDavService } from "../services/CalDavService.js";

// Mock tsdav — same pattern as card-mcp
vi.mock("tsdav", () => {
  const mockClient = {
    login: vi.fn().mockResolvedValue(undefined),
    fetchCalendars: vi.fn().mockResolvedValue([
      {
        displayName: "Work",
        url: "/caldav/work/",
        ctag: "ctag-1",
        components: ["VEVENT"],
      },
      {
        displayName: "Personal",
        url: "/caldav/personal/",
        ctag: "ctag-2",
        components: ["VEVENT"],
      },
    ]),
    fetchCalendarObjects: vi.fn().mockResolvedValue([]),
    createCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
    updateCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
    deleteCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
  };
  return {
    DAVClient: vi.fn().mockImplementation(() => mockClient),
    __mockClient: mockClient,
  };
});

// Mock ical helpers
vi.mock("../ical.js", () => ({
  parseIcsEvents: vi.fn().mockReturnValue([]),
  generateEventIcs: vi.fn().mockReturnValue("BEGIN:VCALENDAR\nEND:VCALENDAR"),
}));

const TEST_CONFIG = {
  accounts: [
    {
      id: "mailbox",
      url: "https://dav.mailbox.org/caldav/",
      username: "user@example.com",
      password: "secret-1",
    },
    {
      id: "nextcloud",
      url: "https://cloud.example.com/remote.php/dav/calendars/miguel/",
      username: "miguel",
      password: "secret-2",
    },
  ],
};

describe("CalDavService", () => {
  let service: CalDavService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CalDavService(TEST_CONFIG);
  });

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

    it("creates DAVClient with correct config per provider", async () => {
      const { DAVClient } = await import("tsdav");
      await service.listCalendars();

      expect(DAVClient).toHaveBeenCalledTimes(2);
      expect(DAVClient).toHaveBeenCalledWith(
        expect.objectContaining({
          serverUrl: "https://dav.mailbox.org/caldav/",
          credentials: {
            username: "user@example.com",
            password: "secret-1",
          },
          authMethod: "Basic",
          defaultAccountType: "caldav",
        }),
      );
      expect(DAVClient).toHaveBeenCalledWith(
        expect.objectContaining({
          serverUrl: "https://cloud.example.com/remote.php/dav/calendars/miguel/",
        }),
      );
    });
  });

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

    it("throws CalendarError for unknown provider", async () => {
      await expect(
        service.listEvents("unknown/cal", "2026-03-10T00:00:00Z", "2026-03-10T23:59:59Z"),
      ).rejects.toThrow("Unknown provider");
    });
  });

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

    it("throws CalendarError when event not found", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");
      (parseIcsEvents as any).mockReturnValue([{ uid: "other-event", summary: "Other" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "...", url: "/cal/other.ics", etag: '"e1"' },
      ]);

      await expect(service.getEvent("mailbox/Work", "evt-missing")).rejects.toThrow("not found");
    });
  });

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

      // getEvent fetch-after-write: findCalendarObject calls parseIcsEvents (match uid)
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
      // findCalendarObject parse + getEvent parse on same object
      (parseIcsEvents as any).mockReturnValueOnce([fullEvent]);
      (parseIcsEvents as any).mockReturnValueOnce([fullEvent]);
      __mockClient.fetchCalendarObjects.mockResolvedValueOnce([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e2"' },
      ]);

      const result = await service.updateEvent("mailbox/Work", "evt-1", "BEGIN:VCALENDAR\nUPDATED\nEND:VCALENDAR");

      expect(result.uid).toBe("evt-1");
      expect(result.title).toBe("Updated Meeting");
      expect(__mockClient.updateCalendarObject).toHaveBeenCalled();
    });

    it("throws CalendarError when event to update is not found", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");
      (parseIcsEvents as any).mockReturnValue([]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([]);

      await expect(service.updateEvent("mailbox/Work", "missing", "...")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("deleteEvent", () => {
    it("deletes a calendar object by UID", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = await import("../ical.js");
      (parseIcsEvents as any).mockReturnValue([{ uid: "evt-1" }]);
      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "...", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);

      await service.deleteEvent("mailbox/Work", "evt-1");

      expect(__mockClient.deleteCalendarObject).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarObject: expect.objectContaining({
            url: "/cal/evt-1.ics",
            etag: '"e1"',
          }),
        }),
      );
    });
  });

  describe("findFreeSlots", () => {
    it("finds free slots between events", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
        { data: "ics-1", url: "/cal/evt-1.ics", etag: '"e1"' },
      ]);
      // Each object parsed returns one event
      parseIcsEvents
        .mockReturnValueOnce([
          {
            uid: "evt-0",
            title: "Morning",
            start: "2026-03-10T09:00:00.000Z",
            end: "2026-03-10T10:00:00.000Z",
            all_day: false,
            status: "confirmed",
            availability: "busy",
          },
        ])
        .mockReturnValueOnce([
          {
            uid: "evt-1",
            title: "Afternoon",
            start: "2026-03-10T14:00:00.000Z",
            end: "2026-03-10T15:00:00.000Z",
            all_day: false,
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

      // Free: 08:00-09:00, 10:00-14:00, 15:00-17:00 — all >= 30 min
      expect(slots.length).toBeGreaterThanOrEqual(3);
      expect(slots[0].duration).toBeGreaterThanOrEqual(30);
    });

    it("ignores free events (availability: free)", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "All Day Free",
          start: "2026-03-10T08:00:00.000Z",
          end: "2026-03-10T17:00:00.000Z",
          all_day: false,
          status: "confirmed",
          availability: "free",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
      );

      // Free event doesn't block — entire range is free
      expect(slots.length).toBe(1);
      expect(slots[0].duration).toBe(540); // 9 hours
    });

    it("treats tentative as busy by default", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "Maybe Meeting",
          start: "2026-03-10T09:00:00.000Z",
          end: "2026-03-10T17:00:00.000Z",
          all_day: false,
          status: "tentative",
          availability: "busy",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
      );

      // Tentative blocks by default — only 08:00-09:00 is free
      expect(slots).toHaveLength(1);
      expect(slots[0].duration).toBe(60);
    });

    it("ignores tentative events when ignoreTentative is true", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: "ics-0", url: "/cal/evt-0.ics", etag: '"e0"' },
      ]);
      parseIcsEvents.mockReturnValue([
        {
          uid: "evt-0",
          title: "Maybe Meeting",
          start: "2026-03-10T09:00:00.000Z",
          end: "2026-03-10T17:00:00.000Z",
          all_day: false,
          status: "tentative",
          availability: "busy",
        },
      ]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T08:00:00Z",
        "2026-03-10T17:00:00Z",
        30,
        { ignoreTentative: true },
      );

      // Tentative ignored — entire range is free
      expect(slots).toHaveLength(1);
      expect(slots[0].duration).toBe(540);
    });

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

    it("sorts preferred-hours slots first", async () => {
      const { __mockClient } = (await import("tsdav")) as any;
      const { parseIcsEvents } = (await import("../ical.js")) as any;

      __mockClient.fetchCalendarObjects.mockResolvedValue([]);
      parseIcsEvents.mockReturnValue([]);

      const slots = await service.findFreeSlots(
        ["mailbox/Work"],
        "2026-03-10T06:00:00Z",
        "2026-03-10T20:00:00Z",
        30,
        { preferredStart: "09:00", preferredEnd: "17:00" },
      );

      // Should have slots, with preferred-hours slots first
      expect(slots.length).toBeGreaterThanOrEqual(1);
      // First slot should start at or after 09:00
      const firstSlotHour = new Date(slots[0].start).getUTCHours();
      expect(firstSlotHour).toBeGreaterThanOrEqual(9);
    });
  });
});
