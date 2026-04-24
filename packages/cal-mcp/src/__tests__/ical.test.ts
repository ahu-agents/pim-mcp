import { describe, expect, it } from "vitest";
import {
  addExdateToIcs,
  combineIcsComponents,
  createExceptionVevent,
  extractDtstartWallClockFromIcs,
  extractExdatesFromIcs,
  generateEventIcs,
  normalizeRecurrenceRule,
  parseIcsEvents,
} from "../ical.js";

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

  it("strips mailto: URI scheme case-insensitively from attendee + organizer email", () => {
    // ical-generator emits uppercase 'MAILTO:' which leaked past the prior
    // case-sensitive strip. RFC 5545 / RFC 3986: URI schemes are case-insensitive.
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:mailto-case-test",
      "DTSTART:20260501T140000Z",
      "DTEND:20260501T150000Z",
      "SUMMARY:Test",
      "ORGANIZER;CN=Alice:MAILTO:alice@example.com",
      "ATTENDEE;CN=Bob;ROLE=REQ-PARTICIPANT:MAILTO:bob@example.com",
      "ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT:Mailto:carol@example.com",
      "ATTENDEE;CN=Dan;ROLE=REQ-PARTICIPANT:mailto:dan@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcsEvents(ics);
    expect(events[0].organizer).toEqual({ email: "alice@example.com", name: "Alice" });
    expect(events[0].attendees.map((a) => a.email)).toEqual([
      "bob@example.com",
      "carol@example.com",
      "dan@example.com",
    ]);
  });

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
    // Note: node-ical uses UID as object key, so exception VEVENTs must have a
    // distinct key to be independently accessible. In practice, CalDAV servers
    // store exceptions as separate .ics objects (separate fetchCalendarObjects
    // results), each with a unique URL but the same UID. We simulate that here
    // by giving the exception a unique UID so node-ical doesn't collapse it.
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
      "UID:weekly-meeting-exception-20260305",
      "RECURRENCE-ID:20260305T100000Z",
      "DTSTART:20260305T140000Z",
      "DTEND:20260305T150000Z",
      "SUMMARY:Rescheduled Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcsEvents(icsWithException);
    const exception = events.find((e) => e.title === "Rescheduled Standup");
    expect(exception).toBeDefined();
    expect(exception!.occurrence_date).toBe("2026-03-05T10:00:00.000Z");
  });

  describe("recurring events with TZID DTSTART", () => {
    // 9:00 AM America/Los_Angeles on the 3rd Friday of every month, starting Jul 18 2025
    const laMonthlyIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:la-monthly@example.com",
      "DTSTAMP:20250718T160000Z",
      "DTSTART;TZID=America/Los_Angeles:20250718T090000",
      "DTEND;TZID=America/Los_Angeles:20250718T093000",
      "RRULE:FREQ=MONTHLY;BYDAY=+3FR",
      "SUMMARY:LA Monthly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    it("expands TZID DTSTART correctly across PDT (April)", () => {
      const events = parseIcsEvents(laMonthlyIcs, {
        start: "2026-04-01T00:00:00Z",
        end: "2026-05-01T00:00:00Z",
      });
      expect(events).toHaveLength(1);
      // Apr 17, 2026 is 3rd Friday. 9 AM PDT (UTC-7) = 16:00 UTC.
      expect(events[0].start).toBe("2026-04-17T16:00:00.000Z");
      expect(events[0].end).toBe("2026-04-17T16:30:00.000Z");
      expect(events[0].occurrence_date).toBe("2026-04-17T16:00:00.000Z");
    });

    it("expands TZID DTSTART correctly across PST (January, post-DST-end)", () => {
      const events = parseIcsEvents(laMonthlyIcs, {
        start: "2026-01-01T00:00:00Z",
        end: "2026-02-01T00:00:00Z",
      });
      expect(events).toHaveLength(1);
      // Jan 16, 2026 is 3rd Friday. 9 AM PST (UTC-8) = 17:00 UTC.
      expect(events[0].start).toBe("2026-01-16T17:00:00.000Z");
      expect(events[0].end).toBe("2026-01-16T17:30:00.000Z");
    });

    it("expands TZID DTSTART correctly at the original occurrence (July)", () => {
      const events = parseIcsEvents(laMonthlyIcs, {
        start: "2025-07-01T00:00:00Z",
        end: "2025-08-01T00:00:00Z",
      });
      expect(events).toHaveLength(1);
      // Jul 18, 2025 is 3rd Friday. 9 AM PDT = 16:00 UTC.
      expect(events[0].start).toBe("2025-07-18T16:00:00.000Z");
    });

    it("formats TZID occurrences into the requested timezone (Chicago)", () => {
      const events = parseIcsEvents(
        laMonthlyIcs,
        { start: "2026-04-01T00:00:00Z", end: "2026-05-01T00:00:00Z" },
        "America/Chicago",
      );
      expect(events).toHaveLength(1);
      // 9 AM LA = 11 AM Chicago (both PDT and CDT in April).
      expect(events[0].start).toBe("2026-04-17T11:00:00-05:00");
    });
  });
});

