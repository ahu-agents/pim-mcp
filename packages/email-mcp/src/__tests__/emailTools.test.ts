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

describe("EMAIL_TOOLS definitions", () => {
  it("defines 11 tools", () => {
    expect(EMAIL_TOOLS).toHaveLength(11);
  });

  it("all tools have name, description, and inputSchema", () => {
    for (const tool of EMAIL_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("defines the expected tool names", () => {
    const names = EMAIL_TOOLS.map((t) => t.name);
    expect(names).toContain("search_emails");
    expect(names).toContain("get_email");
    expect(names).toContain("send_email");
    expect(names).toContain("move_email");
    expect(names).toContain("mark_email");
    expect(names).toContain("delete_email");
    expect(names).toContain("list_folders");
    expect(names).toContain("create_folder");
    expect(names).toContain("download_attachment");
    expect(names).toContain("get_email_raw");
    expect(names).toContain("get_folder_status");
  });

  it("send_email requires to and subject", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "send_email")!;
    expect(tool.inputSchema.required).toContain("to");
    expect(tool.inputSchema.required).toContain("subject");
  });

  it("search_emails has structured search params", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "search_emails")!;
    const props = tool.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("folder");
    expect(props).toHaveProperty("hasWords");
    expect(props).not.toHaveProperty("query");
    expect(props).toHaveProperty("body");
    expect(props).toHaveProperty("from");
    expect(props).toHaveProperty("to");
    expect(props).toHaveProperty("cc");
    expect(props).toHaveProperty("bcc");
    expect(props).toHaveProperty("subject");
    expect(props).toHaveProperty("since");
    expect(props).toHaveProperty("before");
    expect(props).toHaveProperty("unread");
    expect(props).toHaveProperty("flagged");
    expect(props).toHaveProperty("hasAttachment");
    expect(props).toHaveProperty("tags");
    expect(props).toHaveProperty("limit");
    expect(props).toHaveProperty("offset");
    expect(props).toHaveProperty("sortBy");
    expect(props).toHaveProperty("sortOrder");
  });

  it("get_email requires folder and uid", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "get_email")!;
    expect(tool.inputSchema.required).toContain("uid");
  });

  it("get_email schema includes format property", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "get_email")!;
    const props = tool.inputSchema.properties as Record<string, any>;
    expect(props).toHaveProperty("format");
    expect(props.format.enum).toEqual(["markdown", "html", "text"]);
  });

  it("download_attachment requires uid and partId", () => {
    const tool = EMAIL_TOOLS.find((t) => t.name === "download_attachment")!;
    expect(tool.inputSchema.required).toContain("uid");
    expect(tool.inputSchema.required).toContain("partId");
  });
});

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
