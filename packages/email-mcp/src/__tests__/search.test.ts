import { assert, describe, expect, it } from "vitest";
import { type SearchParams, buildSearchCriteria } from "../search.js";

describe("buildSearchCriteria", () => {
  it("returns { all: true } for empty params", () => {
    expect(buildSearchCriteria({})).toEqual({ all: true });
  });

  it("maps from param to IMAP from", () => {
    expect(buildSearchCriteria({ from: "boss@work.com" })).toEqual({
      from: "boss@work.com",
    });
  });

  it("maps to param to IMAP to", () => {
    expect(buildSearchCriteria({ to: "team@work.com" })).toEqual({
      to: "team@work.com",
    });
  });

  it("maps cc param", () => {
    expect(buildSearchCriteria({ cc: "manager@work.com" })).toEqual({
      cc: "manager@work.com",
    });
  });

  it("maps bcc param", () => {
    expect(buildSearchCriteria({ bcc: "secret@work.com" })).toEqual({
      bcc: "secret@work.com",
    });
  });

  it("maps subject param", () => {
    expect(buildSearchCriteria({ subject: "meeting" })).toEqual({
      subject: "meeting",
    });
  });

  it("maps body param", () => {
    expect(buildSearchCriteria({ body: "report" })).toEqual({
      body: "report",
    });
  });

  it("maps since param to Date", () => {
    const result = buildSearchCriteria({ since: "2026-03-01" });
    assert(!Array.isArray(result));
    expect(result.since).toEqual(new Date("2026-03-01"));
  });

  it("maps before param to Date", () => {
    const result = buildSearchCriteria({ before: "2026-03-10" });
    assert(!Array.isArray(result));
    expect(result.before).toEqual(new Date("2026-03-10"));
  });

  it("maps unread: true to seen: false", () => {
    expect(buildSearchCriteria({ unread: true })).toEqual({ seen: false });
  });

  it("maps unread: false to seen: true", () => {
    expect(buildSearchCriteria({ unread: false })).toEqual({ seen: true });
  });

  it("maps flagged: true", () => {
    expect(buildSearchCriteria({ flagged: true })).toEqual({ flagged: true });
  });

  it("maps flagged: false", () => {
    expect(buildSearchCriteria({ flagged: false })).toEqual({ flagged: false });
  });

  it("maps hasAttachment to content-type header check", () => {
    expect(buildSearchCriteria({ hasAttachment: true })).toEqual({
      header: { "content-type": "multipart/mixed" },
    });
  });

  it("maps single tag to keyword", () => {
    expect(buildSearchCriteria({ tags: ["work"] })).toEqual({
      keyword: "work",
    });
  });

  it("maps multiple tags to ANDed keywords", () => {
    const result = buildSearchCriteria({ tags: ["work", "urgent"] });
    // Duplicate keys require array form so both tags are preserved
    expect(result).toEqual([{ keyword: "work" }, { keyword: "urgent" }]);
  });

  it("splits unquoted subject into ANDed criteria", () => {
    const result = buildSearchCriteria({ subject: "dinner movie" });
    // Duplicate keys require array form so both words are preserved
    expect(result).toEqual([{ subject: "dinner" }, { subject: "movie" }]);
  });

  it("preserves quoted subject as exact phrase", () => {
    const result = buildSearchCriteria({ subject: '"dinner movie"' });
    expect(result).toEqual({ subject: "dinner movie" });
  });

  it("maps query to OR of subject and body", () => {
    const result = buildSearchCriteria({ query: "budget" });
    assert(!Array.isArray(result));
    expect(result.or).toBeDefined();
    expect(result.or).toEqual([{ subject: "budget" }, { body: "budget" }]);
  });

  it("handles query with -exclusion", () => {
    const result = buildSearchCriteria({ query: "dinner -movie" });
    assert(!Array.isArray(result));
    expect(result.or).toBeDefined();
    expect(result.not).toBeDefined();
  });

  it("combines multiple params with AND", () => {
    const result = buildSearchCriteria({
      from: "boss@work.com",
      unread: true,
      since: "2026-03-01",
    });
    assert(!Array.isArray(result));
    expect(result.from).toBe("boss@work.com");
    expect(result.seen).toBe(false);
    expect(result.since).toEqual(new Date("2026-03-01"));
  });
});