describe("extractDtstartWallClockFromIcs", () => {
  it("extracts TZID and wall-clock time from a DTSTART with TZID param", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:la-monthly@example.com",
      "DTSTART;TZID=America/Los_Angeles:20250718T090000",
      "DTEND;TZID=America/Los_Angeles:20250718T093000",
      "RRULE:FREQ=MONTHLY;BYDAY=+3FR",
      "SUMMARY:LA Monthly",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractDtstartWallClockFromIcs(ics, "la-monthly@example.com");
    expect(result).toEqual({
      tzid: "America/Los_Angeles",
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it("returns tzid undefined for a UTC DTSTART (no TZID param)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:utc-event@example.com",
      "DTSTART:20260417T140000Z",
      "DTEND:20260417T150000Z",
      "SUMMARY:UTC Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractDtstartWallClockFromIcs(ics, "utc-event@example.com");
    expect(result).toEqual({ tzid: undefined, hour: 14, minute: 0, second: 0 });
  });

  it("matches the correct VEVENT when multiple are present", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:first@example.com",
      "DTSTART;TZID=America/New_York:20260101T070000",
      "DTEND;TZID=America/New_York:20260101T080000",
      "SUMMARY:First",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:second@example.com",
      "DTSTART;TZID=Europe/London:20260101T180000",
      "DTEND;TZID=Europe/London:20260101T190000",
      "SUMMARY:Second",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractDtstartWallClockFromIcs(ics, "second@example.com");
    expect(result).toEqual({
      tzid: "Europe/London",
      hour: 18,
      minute: 0,
      second: 0,
    });
  });

  it("returns null when UID is not found", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:a@example.com",
      "DTSTART:20260101T000000Z",
      "DTEND:20260101T010000Z",
      "SUMMARY:A",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractDtstartWallClockFromIcs(ics, "missing@example.com");
    expect(result).toBeNull();
  });

  it("handles RFC 5545 line folding in the VEVENT block", () => {
    // Fold DTSTART across two lines (continuation line starts with space).
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:folded@example.com",
      "DTSTART;TZID=America/Los_Ang",
      " eles:20250718T090000",
      "DTEND;TZID=America/Los_Angeles:20250718T093000",
      "SUMMARY:Folded",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractDtstartWallClockFromIcs(ics, "folded@example.com");
    expect(result).toEqual({
      tzid: "America/Los_Angeles",
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it("is resilient to node-ical TZID mis-resolution (regression for container bug)", () => {
    // Regression: In some Node/tzdata configurations node-ical resolves TZID
    // incorrectly, causing vevent.start to represent a different UTC instant
    // than intended. parseIcsEvents must still produce correct occurrences by
    // reading wall-clock time from the raw ICS. This test exercises the
    // recurring-event path end-to-end and asserts the correct UTC instant,
    // regardless of how node-ical interpreted the DTSTART.
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:kathy-chisme@example.com",
      "DTSTAMP:20250718T160000Z",
      "DTSTART;TZID=America/Los_Angeles:20250718T090000",
      "DTEND;TZID=America/Los_Angeles:20250718T093000",
      "RRULE:FREQ=MONTHLY;BYDAY=+3FR",
      "SUMMARY:Kathy / Miguel monthly chisme",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcsEvents(ics, {
      start: "2026-04-17T00:00:00Z",
      end: "2026-04-18T00:00:00Z",
    });
    expect(events).toHaveLength(1);
    // 9 AM PDT on Apr 17 2026 = 16:00 UTC. Not 11:00Z (the container bug).
    expect(events[0].start).toBe("2026-04-17T16:00:00.000Z");
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
    expect(ics).toContain("STATUS:CONFIRMED");
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

  it("includes attendees when provided (email only, no CN)", () => {
    const ics = generateEventIcs({
      title: "Meeting",
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
      attendees: [{ email: "bob@example.com" }],
    });
    expect(ics).toContain("bob@example.com");
    // CN is intentionally never emitted — display name is resolved server-side
    expect(ics).not.toContain("CN=");
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

  it("generates ICS with relative alarm", () => {
    const ics = generateEventIcs({
      title: "Alarm Test",
      start: "2026-03-10T14:00:00Z",
      end: "2026-03-10T15:00:00Z",
      alarms: [{ type: "relative", trigger: -900 }],
    });
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("END:VALARM");
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

  describe("organizer + attendees", () => {
    it("emits ORGANIZER line when organizer prop is provided", () => {
      const ics = generateEventIcs({
        title: "Meeting",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        organizer: { email: "me@example.com" },
        attendees: [{ email: "bob@example.com" }],
      });
      expect(ics).toMatch(/ORGANIZER[^\r\n]*mailto:me@example\.com/i);
      expect(ics).toMatch(/ATTENDEE[^\r\n]*mailto:bob@example\.com/i);
    });

    it("falls back to email local-part for CN when organizer name is absent", () => {
      const ics = generateEventIcs({
        title: "Meeting",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        organizer: { email: "miguel.rios@mailbox.org" },
      });
      expect(ics).toContain('CN="miguel.rios"');
    });

    it("uses provided organizer name when given", () => {
      const ics = generateEventIcs({
        title: "Meeting",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        organizer: { email: "me@example.com", name: "Miguel Rios" },
      });
      expect(ics).toContain('CN="Miguel Rios"');
    });

    it("does not emit ORGANIZER when organizer prop is absent", () => {
      const ics = generateEventIcs({
        title: "Solo Task",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
      });
      expect(ics).not.toMatch(/^ORGANIZER/m);
    });

    it("round-trip: organizer generated then parsed preserves email", () => {
      const ics = generateEventIcs({
        title: "Meeting",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        organizer: { email: "me@example.com" },
      });
      const parsed = parseIcsEvents(ics);
      expect(parsed[0].organizer?.email).toBe("me@example.com");
    });
  });

  describe("availability (free/busy transparency)", () => {
    it("emits TRANSP:TRANSPARENT when availability is 'free'", () => {
      const ics = generateEventIcs({
        title: "Focus Block",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        availability: "free",
      });
      expect(ics).toContain("TRANSP:TRANSPARENT");
      expect(ics).not.toContain("TRANSP:OPAQUE");
    });

    it("emits TRANSP:OPAQUE when availability is 'busy'", () => {
      const ics = generateEventIcs({
        title: "Meeting",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        availability: "busy",
      });
      expect(ics).toContain("TRANSP:OPAQUE");
    });

    it("round-trip: availability=free generates and parses back as 'free'", () => {
      const ics = generateEventIcs({
        title: "Focus",
        start: "2026-03-10T14:00:00Z",
        end: "2026-03-10T15:00:00Z",
        availability: "free",
      });
      const parsed = parseIcsEvents(ics);
      expect(parsed[0].availability).toBe("free");
    });
  });
});

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
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      {
        title: "Special Standup",
      },
      false,
    );
    expect(result).toContain("BEGIN:VEVENT");
    expect(result).toContain("END:VEVENT");
    expect(result).toContain("UID:weekly-meeting");
    expect(result).toContain("RECURRENCE-ID:20260305T100000Z");
    expect(result).toContain("SUMMARY:Special Standup");
    // Inherits non-overridden properties
    expect(result).toContain("LOCATION:Room A");
  });

  it("overrides start and end times", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      {
        start: "2026-03-05T14:00:00.000Z",
        end: "2026-03-05T15:00:00.000Z",
      },
      false,
    );
    expect(result).toContain("DTSTART:20260305T140000Z");
    expect(result).toContain("DTEND:20260305T150000Z");
  });

  it("uses original occurrence time when start/end not overridden", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      {
        title: "Renamed",
      },
      false,
    );
    // Should use the occurrence date's time, not the master's original DTSTART
    expect(result).toContain("DTSTART:20260305T100000Z");
    expect(result).toContain("DTEND:20260305T110000Z");
  });

  it("handles all-day events with VALUE=DATE format", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05",
      {
        title: "All Day Exception",
      },
      true,
    );
    expect(result).toContain("RECURRENCE-ID;VALUE=DATE:20260305");
    expect(result).toContain("DTSTART;VALUE=DATE:");
  });

  it("includes SEQUENCE property", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      {
        title: "Updated",
      },
      false,
    );
    expect(result).toMatch(/SEQUENCE:\d+/);
  });

  it("emits ORGANIZER line from overrides when attendees are added", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      {
        attendees: [{ email: "alice@example.com" }],
        organizer: { email: "me@example.com" },
      },
      false,
    );
    expect(result).toMatch(/ORGANIZER[^\r\n]*mailto:me@example\.com/i);
    expect(result).toContain("ATTENDEE:mailto:alice@example.com");
  });

  it("preserves master ORGANIZER when no override is given", () => {
    const masterWithOrganizer = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:weekly-meeting",
      "DTSTART:20260101T100000Z",
      "DTEND:20260101T110000Z",
      "RRULE:FREQ=WEEKLY;COUNT=52",
      "SUMMARY:Weekly Standup",
      "ORGANIZER;CN=Alice:MAILTO:alice@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = createExceptionVevent(
      masterWithOrganizer,
      "2026-03-05T10:00:00.000Z",
      { title: "Renamed" },
      false,
    );
    expect(result).toMatch(/ORGANIZER[^\r\n]*mailto:alice@example\.com/i);
  });

  it("emits TRANSP line for availability overrides", () => {
    const result = createExceptionVevent(
      masterIcs,
      "2026-03-05T10:00:00.000Z",
      { availability: "free" },
      false,
    );
    expect(result).toContain("TRANSP:TRANSPARENT");
  });

  it("preserves master TRANSP when no availability override is given", () => {
    const masterBusy = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:weekly-meeting",
      "DTSTART:20260101T100000Z",
      "DTEND:20260101T110000Z",
      "RRULE:FREQ=WEEKLY;COUNT=52",
      "SUMMARY:Weekly Standup",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = createExceptionVevent(
      masterBusy,
      "2026-03-05T10:00:00.000Z",
      { title: "Renamed" },
      false,
    );
    expect(result).toContain("TRANSP:OPAQUE");
  });
});

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

