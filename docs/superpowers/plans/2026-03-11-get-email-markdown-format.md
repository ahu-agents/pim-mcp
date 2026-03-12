# get_email Markdown Format Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `format` parameter to the `get_email` MCP tool that converts HTML email bodies to clean, token-efficient markdown — targeting ~85% token reduction.

**Architecture:** Single async `htmlToMarkdown()` module implements the full pipeline: sanitize-html → turndown → image replacement → redirect URL resolution → tracking param stripping → whitespace cleanup. The `get_email` handler gains a `format` parameter (default `"markdown"`) that controls which body format is returned.

**Tech Stack:** sanitize-html, turndown, Node 18+ global fetch

**Spec:** `docs/superpowers/specs/2026-03-11-get-email-markdown-format-design.md`

---

## Chunk 1: Dependencies, Interface, and cleanUrl

### Task 1: Install dependencies

**Files:**
- Modify: `packages/email-mcp/package.json`

- [ ] **Step 1: Install production and dev dependencies**

Run:
```bash
cd packages/email-mcp && npm install sanitize-html turndown && npm install -D @types/sanitize-html @types/turndown
```

- [ ] **Step 2: Verify dependencies are in package.json**

Run:
```bash
cd packages/email-mcp && node -e "const p = require('./package.json'); console.log('sanitize-html:', p.dependencies['sanitize-html']); console.log('turndown:', p.dependencies['turndown']); console.log('@types/sanitize-html:', p.devDependencies['@types/sanitize-html']); console.log('@types/turndown:', p.devDependencies['@types/turndown']);"
```
Expected: All four packages listed with version ranges.

- [ ] **Step 3: Verify build still passes**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/email-mcp/package.json package-lock.json
git commit -m "chore(email-mcp): add sanitize-html and turndown dependencies"
```

---

### Task 2: Add markdownBody to EmailFull interface

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts:17-27`

- [ ] **Step 1: Add markdownBody to EmailFull**

In `packages/email-mcp/src/services/ImapService.ts`, add `markdownBody?: string;` to the `EmailFull` interface after `htmlBody`:

```typescript
export interface EmailFull extends EmailSummary {
  cc?: Array<{ name?: string; address: string }>;
  textBody?: string;
  htmlBody?: string;
  markdownBody?: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    partId: string;
  }>;
}
```

- [ ] **Step 2: Verify build passes**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build.

- [ ] **Step 3: Verify existing tests still pass**

Run:
```bash
cd packages/email-mcp && npx vitest run
```
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts
git commit -m "feat(email-mcp): add markdownBody field to EmailFull interface"
```

---

### Task 3: Implement and test cleanUrl

**Files:**
- Create: `packages/email-mcp/src/htmlToMarkdown.ts`
- Create: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write failing tests for cleanUrl**

Create `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanUrl } from "../htmlToMarkdown.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: FAIL — `cleanUrl` is not exported (module doesn't exist yet).

- [ ] **Step 3: Implement cleanUrl**

Create `packages/email-mcp/src/htmlToMarkdown.ts`:

```typescript
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campaign_id",
  "emc",
  "instance_id",
  "nl",
  "regi_id",
  "segment_id",
  "user_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "__s",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
]);

export function cleanUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return urlStr;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All 6 cleanUrl tests pass.

- [ ] **Step 5: Verify build passes**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "feat(email-mcp): implement cleanUrl for tracking param removal"
```

---

## Chunk 2: htmlToMarkdown pipeline

### Task 4: Implement and test the sanitize + turndown core

**Files:**
- Modify: `packages/email-mcp/src/htmlToMarkdown.ts`
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write failing tests for HTML-to-markdown conversion**

Add to `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`:

```typescript
import { cleanUrl, htmlToMarkdown } from "../htmlToMarkdown.js";

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
    const result = await htmlToMarkdown(
      "<style>.foo{color:red}</style><p>Content</p>",
    );
    expect(result).not.toContain(".foo");
    expect(result).not.toContain("color");
    expect(result).toContain("Content");
  });

  it("strips script tags", async () => {
    const result = await htmlToMarkdown(
      '<script>alert("xss")</script><p>Safe</p>',
    );
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("converts headings", async () => {
    const result = await htmlToMarkdown("<h2>Title</h2><p>Text</p>");
    expect(result).toContain("## Title");
  });

  it("converts lists", async () => {
    const result = await htmlToMarkdown(
      "<ul><li>One</li><li>Two</li></ul>",
    );
    expect(result).toContain("- One");
    expect(result).toContain("- Two");
  });

  it("converts links", async () => {
    const result = await htmlToMarkdown(
      '<a href="https://example.com">Click</a>',
    );
    expect(result).toContain("[Click](https://example.com)");
  });

  it("collapses excessive blank lines", async () => {
    const result = await htmlToMarkdown(
      "<p>A</p><br><br><br><br><br><p>B</p>",
    );
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{4,}/);
    expect(result).toContain("A");
    expect(result).toContain("B");
  });
});
```

