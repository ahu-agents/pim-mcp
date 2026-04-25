import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { generateEventIcs } from "../../ics/generate.js";

describe("generateEventIcs — VTIMEZONE emission (item 2)", () => {
  it("emits a VTIMEZONE block when props.timezone is provided", () => {
    const ics = generateEventIcs({
      title: "Tz event",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T14:00:00.000Z",
      uid: "vtz-test@pim-core",
      timezone: "America/New_York",
    });
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/New_York");
    expect(ics).toContain("END:VTIMEZONE");
    expect(ics).toMatch(/DTSTART;TZID=America\/New_York:/);
  });

  it("does not emit VTIMEZONE when no timezone is provided", () => {
    const ics = generateEventIcs({
      title: "UTC event",
      start: "2026-05-01T13:00:00.000Z",
      end: "2026-05-01T14:00:00.000Z",
      uid: "no-vtz-test@pim-core",
    });
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });
});