describe("extractExdatesFromIcs", () => {
  it("returns an empty Set when the VEVENT has no EXDATE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:no-exdate@example.com",
      "DTSTART:20260101T140000Z",
      "DTEND:20260101T150000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "no-exdate@example.com");
    expect(result.size).toBe(0);
  });

  it("parses a UTC EXDATE (Z suffix) to the correct UTC millis", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:utc-exdate@example.com",
      "DTSTART:20260101T140000Z",
      "DTEND:20260101T150000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260115T140000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "utc-exdate@example.com");
    expect(result.size).toBe(1);
    expect(result.has(Date.UTC(2026, 0, 15, 14, 0, 0))).toBe(true);
  });

  it("parses an EXDATE with TZID through wallClockInTzToUtc", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:tz-exdate@example.com",
      "DTSTART;TZID=America/Los_Angeles:20260117T090000",
      "DTEND;TZID=America/Los_Angeles:20260117T093000",
      "RRULE:FREQ=MONTHLY;BYDAY=+3FR",
      "EXDATE;TZID=America/Los_Angeles:20260417T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "tz-exdate@example.com");
    // 9 AM PDT on Apr 17 = 16:00 UTC
    expect(result.has(Date.UTC(2026, 3, 17, 16, 0, 0))).toBe(true);
  });

  it("parses comma-separated EXDATE values into multiple entries", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:multi-exdate@example.com",
      "DTSTART:20260101T140000Z",
      "DTEND:20260101T150000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260115T140000Z,20260122T140000Z,20260129T140000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "multi-exdate@example.com");
    expect(result.size).toBe(3);
    expect(result.has(Date.UTC(2026, 0, 15, 14, 0, 0))).toBe(true);
    expect(result.has(Date.UTC(2026, 0, 22, 14, 0, 0))).toBe(true);
    expect(result.has(Date.UTC(2026, 0, 29, 14, 0, 0))).toBe(true);
  });

  it("accumulates across multiple EXDATE lines on one VEVENT", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:multiline-exdate@example.com",
      "DTSTART:20260101T140000Z",
      "DTEND:20260101T150000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260115T140000Z",
      "EXDATE:20260122T140000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "multiline-exdate@example.com");
    expect(result.size).toBe(2);
  });

  it("parses VALUE=DATE EXDATE (all-day) as UTC midnight", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:allday-exdate@example.com",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "RRULE:FREQ=WEEKLY",
      "EXDATE;VALUE=DATE:20260115",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = extractExdatesFromIcs(ics, "allday-exdate@example.com");
    expect(result.has(Date.UTC(2026, 0, 15))).toBe(true);
  });

  it("isolates EXDATEs per UID when multiple VEVENTs exist", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:first@example.com",
      "DTSTART:20260101T140000Z",
      "DTEND:20260101T150000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260115T140000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:second@example.com",
      "DTSTART:20260101T180000Z",
      "DTEND:20260101T190000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260122T180000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const first = extractExdatesFromIcs(ics, "first@example.com");
    const second = extractExdatesFromIcs(ics, "second@example.com");
    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
    expect(first.has(Date.UTC(2026, 0, 15, 14, 0, 0))).toBe(true);
    expect(second.has(Date.UTC(2026, 0, 22, 18, 0, 0))).toBe(true);
  });
});