Note: Keep the existing `cleanUrl` describe block. Update the import at the top of the file to:
```typescript
import { cleanUrl, htmlToMarkdown } from "../htmlToMarkdown.js";
```
The `vi`, `beforeEach` imports from "vitest" are already present from Task 3. Add the `mockFetch` setup between the imports and the first `describe` block.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: FAIL — `htmlToMarkdown` is not exported.

- [ ] **Step 3: Implement sanitize + turndown pipeline**

Update `packages/email-mcp/src/htmlToMarkdown.ts` — add imports and the `htmlToMarkdown` function after `cleanUrl`:

```typescript
import sanitize from "sanitize-html";
import TurndownService from "turndown";

// ... TRACKING_PARAMS and cleanUrl stay as-is ...

function isHiddenElement(style: string): boolean {
  const s = style.toLowerCase();
  if (!s.includes("display:none") && !s.includes("display: none")) {
    return false;
  }
  return (
    s.includes("height:0") ||
    s.includes("height: 0") ||
    s.includes("max-height:0") ||
    s.includes("max-height: 0") ||
    s.includes("overflow:hidden") ||
    s.includes("overflow: hidden") ||
    s.includes("opacity:0") ||
    s.includes("opacity: 0")
  );
}

export async function htmlToMarkdown(html: string): Promise<string> {
  // Step 1: Sanitize
  const clean = sanitize(html, {
    allowedTags: [
      "p", "br", "b", "i", "em", "strong", "a",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "tr", "td", "th", "thead", "tbody",
      "blockquote", "pre", "code", "hr", "span", "div",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "width", "height", "style"],
    },
    exclusiveFilter: (frame) => {
      // Remove tracking pixels
      if (frame.tag === "img") {
        const w = Number.parseInt(frame.attribs.width || "", 10);
        const h = Number.parseInt(frame.attribs.height || "", 10);
        if ((w >= 0 && w <= 1) || (h >= 0 && h <= 1)) return true;
        const style = frame.attribs.style || "";
        if (isHiddenElement(style)) return true;
      }
      // Remove hidden elements
      const style = frame.attribs?.style || "";
      if (style && isHiddenElement(style)) return true;
      return false;
    },
  });

  // Step 2: Convert to markdown
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  let markdown = td.turndown(clean);

  // Step 3: Replace images
  // ![alt](url) → [Image: alt], ![](url) → removed
  markdown = markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => {
    return alt ? `[Image: ${alt}]` : "";
  });

  // Step 4: Resolve redirect URLs
  const urlPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const urlMatches = [...markdown.matchAll(urlPattern)];
  if (urlMatches.length > 0) {
    const urls = [...new Set(urlMatches.map((m) => m[2]))];
    const resolved = await resolveUrls(urls);
    for (const [original, final] of resolved) {
      if (original !== final) {
        markdown = markdown.replaceAll(original, final);
      }
    }
  }

  // Step 5: Strip tracking params from all URLs
  markdown = markdown.replace(
    /\(https?:\/\/[^)]+\)/g,
    (match) => {
      const url = match.slice(1, -1); // remove parens
      return `(${cleanUrl(url)})`;
    },
  );

  // Step 6: Post-process — collapse excessive newlines
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  return markdown;
}

async function resolveUrls(
  urls: string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        resolved.set(url, res.url);
      } catch {
        clearTimeout(timeout);
        resolved.set(url, url); // keep original on error
      }
    }),
  );
  return resolved;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All cleanUrl and htmlToMarkdown tests pass.

- [ ] **Step 5: Verify build passes**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/htmlToMarkdown.ts packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "feat(email-mcp): implement htmlToMarkdown pipeline (sanitize, turndown, images, URLs)"
```

---

### Task 5: Test hidden element and tracking pixel removal

**Files:**
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write tests for sanitization edge cases**

Add to the `htmlToMarkdown` describe block in the test file:

