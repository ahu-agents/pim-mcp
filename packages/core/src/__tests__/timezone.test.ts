import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInTimezone, getTimezone, parseTimestamp } from "../timezone.js";

describe("getTimezone", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns OS timezone by default", () => {
    const tz = getTimezone();
    // IANA timezone: "Area/Location" (e.g., "America/Chicago") or bare "UTC"
    expect(tz).toMatch(/^([A-Za-z]+\/[A-Za-z_]+|UTC)$/);
  });

  it("returns PIM_TIMEZONE env var when set", () => {
    vi.stubEnv("PIM_TIMEZONE", "America/New_York");
    expect(getTimezone()).toBe("America/New_York");
  });

  it("falls back to OS timezone when PIM_TIMEZONE is empty", () => {
    vi.stubEnv("PIM_TIMEZONE", "");
    const tz = getTimezone();
    expect(tz).toMatch(/^([A-Za-z]+\/[A-Za-z_]+|UTC)$/);
  });
});

describe("formatInTimezone", () => {
  it("converts UTC date to timezone offset string", () => {
    const result = formatInTimezone("2026-03-14T15:00:00.000Z", "America/Chicago");
    expect(result).toBe("2026-03-14T10:00:00-05:00");
  });

  it("handles DST transitions correctly", () => {
    const winter = formatInTimezone("2026-01-15T18:00:00.000Z", "America/Chicago");
    expect(winter).toBe("2026-01-15T12:00:00-06:00");

    const summer = formatInTimezone("2026-07-15T17:00:00.000Z", "America/Chicago");
    expect(summer).toBe("2026-07-15T12:00:00-05:00");
  });

  it("works with non-US timezones", () => {
    const result = formatInTimezone("2026-03-14T15:00:00.000Z", "Europe/Berlin");
    expect(result).toBe("2026-03-14T16:00:00+01:00");
  });
});

describe("parseTimestamp", () => {
  it("detects UTC timestamp", () => {
    const result = parseTimestamp("2026-03-14T15:00:00Z");
    expect(result.isUTC).toBe(true);
    expect(result.hasExplicitTimezone).toBe(false);
    expect(result.date.toISOString()).toBe("2026-03-14T15:00:00.000Z");
  });

  it("detects timestamp with timezone offset", () => {
    const result = parseTimestamp("2026-03-14T10:00:00-05:00");
    expect(result.isUTC).toBe(false);
    expect(result.hasExplicitTimezone).toBe(true);
    expect(result.date.toISOString()).toBe("2026-03-14T15:00:00.000Z");
    expect(result.offsetMinutes).toBe(-300);
  });

  it("treats bare timestamp as local (no timezone info)", () => {
    const result = parseTimestamp("2026-03-14T10:00:00");
    expect(result.isUTC).toBe(false);
    expect(result.hasExplicitTimezone).toBe(false);
  });
});