describe("parseIcsEvents — EXDATE filtering in recurrence expansion", () => {
  it("excludes a cancelled occurrence from list_events results (UTC EXDATE)", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:weekly-with-skip@example.com",
      "DTSTAMP:20260101T140000Z",
      "DTSTART:20260107T140000Z",
      "DTEND:20260107T150000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      "EXDATE:20260121T140000Z",
      "SUMMARY:Weekly Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcsEvents(ics, {
      start: "2026-01-07T00:00:00Z",
      end: "2026-02-01T00:00:00Z",
    });
    // Without the fix: 4 Wednesdays (Jan 7, 14, 21, 28). With fix: 3 (Jan 21 skipped).
    expect(events).toHaveLength(3);
    const starts = events.map((e) => e.start);
    expect(starts).toContain("2026-01-07T14:00:00.000Z");
    expect(starts).toContain("2026-01-14T14:00:00.000Z");
    expect(starts).not.toContain("2026-01-21T14:00:00.000Z");
    expect(starts).toContain("2026-01-28T14:00:00.000Z");
  });

  it("excludes a cancelled occurrence with TZID EXDATE matching TZID DTSTART", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:la-skip@example.com",
      "DTSTAMP:20250718T160000Z",
      "DTSTART;TZID=America/Los_Angeles:20250718T090000",
      "DTEND;TZID=America/Los_Angeles:20250718T093000",
      "RRULE:FREQ=MONTHLY;BYDAY=+3FR",
      "EXDATE;TZID=America/Los_Angeles:20260417T090000",
      "SUMMARY:LA Monthly w/ skip",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    // Query a window covering two occurrences: March and April 2026.
    const events = parseIcsEvents(ics, {
      start: "2026-03-01T00:00:00Z",
      end: "2026-05-01T00:00:00Z",
    });
    expect(events).toHaveLength(1);
    // April 17 (the 3rd Friday) is cancelled, so only March 20 should remain.
    expect(events[0].start).toBe("2026-03-20T16:00:00.000Z");
  });
});

