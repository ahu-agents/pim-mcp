import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import {
  addExdateToIcs,
  combineIcsComponents,
  createExceptionComponent,
} from "../../ics/components.js";
import { IcsParseError } from "../../ics/errors.js";
import { generateEventIcs } from "../../ics/generate.js";

const masterIcs = generateEventIcs({
  title: "Weekly standup",
  start: "2026-05-04T13:00:00.000Z",
  end: "2026-05-04T13:30:00.000Z",
  uid: "components-test@pim-core",
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
  organizer: { email: "alice@example.com", name: "Alice Smith" },
  attendees: [{ email: "bob@example.com" }],
});

describe("createExceptionComponent", () => {
  it("creates a VEVENT block with RECURRENCE-ID and applies overrides", () => {
    const ex = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      {
        title: "Standup (moved)",
        start: "2026-05-11T15:00:00.000Z",
        end: "2026-05-11T15:30:00.000Z",
      },
      false,
    );
    expect(ex).toContain("BEGIN:VEVENT");
    expect(ex).toContain("END:VEVENT");
    expect(ex).toMatch(/RECURRENCE-ID/);
    expect(ex).toContain("Standup (moved)");
  });
});

describe("combineIcsComponents", () => {
  it("inserts the exception VEVENT into the master VCALENDAR", () => {
    const ex = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "Standup (moved)" },
      false,
    );
    const combined = combineIcsComponents(masterIcs, ex);
    expect(combined.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(combined).toContain("Standup (moved)");
  });

  it("replaces a prior exception with the same RECURRENCE-ID", () => {
    const ex1 = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "First override" },
      false,
    );
    const intermediate = combineIcsComponents(masterIcs, ex1);
    const ex2 = createExceptionComponent(
      masterIcs,
      "vevent",
      "2026-05-11T13:00:00.000Z",
      { title: "Second override" },
      false,
    );
    const combined = combineIcsComponents(intermediate, ex2);
    expect(combined.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(combined).not.toContain("First override");
    expect(combined).toContain("Second override");
  });
});

describe("addExdateToIcs", () => {
  it("appends an EXDATE for the given occurrence", () => {
    const updated = addExdateToIcs(masterIcs, "2026-05-11T13:00:00.000Z", false);
    expect(updated).toMatch(/EXDATE/);
  });
  it("is idempotent for the same date", () => {
    const once = addExdateToIcs(masterIcs, "2026-05-11T13:00:00.000Z", false);
    const twice = addExdateToIcs(once, "2026-05-11T13:00:00.000Z", false);
    expect((twice.match(/EXDATE/g) ?? []).length).toBe((once.match(/EXDATE/g) ?? []).length);
  });

  it("is idempotent for all-day EXDATE across DST boundaries (compare YYYY-MM-DD)", () => {
    // March 15, 2026 falls a week after US DST starts (Mar 8). A naive epoch-ms
    // comparison would interpret a date-only value differently when local tz
    // changes offset; the YMD-based check protects against that.
    const dailyMaster = generateEventIcs({
      title: "All-day daily",
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-03-02T00:00:00.000Z",
      uid: "all-day-exdate@pim-core",
      all_day: true,
      recurrence_rule: "FREQ=DAILY;COUNT=30",
    });
    const once = addExdateToIcs(dailyMaster, "2026-03-15T00:00:00.000Z", true);
    const twice = addExdateToIcs(once, "2026-03-15T00:00:00.000Z", true);
    expect((twice.match(/EXDATE/g) ?? []).length).toBe((once.match(/EXDATE/g) ?? []).length);
  });
});

describe("combineIcsComponents — defensive guards", () => {
  it("rejects a full VCALENDAR-wrapped exception component", () => {
    const wrapped = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x@pim-core\r\nDTSTAMP:20260101T000000Z\r\nRECURRENCE-ID:20260511T130000Z\r\nDTSTART:20260511T140000Z\r\nDTEND:20260511T143000Z\r\nSUMMARY:Bad shape\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(() => combineIcsComponents(masterIcs, wrapped)).toThrow(IcsParseError);
  });
});
