import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanUrl, htmlToMarkdown } from "../htmlToMarkdown.js";

describe("cleanUrl", () => {
  it("strips utm params", () => {
    const url =
      "https://example.com/page?utm_source=email&utm_medium=newsletter&utm_campaign=spring&id=42";
    expect(cleanUrl(url)).toBe("https://example.com/page?id=42");
  });

  it("strips all known tracking params", () => {
    const url =
      "https://example.com/?campaign_id=58&emc=edit&instance_id=123&nl=cooking&regi_id=456&segment_id=789&user_id=abc&fbclid=fb1&gclid=gc1&mc_cid=mc1&mc_eid=me1&__s=s1&_hsenc=hs1&_hsmi=hm1&mkt_tok=mt1&keep=yes";
    expect(cleanUrl(url)).toBe("https://example.com/?keep=yes");
  });

  it("preserves functional params like Google Calendar", () => {
    const url =
      "https://calendar.google.com/calendar/event?action=RESPOND&eid=abc123&rst=1&tok=xyz789&ctz=America%2FLos_Angeles&hl=en&es=0";
    expect(cleanUrl(url)).toBe(url);
  });

  it("returns malformed URLs as-is", () => {
    expect(cleanUrl("not-a-url")).toBe("not-a-url");
    expect(cleanUrl("")).toBe("");
  });

  it("removes trailing ? when all params are stripped", () => {
    const url = "https://example.com/?utm_source=email";
    expect(cleanUrl(url)).toBe("https://example.com/");
  });

  it("handles URLs with no query params", () => {
    const url = "https://example.com/page";
    expect(cleanUrl(url)).toBe("https://example.com/page");
  });
});

// Mock fetch globally so no real network calls happen
const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
  url, // by default, "no redirect" — resolved URL equals input
}));
vi.stubGlobal("fetch", mockFetch);

describe("htmlToMarkdown", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Default: no redirects (resolved URL = input URL)
    mockFetch.mockImplementation(async (url: string) => ({ url }));
  });

  it("converts basic HTML to markdown", async () => {
    const result = await htmlToMarkdown("<p>Hello <strong>world</strong></p>");
    expect(result).toContain("Hello **world**");
  });

  it("strips style tags", async () => {
    const result = await htmlToMarkdown("<style>.foo{color:red}</style><p>Content</p>");
    expect(result).not.toContain(".foo");
    expect(result).not.toContain("color");
    expect(result).toContain("Content");
  });

  it("strips script tags", async () => {
    const result = await htmlToMarkdown('<script>alert("xss")</script><p>Safe</p>');
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("converts headings", async () => {
    const result = await htmlToMarkdown("<h2>Title</h2><p>Text</p>");
    expect(result).toContain("## Title");
  });

  it("converts lists", async () => {
    const result = await htmlToMarkdown("<ul><li>One</li><li>Two</li></ul>");
    expect(result).toContain("- One");
    expect(result).toContain("- Two");
  });

  it("converts links", async () => {
    const result = await htmlToMarkdown('<a href="https://example.com">Click</a>');
    expect(result).toContain("[Click](https://example.com)");
  });

  it("collapses excessive blank lines", async () => {
    const result = await htmlToMarkdown("<p>A</p><br><br><br><br><br><p>B</p>");
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{4,}/);
    expect(result).toContain("A");
    expect(result).toContain("B");
  });
});