```typescript
  it("removes tracking pixels (width=1 height=1)", async () => {
    const result = await htmlToMarkdown(
      '<p>Content</p><img width="1" height="1" src="https://track.example.com/pixel.gif">',
    );
    expect(result).toContain("Content");
    expect(result).not.toContain("track.example.com");
    expect(result).not.toContain("pixel");
  });

  it("removes hidden preview text divs", async () => {
    const result = await htmlToMarkdown(
      '<div style="display:none;max-height:0;overflow:hidden">Preview text here</div><p>Real content</p>',
    );
    expect(result).not.toContain("Preview text here");
    expect(result).toContain("Real content");
  });

  it("removes Google Calendar hidden spans", async () => {
    const result = await htmlToMarkdown(
      '<span style="display: none; font-size: 1px; color: #fff; line-height: 1px; height: 0; max-height: 0; width: 0; max-width: 0; opacity: 0; overflow: hidden;">Hidden gcal text</span><p>Visible</p>',
    );
    expect(result).not.toContain("Hidden gcal text");
    expect(result).toContain("Visible");
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All tests pass (these exercise the existing exclusiveFilter logic).

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "test(email-mcp): add hidden element and tracking pixel removal tests"
```

---

### Task 6: Test image replacement

**Files:**
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write tests for image handling**

Add to the `htmlToMarkdown` describe block:

```typescript
  it("replaces images with [Image: alt]", async () => {
    const result = await htmlToMarkdown(
      '<img src="https://example.com/photo.jpg" alt="Spring Minestrone" width="600" height="400">',
    );
    expect(result).toContain("[Image: Spring Minestrone]");
    expect(result).not.toContain("https://example.com/photo.jpg");
  });

  it("removes images with no alt text", async () => {
    const result = await htmlToMarkdown(
      '<img src="https://example.com/spacer.gif" width="600" height="10"><p>Content</p>',
    );
    expect(result).not.toContain("spacer.gif");
    expect(result).toContain("Content");
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "test(email-mcp): add image replacement tests"
```

---

### Task 7: Test URL resolution and tracking param stripping

**Files:**
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Write tests for redirect resolution**

Add to the `htmlToMarkdown` describe block:

```typescript
  it("resolves redirect URLs", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === "https://redirect.example.com/abc123") {
        return { url: "https://real.example.com/page" };
      }
      return { url };
    });

    const result = await htmlToMarkdown(
      '<a href="https://redirect.example.com/abc123">Click here</a>',
    );
    expect(result).toContain("[Click here](https://real.example.com/page)");
    expect(result).not.toContain("redirect.example.com");
  });

  it("keeps original URL on fetch error", async () => {
    mockFetch.mockImplementation(async () => {
      throw new Error("Network error");
    });

    const result = await htmlToMarkdown(
      '<a href="https://example.com/page">Link</a>',
    );
    expect(result).toContain("[Link](https://example.com/page)");
  });

  it("strips tracking params from resolved URLs", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("redirect.example.com")) {
        return {
          url: "https://cooking.example.com/recipe?campaign_id=58&utm_source=email&id=123",
        };
      }
      return { url };
    });

    const result = await htmlToMarkdown(
      '<a href="https://redirect.example.com/xyz">Recipe</a>',
    );
    expect(result).toContain("id=123");
    expect(result).not.toContain("campaign_id");
    expect(result).not.toContain("utm_source");
  });

  it("preserves functional URL params after resolution", async () => {
    mockFetch.mockImplementation(async (url: string) => ({ url }));

    const result = await htmlToMarkdown(
      '<a href="https://calendar.google.com/calendar/event?action=RESPOND&eid=abc&rst=1&tok=xyz">Yes</a>',
    );
    expect(result).toContain("action=RESPOND");
    expect(result).toContain("eid=abc");
    expect(result).toContain("rst=1");
    expect(result).toContain("tok=xyz");
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "test(email-mcp): add URL resolution and tracking param tests"
```

---

## Chunk 3: Tool schema, handler, and integration

