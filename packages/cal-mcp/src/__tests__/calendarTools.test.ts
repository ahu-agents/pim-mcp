import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_TOOLS, handleCalendarTool } from "../tools/calendarTools.js";

const mockService = {
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  getEventWithMeta: vi.fn(),
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

  describe("handleCalendarTool", () => {
    it("list_calendars wraps in { calendars } envelope", async () => {
      mockService.listCalendars.mockResolvedValue([
        {
          calendar_id: "mailbox/Work",
          display_name: "Work",
          color: null,
          source: "mailbox",
          read_only: false,
        },
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
        {
          calendar: "mailbox/Work",
          title: "New Event",
          start: "2026-03-10T14:00:00Z",
          end: "2026-03-10T15:00:00Z",
        },
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
      mockService.getEventWithMeta.mockResolvedValue({
        event: {
          uid: "evt-1",
          title: "Weekly",
          is_recurring: true,
          recurrence_rule: "FREQ=WEEKLY",
        },
        meta: { url: "/cal/evt-1.ics", etag: '"e1"' },
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
        },
        meta: { url: "/cal/evt-1.ics", etag: '"e1"' },
      });
      mockService.updateEvent.mockResolvedValue({
        uid: "evt-1",
        title: "Updated Meeting",
        is_recurring: false,
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

    it("find_free_slots wraps in { slots, count } envelope", async () => {
      mockService.listCalendars.mockResolvedValue([{ calendar_id: "mailbox/Work" }]);
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
