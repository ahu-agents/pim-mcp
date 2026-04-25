import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { normalizeRecurrenceRule } from "../../ics/rrule.js";

describe("normalizeRecurrenceRule", () => {
  it("returns the rule unchanged when valid", () => {
    expect(normalizeRecurrenceRule("FREQ=WEEKLY;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=MO");
  });
  it("strips the RRULE: prefix (case-insensitive)", () => {
    expect(normalizeRecurrenceRule("RRULE:FREQ=DAILY")).toBe("FREQ=DAILY");
    expect(normalizeRecurrenceRule("rrule:FREQ=DAILY")).toBe("FREQ=DAILY");
  });
  it("returns null for invalid input", () => {
    expect(normalizeRecurrenceRule("")).toBeNull();
    expect(normalizeRecurrenceRule("not-a-rrule")).toBeNull();
    expect(normalizeRecurrenceRule("FREQ=BOGUS")).toBeNull();
    expect(normalizeRecurrenceRule("FREQ=WEEKLY\nBYDAY=MO")).toBeNull(); // CRLF inside
  });
  it("accepts all RFC 5545 frequencies", () => {
    for (const freq of ["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
      expect(normalizeRecurrenceRule(`FREQ=${freq}`)).toBe(`FREQ=${freq}`);
    }
  });
});