### Task 8: Update get_email tool schema and handler

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts:84-102` (schema) and `341-345` (handler)

- [ ] **Step 1: Write failing tests for the format parameter**

Add to `packages/email-mcp/src/__tests__/emailTools.test.ts`:

```typescript
  it("get_email schema includes format property", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "get_email")!;
    const props = tool.inputSchema.properties as Record<string, any>;
    expect(props).toHaveProperty("format");
    expect(props.format.enum).toEqual(["markdown", "html", "text"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts
```
Expected: FAIL — `format` property doesn't exist in schema.

- [ ] **Step 3: Update get_email tool schema**

In `packages/email-mcp/src/tools/emailTools.ts`, update the `get_email` tool definition (around line 84):

```typescript
  {
    name: "get_email",
    description:
      "Fetch a full email by UID including headers, body, and attachment metadata. Returns body as markdown by default for token efficiency. Use format='html' or format='text' for raw content.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder containing the email. Defaults to INBOX.",
        },
        uid: {
          type: "number",
          description: "The UID of the email to fetch.",
        },
        format: {
          type: "string",
          enum: ["markdown", "html", "text"],
          description:
            "Body format to return. 'markdown' (default) converts HTML to clean markdown for token efficiency. 'html' returns raw HTML. 'text' returns plain text only.",
        },
      },
      required: ["uid"],
    },
  },
```

- [ ] **Step 4: Run schema test to verify it passes**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Update get_email handler**

In `packages/email-mcp/src/tools/emailTools.ts`, add the import at the top:

```typescript
import { htmlToMarkdown } from "../htmlToMarkdown.js";
```

Then replace the `get_email` case (around line 341):

```typescript
      case "get_email": {
        const uid = args.uid as number;
        const format = (args.format as string) || "markdown";
        const email = await imapService.fetchEmail(folder, uid);

        if (format === "markdown") {
          try {
            if (email.htmlBody) {
              email.markdownBody = await htmlToMarkdown(email.htmlBody);
            } else if (email.textBody) {
              email.markdownBody = email.textBody;
            }
            delete email.htmlBody;
            delete email.textBody;
          } catch {
            // Conversion failed — fall back to returning raw bodies unchanged
          }
        } else if (format === "text") {
          delete email.htmlBody;
        } else if (format === "html") {
          delete email.textBody;
        }

        return ok(JSON.stringify(email, null, 2));
      }
```

- [ ] **Step 6: Verify build passes**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): add format parameter to get_email tool"
```

---

### Task 9: Test handler format behavior

**Files:**
- Modify: `packages/email-mcp/src/__tests__/emailTools.test.ts`
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts` (for mock setup)

This task tests the `handleEmailTool` function's format logic. Since the handler calls `imapService.fetchEmail()`, we need to mock both ImapService and the `htmlToMarkdown` module.

- [ ] **Step 1: Write handler format tests**

Add a new describe block to `packages/email-mcp/src/__tests__/emailTools.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_TOOLS, handleEmailTool } from "../tools/emailTools.js";

// Mock ImapService
const mockFetchEmail = vi.fn();
const mockImapService = {
  fetchEmail: mockFetchEmail,
} as any;
const mockSmtpService = {} as any;

// Mock htmlToMarkdown
vi.mock("../htmlToMarkdown.js", () => ({
  htmlToMarkdown: vi.fn().mockResolvedValue("**converted markdown**"),
}));

