import { describe, expect, it } from "vitest";
import { generateEventIcs, parseIcsEvents } from "../ical.js";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTART:20260310T140000Z
DTEND:20260310T150000Z
SUMMARY:Team Meeting
LOCATION:Office Room A
DESCRIPTION:Weekly standup
STATUS:CONFIRMED
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;

const MULTI_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1@example.com
DTSTART:20260310T090000Z
DTEND:20260310T100000Z
SUMMARY:Morning Meeting
END:VEVENT
BEGIN:VEVENT
UID:evt-2@example.com
DTSTART:20260310T140000Z
DTEND:20260310T150000Z
SUMMARY:Afternoon Meeting
END:VEVENT
END:VCALENDAR`;

const ALL_DAY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-1@example.com
DTSTART;VALUE=DATE:20260310
DTEND;VALUE=DATE:20260311
SUMMARY:Company Holiday
END:VEVENT
END:VCALENDAR`;

describe("parseIcsEvents", () => {
  it("parses a single VEVENT from iCalendar string", () => {
    const events = parseIcsEvents(SAMPLE_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("evt-1@example.com");
    expect(events[0].title).toBe("Team Meeting");
    expect(events[0].location).toBe("Office Room A");
    expect(events[0].description).toBe("Weekly standup");
    expect(events[0].status).toBe("confirmed");
    expect(events[0].availability).toBe("busy");
    expect(events[0].all_day).toBe(false);
    expect(events[0].start).toContain("2026-03-10");
    expect(events[0].end).toContain("2026-03-10");
  });

  it("parses multiple VEVENTs from iCalendar string", () => {
    const events = parseIcsEvents(MULTI_EVENT_ICS);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.title).sort()).toEqual(["Afternoon Meeting", "Morning Meeting"]);
  });

  it("returns empty array for iCalendar with no VEVENTs", () => {
    const events = parseIcsEvents("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR");
    expect(events).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    const events = parseIcsEvents("");
    expect(events).toHaveLength(0);
  });

  it("detects all-day events", () => {
    const events = parseIcsEvents(ALL_DAY_ICS);
    expect(events).toHaveLength(1);
    expect(events[0].all_day).toBe(true);
    expect(events[0].title).toBe("Company Holiday");
  });

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
});

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

describe("generateEventIcs", () => {
  it("generates valid iCalendar string with required fields", () => {
    const ics = generateEventIcs({
      title: "Test Event",
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
      title: "Lunch",
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
      title: "Meeting",
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
});
