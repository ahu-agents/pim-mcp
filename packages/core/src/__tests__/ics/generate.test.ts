// packages/core/src/__tests__/ics/generate.test.ts
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { IcsGenerateError } from "../../ics/errors.js";
import { generateEventIcs } from "../../ics/generate.js";
import { parseIcsEvents } from "../../ics/parse-events.js";

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
    expect(() =>
      generateEventIcs({
        title: "Bad",
        start: "2026-05-01T13:00:00.000Z",
        end: "2026-05-01T13:30:00.000Z",
        recurrence_rule: "BAD-RULE",
      }),
    ).toThrow(IcsGenerateError);
  });

  it("throws IcsGenerateError when attendees provided without organizer", () => {
    expect(() =>
      generateEventIcs({
        title: "Bad",
        start: "2026-05-01T13:00:00.000Z",
        end: "2026-05-01T13:30:00.000Z",
        attendees: [{ email: "bob@example.com" }],
      }),
    ).toThrow(IcsGenerateError);
  });

  it("throws IcsGenerateError on invalid date", () => {
    expect(() =>
      generateEventIcs({
        title: "Bad",
        start: "not-a-date",
        end: "2026-05-01T13:30:00.000Z",
      }),
    ).toThrow(IcsGenerateError);
  });
});