describe("handleEmailTool get_email format", () => {
  beforeEach(() => {
    mockFetchEmail.mockReset();
    mockFetchEmail.mockResolvedValue({
      uid: 123,
      messageId: "<msg@test.com>",
      subject: "Test",
      from: { address: "sender@test.com" },
      to: [{ address: "recipient@test.com" }],
      date: "2026-03-11T12:00:00Z",
      flags: [],
      hasAttachments: false,
      textBody: "Plain text body",
      htmlBody: "<p>HTML body</p>",
      attachments: [],
    });
  });

  it("defaults to markdown format", async () => {
    const result = await handleEmailTool(
      "get_email",
      { uid: 123 },
      mockImapService,
      mockSmtpService,
    );
    const body = JSON.parse(result.content[0].text);
    expect(body.markdownBody).toBe("**converted markdown**");
    expect(body.textBody).toBeUndefined();
    expect(body.htmlBody).toBeUndefined();
  });

  it("format html returns htmlBody only", async () => {
    const result = await handleEmailTool(
      "get_email",
      { uid: 123, format: "html" },
      mockImapService,
      mockSmtpService,
    );
    const body = JSON.parse(result.content[0].text);
    expect(body.htmlBody).toBe("<p>HTML body</p>");
    expect(body.textBody).toBeUndefined();
    expect(body.markdownBody).toBeUndefined();
  });

  it("format text returns textBody only", async () => {
    const result = await handleEmailTool(
      "get_email",
      { uid: 123, format: "text" },
      mockImapService,
      mockSmtpService,
    );
    const body = JSON.parse(result.content[0].text);
    expect(body.textBody).toBe("Plain text body");
    expect(body.htmlBody).toBeUndefined();
    expect(body.markdownBody).toBeUndefined();
  });

  it("text-only email with markdown format uses textBody as markdownBody", async () => {
    mockFetchEmail.mockResolvedValue({
      uid: 123,
      messageId: "<msg@test.com>",
      subject: "Test",
      from: { address: "sender@test.com" },
      to: [{ address: "recipient@test.com" }],
      date: "2026-03-11T12:00:00Z",
      flags: [],
      hasAttachments: false,
      textBody: "Plain text only",
      attachments: [],
    });

    const result = await handleEmailTool(
      "get_email",
      { uid: 123 },
      mockImapService,
      mockSmtpService,
    );
    const body = JSON.parse(result.content[0].text);
    expect(body.markdownBody).toBe("Plain text only");
    expect(body.textBody).toBeUndefined();
    expect(body.htmlBody).toBeUndefined();
  });

  it("falls back to raw bodies on conversion error", async () => {
    const { htmlToMarkdown } = await import("../htmlToMarkdown.js");
    vi.mocked(htmlToMarkdown).mockRejectedValueOnce(new Error("Parse error"));

    const result = await handleEmailTool(
      "get_email",
      { uid: 123 },
      mockImapService,
      mockSmtpService,
    );
    const body = JSON.parse(result.content[0].text);
    // Falls back — original fields preserved
    expect(body.htmlBody).toBe("<p>HTML body</p>");
    expect(body.textBody).toBe("Plain text body");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts
```
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "test(email-mcp): add handler tests for get_email format parameter"
```

---

### Task 10: Integration test with NYT fixture

**Files:**
- Create: `packages/email-mcp/src/__tests__/__fixtures__/nyt-example.html` (copy from `docs/nyt-example.html`)
- Modify: `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`

- [ ] **Step 1: Copy fixture file**

Run:
```bash
mkdir -p packages/email-mcp/src/__tests__/__fixtures__
cp docs/nyt-example.html packages/email-mcp/src/__tests__/__fixtures__/nyt-example.html
```

- [ ] **Step 2: Write integration test**

Add to the `htmlToMarkdown` describe block in `packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts`:

```typescript
import { readFileSync } from "fs";
import { resolve } from "path";

  it("dramatically reduces NYT newsletter size", async () => {
    const fixturePath = resolve(__dirname, "__fixtures__/nyt-example.html");
    const html = readFileSync(fixturePath, "utf-8");

    // Mock fetch: no redirects (just test sanitize+turndown+images)
    mockFetch.mockImplementation(async (url: string) => ({ url }));

    const result = await htmlToMarkdown(html);

    // Original HTML is ~65KB, result should be significantly smaller
    expect(result.length).toBeLessThan(html.length * 0.5);

    // Should not contain CSS
    expect(result).not.toMatch(/\{[^}]*color\s*:/);
    expect(result).not.toMatch(/@media/);

    // Should not contain HTML tags
    expect(result).not.toContain("<style");
    expect(result).not.toContain("<table");
    expect(result).not.toContain("<td");

    // Should contain readable content
    expect(result.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 3: Run integration test**

Run:
```bash
cd packages/email-mcp && npx vitest run src/__tests__/htmlToMarkdown.test.ts
```
Expected: All tests pass including integration test.

- [ ] **Step 4: Commit**

```bash
git add packages/email-mcp/src/__tests__/__fixtures__/nyt-example.html packages/email-mcp/src/__tests__/htmlToMarkdown.test.ts
git commit -m "test(email-mcp): add NYT newsletter integration test for htmlToMarkdown"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run:
```bash
cd /path/to/pim-agents && npm test
```
Expected: All tests pass across all packages.

- [ ] **Step 2: Run lint**

Run:
```bash
cd /path/to/pim-agents && npm run lint
```
Expected: No lint errors. If biome reports issues, fix them.

- [ ] **Step 3: Run typecheck**

Run:
```bash
cd /path/to/pim-agents && npm run typecheck
```
Expected: No type errors.

- [ ] **Step 4: Run build**

Run:
```bash
cd /path/to/pim-agents && npm run build
```
Expected: Clean build.

- [ ] **Step 5: Fix any issues and commit**

If lint/typecheck/build revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(email-mcp): resolve lint/type issues from markdown format feature"
```