describe("normalizeRecurrenceRule", () => {
  it("accepts a bare FREQ rule", () => {
    expect(normalizeRecurrenceRule("FREQ=WEEKLY")).toBe("FREQ=WEEKLY");
  });

  it("accepts a complex rule with multiple params", () => {
    expect(normalizeRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10",
    );
  });

  it("strips an optional RRULE: prefix", () => {
    expect(normalizeRecurrenceRule("RRULE:FREQ=MONTHLY;BYDAY=+3FR")).toBe(
      "FREQ=MONTHLY;BYDAY=+3FR",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRecurrenceRule("  FREQ=DAILY  ")).toBe("FREQ=DAILY");
  });

  it("rejects a rule missing FREQ", () => {
    expect(normalizeRecurrenceRule("BYDAY=MO;COUNT=5")).toBeNull();
  });

  it("rejects an unknown frequency", () => {
    expect(normalizeRecurrenceRule("FREQ=FORTNIGHTLY")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeRecurrenceRule("")).toBeNull();
    expect(normalizeRecurrenceRule("   ")).toBeNull();
  });

  it("rejects rules with embedded newlines (ICS line injection defense)", () => {
    expect(normalizeRecurrenceRule("FREQ=DAILY\r\nSUMMARY:hacked")).toBeNull();
  });
});

