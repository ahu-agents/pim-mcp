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

  it("handles -negation in subject tokens", () => {
    const result = buildSearchCriteria({ subject: "update -cancelled" });
    expect(result).toEqual([{ subject: "update" }, { not: { subject: "cancelled" } }]);
  });

  it("handles -negation in body tokens", () => {
    const result = buildSearchCriteria({ body: "report -draft" });
    expect(result).toEqual([{ body: "report" }, { not: { body: "draft" } }]);
  });

  it("handles quoted phrase with -negation in subject", () => {
    const result = buildSearchCriteria({ subject: '"budget report" -old' });
    expect(result).toEqual([{ subject: "budget report" }, { not: { subject: "old" } }]);
  });

  it("handles -negation on quoted phrase", () => {
    const result = buildSearchCriteria({ subject: '-"out of office"' });
    expect(result).toEqual({ not: { subject: "out of office" } });
  });

  it("maps hasWords to IMAP text key", () => {
    expect(buildSearchCriteria({ hasWords: "budget" })).toEqual({
      text: "budget",
    });
  });

  it("tokenizes hasWords with AND", () => {
    const result = buildSearchCriteria({ hasWords: "budget report" });
    expect(result).toEqual([{ text: "budget" }, { text: "report" }]);
  });

  it("handles -negation in hasWords", () => {
    const result = buildSearchCriteria({ hasWords: "budget -draft" });
    expect(result).toEqual([{ text: "budget" }, { not: { text: "draft" } }]);
  });

  it("handles quoted phrase in hasWords", () => {
    expect(buildSearchCriteria({ hasWords: '"budget report"' })).toEqual({
      text: "budget report",
    });
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

  it("returns base criteria folded into each tokenized criterion", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "update meeting",
    });
    expect(result).toEqual([
      { from: "alice@test.com", subject: "update" },
      { from: "alice@test.com", subject: "meeting" },
    ]);
  });

  it("folds multiple base criteria into each tokenized criterion", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      unread: true,
      subject: "update meeting",
    });
    expect(result).toEqual([
      { from: "alice@test.com", seen: false, subject: "update" },
      { from: "alice@test.com", seen: false, subject: "meeting" },
    ]);
  });

  it("folds base criteria with NOT tokenized criteria", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "update -spam",
    });
    expect(result).toEqual([
      { from: "alice@test.com", subject: "update" },
      { from: "alice@test.com", not: { subject: "spam" } },
    ]);
  });

  it("folds base criteria with hasWords tokens", () => {
    const result = buildSearchCriteria({
      flagged: true,
      hasWords: "budget report",
    });
    expect(result).toEqual([
      { flagged: true, text: "budget" },
      { flagged: true, text: "report" },
    ]);
  });

  it("folds base criteria with tokens from multiple tokenized fields", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "meeting",
      body: "agenda",
    });
    expect(result).toEqual([
      { from: "alice@test.com", subject: "meeting" },
      { from: "alice@test.com", body: "agenda" },
    ]);
  });

  it("folds base into single tokenized criterion (returns 1-element array)", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      subject: "meeting",
    });
    expect(result).toEqual([{ from: "alice@test.com", subject: "meeting" }]);
  });

  it("returns base-only criteria merged when no tokenized fields", () => {
    const result = buildSearchCriteria({
      from: "alice@test.com",
      unread: true,
    });
    expect(result).toEqual({
      from: "alice@test.com",
      seen: false,
    });
  });
});
