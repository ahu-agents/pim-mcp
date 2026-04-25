import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { IcsGenerateError, IcsParseError } from "../../ics/errors.js";
import "../../ics/_tz-init.js";

describe("IcsParseError", () => {
  it("preserves the cause and a message", () => {
    const cause = new Error("underlying ical.js error");
    const err = new IcsParseError("Invalid ICS content", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Invalid ICS content");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("IcsParseError");
  });
});

describe("IcsGenerateError", () => {
  it("preserves the cause and a message", () => {
    const cause = new Error("invalid input");
    const err = new IcsGenerateError("Cannot generate", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Cannot generate");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("IcsGenerateError");
  });
});

describe("timezone init", () => {
  it("registers America/New_York", () => {
    expect(ICAL.TimezoneService.has("America/New_York")).toBe(true);
  });
  it("registers Europe/Berlin", () => {
    expect(ICAL.TimezoneService.has("Europe/Berlin")).toBe(true);
  });
});