describe("generateEventIcs — recurrence_rule", () => {
  it("emits an RRULE line when recurrence_rule is provided", () => {
    const ics = generateEventIcs({
      title: "Standup",
      start: "2026-05-04T14:00:00Z",
      end: "2026-05-04T14:30:00Z",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR/);
  });

  it("strips an optional RRULE: prefix on input", () => {
    const ics = generateEventIcs({
      title: "Standup",
      start: "2026-05-04T14:00:00Z",
      end: "2026-05-04T14:30:00Z",
      recurrence_rule: "RRULE:FREQ=WEEKLY",
    });
    // Must end up with exactly one 'RRULE:' prefix (not 'RRULE:RRULE:')
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY/);
    expect(ics).not.toMatch(/RRULE:RRULE:/);
  });

  it("throws on invalid recurrence_rule (missing FREQ)", () => {
    expect(() =>
      generateEventIcs({
        title: "Bad",
        start: "2026-05-04T14:00:00Z",
        end: "2026-05-04T14:30:00Z",
        recurrence_rule: "BYDAY=MO",
      }),
    ).toThrow(/Invalid recurrence_rule/);
  });

  it("does not emit RRULE when recurrence_rule is absent", () => {
    const ics = generateEventIcs({
      title: "Once",
      start: "2026-05-04T14:00:00Z",
      end: "2026-05-04T14:30:00Z",
    });
    expect(ics).not.toMatch(/^RRULE:/m);
  });

  it("generated ICS round-trips through parseIcsEvents as a recurring event", () => {
    const ics = generateEventIcs({
      title: "Weekly Sync",
      start: "2026-05-04T14:00:00Z",
      end: "2026-05-04T14:30:00Z",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
      uid: "sync-1@example.com",
    });
    // Expand two Mondays: May 4 and May 11 (the RRULE base is May 4, a Monday)
    const events = parseIcsEvents(ics, {
      start: "2026-05-04T00:00:00Z",
      end: "2026-05-18T00:00:00Z",
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].is_recurring).toBe(true);
    expect(events[0].recurrence_rule).toMatch(/FREQ=WEEKLY/);
  });
});
