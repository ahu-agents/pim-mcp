# Email Draft, Threading & Sent Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add draft creation, reply threading, and Sent folder copy to `@miguelarios/email-mcp`.

**Architecture:** Enhance `send_email` with three modes (send, reply, draft) via new `replyToUid`/`saveToDrafts` params. Add `send_draft` tool for sending existing drafts. Add threading headers (`inReplyTo`, `references`) to `get_email` response. All modes use nodemailer MailComposer for RFC 822 message building and ImapFlow `append()` for IMAP APPEND.

**Tech Stack:** TypeScript, nodemailer (MailComposer), imapflow, mailparser, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-email-draft-threading-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/email-mcp/src/services/ImapService.ts` | Modify | Add `getSpecialUseFolder()`, `appendMessage()`, `fetchRawSource()` |
| `packages/email-mcp/src/services/SmtpService.ts` | Modify | Add `composeRawMessage()`, `sendRawMessage()`, add `autoSent` config |
| `packages/email-mcp/src/tools/emailTools.ts` | Modify | Update `send_email` schema + handler, add `send_draft` tool + handler, update `get_email` handler |
| `packages/email-mcp/src/__tests__/ImapService.test.ts` | Modify | Tests for new ImapService methods |
| `packages/email-mcp/src/__tests__/SmtpService.test.ts` | Modify | Tests for new SmtpService methods |
| `packages/email-mcp/src/__tests__/emailTools.test.ts` | Modify | Tests for updated tool schemas + handlers |
| `packages/core/src/config.ts` | Modify | Add `autoSent` to `EmailConfig`, read `SMTP_AUTO_SENT` env var |
| `packages/core/src/__tests__/emailConfig.test.ts` | Modify | Test `SMTP_AUTO_SENT` parsing |

---

### Task 1: Add `inReplyTo` and `references` to `get_email` response

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts:17-28` (EmailFull interface)
- Modify: `packages/email-mcp/src/services/ImapService.ts:197-225` (fetchEmail return)
- Test: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Write failing tests for threading fields in fetchEmail**

Add to `ImapService.test.ts` inside the existing `describe("fetchEmail")` block:

```typescript
it("returns inReplyTo and references from parsed email", async () => {
  const { simpleParser } = await import("mailparser");
  vi.mocked(simpleParser).mockResolvedValueOnce({
    messageId: "<msg-1@test.com>",
    subject: "Re: Original",
    from: { value: [{ address: "sender@test.com", name: "Sender" }] },
    to: { value: [{ address: "recipient@test.com", name: "Recipient" }] },
    cc: null,
    date: new Date("2026-03-04T12:00:00Z"),
    text: "Reply body",
    html: null,
    attachments: [],
    inReplyTo: "<original@test.com>",
    references: ["<root@test.com>", "<original@test.com>"],
  } as any);

  mockFetchOne.mockResolvedValueOnce({
    source: Buffer.from("raw email"),
    uid: 42,
  });

  const email = await service.fetchEmail("INBOX", 42);
  expect(email.inReplyTo).toBe("<original@test.com>");
  expect(email.references).toEqual(["<root@test.com>", "<original@test.com>"]);
});

it("returns null inReplyTo and empty references for non-reply emails", async () => {
  mockFetchOne.mockResolvedValueOnce({
    source: Buffer.from("raw email"),
    uid: 10,
  });

  const email = await service.fetchEmail("INBOX", 10);
  expect(email.inReplyTo).toBeNull();
  expect(email.references).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: FAIL — `inReplyTo` and `references` are not properties on EmailFull.

- [ ] **Step 3: Add threading fields to EmailFull interface and fetchEmail**

In `ImapService.ts`, update the `EmailFull` interface (line 17):

```typescript
export interface EmailFull extends EmailSummary {
  cc?: Array<{ name?: string; address: string }>;
  inReplyTo: string | null;
  references: string[];
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

In `fetchEmail` (line 197), add to the return object after `messageId`:

```typescript
inReplyTo: parsed.inReplyTo || null,
references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): add inReplyTo and references to get_email response"
```

---

### Task 2: Add `getSpecialUseFolder()` to ImapService

**Note:** The spec mentions per-connection caching. For now, each call opens a fresh IMAP connection and does a LIST. This matches the existing pattern (all ImapService methods create a fresh client). Caching can be added later if folder discovery becomes a performance bottleneck — unlikely since `send_email` calls it at most twice (Sent + Drafts).

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts`
- Test: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Write failing tests for getSpecialUseFolder**

Add a new `describe("getSpecialUseFolder")` block to `ImapService.test.ts`:

```typescript
describe("getSpecialUseFolder", () => {
  it("finds Sent folder by special-use flag", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", specialUse: "\\Inbox", delimiter: "/" },
      { path: "Sent Messages", specialUse: "\\Sent", delimiter: "/" },
      { path: "Trash", specialUse: "\\Trash", delimiter: "/" },
    ]);

    const folder = await service.getSpecialUseFolder("\\Sent");
    expect(folder).toBe("Sent Messages");
  });

  it("finds Drafts folder by special-use flag", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", specialUse: "\\Inbox", delimiter: "/" },
      { path: "Drafts", specialUse: "\\Drafts", delimiter: "/" },
    ]);

    const folder = await service.getSpecialUseFolder("\\Drafts");
    expect(folder).toBe("Drafts");
  });

  it("falls back to common names when no special-use flag for Sent", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", specialUse: "\\Inbox", delimiter: "/" },
      { path: "Sent", delimiter: "/" },
      { path: "Trash", delimiter: "/" },
    ]);

    const folder = await service.getSpecialUseFolder("\\Sent");
    expect(folder).toBe("Sent");
  });

  it("falls back to 'Sent Items' when 'Sent' not found", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", delimiter: "/" },
      { path: "Sent Items", delimiter: "/" },
    ]);

    const folder = await service.getSpecialUseFolder("\\Sent");
    expect(folder).toBe("Sent Items");
  });

  it("falls back to 'INBOX.Drafts' for Drafts", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", delimiter: "." },
      { path: "INBOX.Drafts", delimiter: "." },
    ]);

    const folder = await service.getSpecialUseFolder("\\Drafts");
    expect(folder).toBe("INBOX.Drafts");
  });

  it("throws FOLDER_NOT_FOUND when no match", async () => {
    mockList.mockResolvedValueOnce([
      { path: "INBOX", delimiter: "/" },
    ]);

    await expect(service.getSpecialUseFolder("\\Sent")).rejects.toThrow("FOLDER_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts -t "getSpecialUseFolder"`
Expected: FAIL — `getSpecialUseFolder` is not a function.

- [ ] **Step 3: Implement getSpecialUseFolder**

Add to `ImapService` class in `ImapService.ts`:

```typescript
private static FALLBACK_NAMES: Record<string, string[]> = {
  "\\Sent": ["Sent", "Sent Messages", "Sent Items", "INBOX.Sent"],
  "\\Drafts": ["Drafts", "Draft", "INBOX.Drafts"],
};

async getSpecialUseFolder(flag: string): Promise<string> {
  const client = this.createClient();
  try {
    await client.connect();
    const mailboxes = await client.list();

    // Try special-use flag first
    const byFlag = mailboxes.find((mb) => mb.specialUse === flag);
    if (byFlag) return byFlag.path;

    // Fallback to common names
    const fallbacks = ImapService.FALLBACK_NAMES[flag] || [];
    const paths = new Set(mailboxes.map((mb) => mb.path));
    for (const name of fallbacks) {
      if (paths.has(name)) return name;
    }

    throw new EmailError(
      `No folder found for ${flag}`,
      ErrorCode.FOLDER_NOT_FOUND,
    );
  } catch (error) {
    if (error instanceof EmailError) throw error;
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    await client.logout().catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts -t "getSpecialUseFolder"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): add getSpecialUseFolder with RFC 6154 flags and fallbacks"
```

---

### Task 3: Add `appendMessage()` and `fetchRawSource()` to ImapService

**Note:** `fetchRawSource()` returns `Buffer` while the existing `fetchRawEmail()` returns `string`. Both fetch raw RFC 822 source. The Buffer variant is needed because `imapflow.append()` and `nodemailer.sendMail({ raw })` both accept Buffer. The string variant is used by the `get_email_raw` tool for user-facing `.eml` export. Consolidating them would mean changing `get_email_raw`'s return type — not worth the churn for this change.

**Files:**
- Modify: `packages/email-mcp/src/services/ImapService.ts`
- Test: `packages/email-mcp/src/__tests__/ImapService.test.ts`

- [ ] **Step 1: Add `mockAppend` to the ImapFlow mock**

At the top of `ImapService.test.ts`, add alongside the other mocks:

```typescript
const mockAppend = vi.fn();
```

And add to the `ImapFlow` mock implementation object:

```typescript
append: mockAppend,
```

- [ ] **Step 2: Write failing tests for appendMessage and fetchRawSource**

Add to `ImapService.test.ts`:

```typescript
describe("appendMessage", () => {
  it("appends a raw message to a folder with flags", async () => {
    mockAppend.mockResolvedValueOnce({ uid: 123 });

    const raw = Buffer.from("Subject: Test\r\n\r\nHello");
    const result = await service.appendMessage("Sent", raw, ["\\Seen"]);

    expect(result).toEqual({ uid: 123 });
    expect(mockAppend).toHaveBeenCalledWith("Sent", raw, ["\\Seen"]);
  });

  it("returns uid 0 when server does not support UIDPLUS", async () => {
    mockAppend.mockResolvedValueOnce(false);

    const raw = Buffer.from("Subject: Test\r\n\r\nHello");
    const result = await service.appendMessage("Drafts", raw, ["\\Draft", "\\Seen"]);

    expect(result).toEqual({ uid: 0 });
  });
});

describe("fetchRawSource", () => {
  it("fetches raw RFC 822 source as Buffer", async () => {
    const rawContent = Buffer.from("Subject: Test\r\n\r\nHello world");
    mockFetchOne.mockResolvedValueOnce({
      source: rawContent,
      uid: 42,
    });

    const result = await service.fetchRawSource("INBOX", 42);
    expect(result).toEqual(rawContent);
  });

  it("throws EMAIL_NOT_FOUND for missing UID", async () => {
    mockFetchOne.mockResolvedValueOnce(null);

    await expect(service.fetchRawSource("INBOX", 999)).rejects.toThrow("not found");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts -t "appendMessage|fetchRawSource"`
Expected: FAIL — methods don't exist.

- [ ] **Step 4: Implement appendMessage and fetchRawSource**

Add to `ImapService` class:

```typescript
async appendMessage(
  folder: string,
  rawSource: Buffer,
  flags: string[],
): Promise<{ uid: number }> {
  const client = this.createClient();
  try {
    await client.connect();
    const result = await client.append(folder, rawSource, flags);
    // ImapFlow returns { uid } when UIDPLUS is supported, false otherwise
    return { uid: result && typeof result === "object" && "uid" in result ? result.uid : 0 };
  } catch (error) {
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    await client.logout().catch(() => {});
  }
}

async fetchRawSource(folder: string, uid: number): Promise<Buffer> {
  const client = this.createClient();
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const fetchResult = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );
      if (!fetchResult || !fetchResult.source) {
        throw new EmailError(
          `Email UID ${uid} not found`,
          ErrorCode.EMAIL_NOT_FOUND,
          uid,
        );
      }
      return Buffer.isBuffer(fetchResult.source)
        ? fetchResult.source
        : Buffer.from(fetchResult.source);
    } finally {
      lock.release();
    }
  } catch (error) {
    if (error instanceof EmailError) throw error;
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    await client.logout().catch(() => {});
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/ImapService.test.ts -t "appendMessage|fetchRawSource"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/services/ImapService.ts packages/email-mcp/src/__tests__/ImapService.test.ts
git commit -m "feat(email-mcp): add appendMessage and fetchRawSource to ImapService"
```

---

### Task 4: Add `composeRawMessage()` and `sendRawMessage()` to SmtpService

**Files:**
- Modify: `packages/email-mcp/src/services/SmtpService.ts`
- Test: `packages/email-mcp/src/__tests__/SmtpService.test.ts`

- [ ] **Step 1: Write failing tests for composeRawMessage**

Add to `SmtpService.test.ts`:

```typescript
describe("composeRawMessage", () => {
  it("composes a basic email to RFC 822 Buffer", async () => {
    const raw = await service.composeRawMessage({
      from: '"Test User" <user@test.com>',
      to: ["recipient@test.com"],
      subject: "Test Subject",
      text: "Hello world",
    });

    expect(Buffer.isBuffer(raw)).toBe(true);
    const content = raw.toString();
    expect(content).toContain("Subject: Test Subject");
    expect(content).toContain("To: recipient@test.com");
    expect(content).toContain("Hello world");
  });

  it("includes In-Reply-To and References headers when provided", async () => {
    const raw = await service.composeRawMessage({
      from: '"Test User" <user@test.com>',
      to: ["recipient@test.com"],
      subject: "Re: Original",
      text: "Reply body",
      inReplyTo: "<original@test.com>",
      references: ["<root@test.com>", "<original@test.com>"],
    });

    const content = raw.toString();
    expect(content).toContain("In-Reply-To: <original@test.com>");
    expect(content).toContain("References: <root@test.com> <original@test.com>");
  });

  it("includes CC and BCC headers", async () => {
    const raw = await service.composeRawMessage({
      from: "user@test.com",
      to: ["a@test.com"],
      cc: ["b@test.com"],
      bcc: ["c@test.com"],
      subject: "Test",
      text: "Hello",
    });

    const content = raw.toString();
    expect(content).toContain("Cc: b@test.com");
    expect(content).toContain("Bcc: c@test.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/SmtpService.test.ts -t "composeRawMessage"`
Expected: FAIL — `composeRawMessage` is not a function.

- [ ] **Step 3: Implement composeRawMessage**

In `SmtpService.ts`, add the `ComposeOptions` interface and method:

```typescript
import MailComposer from "nodemailer/lib/mail-composer/index.js";

export interface ComposeOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer;
    contentType?: string;
  }>;
  inReplyTo?: string;
  references?: string[];
}

// Inside SmtpService class:
async composeRawMessage(options: ComposeOptions): Promise<Buffer> {
  const composer = new MailComposer({
    from: options.from,
    to: options.to.join(", "),
    cc: options.cc?.join(", "),
    bcc: options.bcc?.join(", "),
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: options.attachments,
    inReplyTo: options.inReplyTo,
    references: options.references?.join(" "),
  });

  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/SmtpService.test.ts -t "composeRawMessage"`
Expected: PASS

- [ ] **Step 5: Write failing tests for sendRawMessage**

Add to `SmtpService.test.ts`:

```typescript
describe("sendRawMessage", () => {
  it("sends a pre-composed raw message via SMTP", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "<raw-1@test.com>",
      accepted: ["recipient@test.com"],
      rejected: [],
    });

    const raw = Buffer.from("Subject: Test\r\n\r\nHello");
    const result = await service.sendRawMessage(raw, {
      from: "user@test.com",
      to: ["recipient@test.com"],
    });

    expect(result.messageId).toBe("<raw-1@test.com>");
    expect(mockSendMail).toHaveBeenCalledWith({
      envelope: { from: "user@test.com", to: ["recipient@test.com"] },
      raw,
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/SmtpService.test.ts -t "sendRawMessage"`
Expected: FAIL — `sendRawMessage` is not a function.

- [ ] **Step 7: Implement sendRawMessage**

Add to `SmtpService` class:

```typescript
async sendRawMessage(
  rawSource: Buffer,
  envelope: { from: string; to: string[] },
): Promise<SendResult> {
  const transporter = this.createTransporter();
  try {
    const info = await transporter.sendMail({
      envelope,
      raw: rawSource,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted as string[],
      rejected: info.rejected as string[],
    };
  } catch (error) {
    throw toPimError(error instanceof Error ? error : new Error(String(error)));
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/SmtpService.test.ts`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add packages/email-mcp/src/services/SmtpService.ts packages/email-mcp/src/__tests__/SmtpService.test.ts
git commit -m "feat(email-mcp): add composeRawMessage and sendRawMessage to SmtpService"
```

---

### Task 5: Add `autoSent` to EmailConfig

**Files:**
- Modify: `packages/core/src/config.ts:107-165`
- Test: `packages/core/src/__tests__/emailConfig.test.ts`

- [ ] **Step 1: Write failing test for SMTP_AUTO_SENT**

Add to `emailConfig.test.ts`:

Use `vi.stubEnv` to match the existing test patterns in this file:

```typescript
it("reads SMTP_AUTO_SENT as autoSent boolean", () => {
  vi.stubEnv("SMTP_AUTO_SENT", "true");
  const config = loadEmailConfig();
  expect(config.autoSent).toBe(true);
});

it("defaults autoSent to false when SMTP_AUTO_SENT is not set", () => {
  const config = loadEmailConfig();
  expect(config.autoSent).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/__tests__/emailConfig.test.ts -t "SMTP_AUTO_SENT|autoSent"`
Expected: FAIL — `autoSent` not on config.

- [ ] **Step 3: Add autoSent to EmailConfig and loadEmailConfig**

In `config.ts`, add to `EmailConfig` interface (after `fromName`):

```typescript
autoSent?: boolean;
```

In `loadEmailConfig()`, add to the return object (after `fromName`):

```typescript
autoSent: process.env.SMTP_AUTO_SENT === "true",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/__tests__/emailConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/__tests__/emailConfig.test.ts
git commit -m "feat(core): add autoSent config for SMTP_AUTO_SENT env var"
```

---

### Task 6: Update `send_email` tool schema, handler, and add `send_draft` tool

This is the integration task. It wires together all the infrastructure from Tasks 1-5.

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts:122-178` (send_email schema), `336-415` (handler)
- Test: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Update tool schema tests**

In `emailTools.test.ts`, update the existing test and add new ones:

```typescript
// Update existing test (line 45-49):
it("send_email requires only to", () => {
  const tool = EMAIL_TOOLS.find((t) => t.name === "send_email")!;
  expect(tool.inputSchema.required).toEqual(["to"]);
});

it("send_email has replyToUid, replyToFolder, and saveToDrafts properties", () => {
  const tool = EMAIL_TOOLS.find((t) => t.name === "send_email")!;
  const props = tool.inputSchema.properties as Record<string, unknown>;
  expect(props).toHaveProperty("replyToUid");
  expect(props).toHaveProperty("replyToFolder");
  expect(props).toHaveProperty("saveToDrafts");
});

// Update tool count test:
it("defines 12 tools", () => {
  expect(EMAIL_TOOLS).toHaveLength(12);
});

// Add send_draft to expected tool names test:
it("defines the expected tool names", () => {
  const names = EMAIL_TOOLS.map((t) => t.name);
  // ...existing expects...
  expect(names).toContain("send_draft");
});

it("send_draft requires uid", () => {
  const tool = EMAIL_TOOLS.find((t) => t.name === "send_draft")!;
  expect(tool.inputSchema.required).toEqual(["uid"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: FAIL — tool count is 11, send_email still requires subject, send_draft doesn't exist.

- [ ] **Step 3: Update send_email tool schema**

In `emailTools.ts`, update the `send_email` tool definition (lines 122-178):

- Update `description` to: `"Compose and send an email, or save it as a draft. Supports replies with automatic threading — when replyToUid is provided, the tool fetches the original email and sets correct In-Reply-To/References headers and Re: subject prefix automatically. Set saveToDrafts to true to save to the Drafts folder instead of sending. Sent emails are automatically copied to the Sent folder."`
- Add `replyToUid`, `replyToFolder`, `saveToDrafts` properties (see spec for exact schemas)
- Update `subject` description to: `"Email subject line. Required for new emails. When replyToUid is set and subject is omitted, automatically uses 'Re: <original subject>'. When provided explicitly, used as-is."`
- Change `required` from `["to", "subject"]` to `["to"]`

- [ ] **Step 4: Add send_draft tool definition**

Add after `get_folder_status` in `EMAIL_TOOLS` array:

```typescript
{
  name: "send_draft",
  description:
    "Send an existing email draft from the Drafts folder. Fetches the draft's raw RFC 822 source, sends it via SMTP, copies it to the Sent folder, and removes it from Drafts. The draft must already exist — use send_email with saveToDrafts: true to create one.",
  inputSchema: {
    type: "object",
    properties: {
      uid: {
        type: "number",
        description: "UID of the draft email in the Drafts folder.",
      },
      folder: {
        type: "string",
        description: "IMAP folder containing the draft. Defaults to the server's Drafts folder.",
      },
    },
    required: ["uid"],
  },
},
```

- [ ] **Step 5: Run schema tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts -t "definitions"`
Expected: PASS

- [ ] **Step 6: Commit schema changes**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): update send_email schema, add send_draft tool definition"
```

---

### Task 7: Implement `send_email` handler with threading, drafts, and Sent copy

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts:404-415` (send_email handler case)
- Test: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Update mocks in emailTools.test.ts**

Update the mock setup at the top to include all needed service methods:

```typescript
const mockFetchEmail = vi.fn();
const mockGetSpecialUseFolder = vi.fn();
const mockAppendMessage = vi.fn();
const mockFetchRawSource = vi.fn();

const mockImapService = {
  fetchEmail: mockFetchEmail,
  getSpecialUseFolder: mockGetSpecialUseFolder,
  appendMessage: mockAppendMessage,
  fetchRawSource: mockFetchRawSource,
} as any;

const mockSendEmail = vi.fn();
const mockComposeRawMessage = vi.fn();
const mockSendRawMessage = vi.fn();

const mockSmtpService = {
  sendEmail: mockSendEmail,
  composeRawMessage: mockComposeRawMessage,
  sendRawMessage: mockSendRawMessage,
  config: { autoSent: false, fromName: "Test User", smtp: { user: "user@test.com" } },
} as any;
```

- [ ] **Step 2: Write failing tests for send_email handler**

Add to `emailTools.test.ts`:

```typescript
describe("send_email handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComposeRawMessage.mockResolvedValue(Buffer.from("raw-message"));
    mockSendRawMessage.mockResolvedValue({
      messageId: "<sent-1@test.com>",
      accepted: ["r@test.com"],
      rejected: [],
    });
    mockGetSpecialUseFolder.mockResolvedValue("Sent");
    mockAppendMessage.mockResolvedValue({ uid: 100 });
  });

  it("returns VALIDATION_FAILED when no subject and no replyToUid", async () => {
    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], text: "Hello" },
      mockImapService,
      mockSmtpService,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("subject is required");
  });

  it("sends new email and appends to Sent folder", async () => {
    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], subject: "Hi", text: "Hello" },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("sent");
    expect(parsed.messageId).toBe("<sent-1@test.com>");
    expect(mockComposeRawMessage).toHaveBeenCalled();
    expect(mockSendRawMessage).toHaveBeenCalled();
    expect(mockAppendMessage).toHaveBeenCalledWith("Sent", expect.any(Buffer), ["\\Seen"]);
  });

  it("auto-derives subject when replyToUid is set and subject is omitted", async () => {
    mockFetchEmail.mockResolvedValueOnce({
      uid: 42,
      messageId: "<original@test.com>",
      subject: "Original Subject",
      inReplyTo: null,
      references: [],
    });

    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], text: "Reply", replyToUid: 42 },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("sent");
    expect(mockComposeRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Re: Original Subject",
        inReplyTo: "<original@test.com>",
        references: ["<original@test.com>"],
      }),
    );
  });

  it("uses explicit subject even for replies", async () => {
    mockFetchEmail.mockResolvedValueOnce({
      uid: 42,
      messageId: "<original@test.com>",
      subject: "Original Subject",
      inReplyTo: null,
      references: [],
    });

    await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], subject: "Custom Subject", text: "Reply", replyToUid: 42 },
      mockImapService,
      mockSmtpService,
    );

    expect(mockComposeRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Custom Subject" }),
    );
  });

  it("builds References chain from original email", async () => {
    mockFetchEmail.mockResolvedValueOnce({
      uid: 42,
      messageId: "<mid@test.com>",
      subject: "Thread",
      inReplyTo: "<root@test.com>",
      references: ["<root@test.com>"],
    });

    await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], text: "Reply", replyToUid: 42 },
      mockImapService,
      mockSmtpService,
    );

    expect(mockComposeRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<mid@test.com>",
        references: ["<root@test.com>", "<mid@test.com>"],
      }),
    );
  });

  it("saves as draft when saveToDrafts is true", async () => {
    mockGetSpecialUseFolder.mockResolvedValue("Drafts");
    mockAppendMessage.mockResolvedValue({ uid: 200 });

    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], subject: "Draft", text: "WIP", saveToDrafts: true },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("draft");
    expect(parsed.uid).toBe(200);
    expect(parsed.folder).toBe("Drafts");
    expect(mockSendRawMessage).not.toHaveBeenCalled();
    expect(mockAppendMessage).toHaveBeenCalledWith("Drafts", expect.any(Buffer), ["\\Draft", "\\Seen"]);
  });

  it("saves threaded draft when saveToDrafts and replyToUid both set", async () => {
    mockFetchEmail.mockResolvedValueOnce({
      uid: 42,
      messageId: "<original@test.com>",
      subject: "Original",
      inReplyTo: null,
      references: [],
    });
    mockGetSpecialUseFolder.mockResolvedValue("Drafts");
    mockAppendMessage.mockResolvedValue({ uid: 201 });

    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], text: "Draft reply", replyToUid: 42, saveToDrafts: true },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("draft");
    expect(mockComposeRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Re: Original",
        inReplyTo: "<original@test.com>",
      }),
    );
  });

  it("does not double-prefix Re: when original subject already starts with Re:", async () => {
    mockFetchEmail.mockResolvedValueOnce({
      uid: 42,
      messageId: "<original@test.com>",
      subject: "Re: Already a reply",
      inReplyTo: "<root@test.com>",
      references: ["<root@test.com>"],
    });

    await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], text: "Reply", replyToUid: 42 },
      mockImapService,
      mockSmtpService,
    );

    expect(mockComposeRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: Already a reply" }),
    );
  });

  it("still returns sent status when Sent folder APPEND fails", async () => {
    mockGetSpecialUseFolder.mockResolvedValue("Sent");
    mockAppendMessage.mockRejectedValueOnce(new Error("IMAP connection lost"));

    const result = await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], subject: "Hi", text: "Hello" },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("sent");
    expect(parsed.messageId).toBe("<sent-1@test.com>");
  });

  it("skips Sent folder append when autoSent is true", async () => {
    mockSmtpService.config = { autoSent: true, fromName: "Test User", smtp: { user: "user@test.com" } };

    await handleEmailTool(
      "send_email",
      { to: ["r@test.com"], subject: "Hi", text: "Hello" },
      mockImapService,
      mockSmtpService,
    );

    expect(mockAppendMessage).not.toHaveBeenCalled();
    mockSmtpService.config = { autoSent: false, fromName: "Test User", smtp: { user: "user@test.com" } };
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts -t "send_email handler"`
Expected: FAIL — handler doesn't use composeRawMessage, doesn't handle replyToUid, etc.

- [ ] **Step 4: Implement the updated send_email handler**

Replace the `case "send_email"` block in `handleEmailTool` (lines 404-415 of emailTools.ts). The handler needs access to the smtp config for `autoSent`, so update the SmtpService to expose it as a public getter, or pass config directly. The simplest approach: add a public `config` getter on SmtpService.

In `SmtpService.ts`, change `private config` to `readonly config`:

```typescript
readonly config: EmailConfig;
```

In `emailTools.ts`, update the `send_email` case:

```typescript
case "send_email": {
  const to = args.to as string[];
  const cc = args.cc as string[] | undefined;
  const bcc = args.bcc as string[] | undefined;
  const text = args.text as string | undefined;
  const html = args.html as string | undefined;
  const attachments = args.attachments as any[] | undefined;
  const replyToUid = args.replyToUid as number | undefined;
  const replyToFolder = (args.replyToFolder as string) || "INBOX";
  const saveToDrafts = (args.saveToDrafts as boolean) || false;
  let subject = args.subject as string | undefined;

  // Validation: subject required when not replying
  if (!subject && !replyToUid) {
    return error("subject is required when not replying to an existing email");
  }

  // Threading: fetch original email for reply context
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  if (replyToUid) {
    const original = await imapService.fetchEmail(replyToFolder, replyToUid);
    inReplyTo = original.messageId;
    references = [...(original.references || [])];
    if (original.messageId && !references.includes(original.messageId)) {
      references.push(original.messageId);
    }
    if (!subject) {
      const origSubject = original.subject || "";
      subject = origSubject.startsWith("Re:") ? origSubject : `Re: ${origSubject}`;
    }
  }

  // Compose RFC 822 message
  const from = smtpService.config.fromName
    ? `"${smtpService.config.fromName}" <${smtpService.config.smtp.user}>`
    : smtpService.config.smtp.user;

  const rawMessage = await smtpService.composeRawMessage({
    from,
    to,
    cc,
    bcc,
    subject: subject!,
    text,
    html,
    attachments,
    inReplyTo,
    references,
  });

  if (saveToDrafts) {
    // Draft mode: APPEND to Drafts folder
    const draftsFolder = await imapService.getSpecialUseFolder("\\Drafts");
    const appendResult = await imapService.appendMessage(draftsFolder, rawMessage, [
      "\\Draft",
      "\\Seen",
    ]);
    return ok(
      JSON.stringify({ status: "draft", uid: appendResult.uid, folder: draftsFolder }),
    );
  }

  // Send mode: SMTP send + APPEND to Sent
  const envelope = {
    from: smtpService.config.smtp.user,
    to: [...to, ...(cc || []), ...(bcc || [])],
  };
  const sendResult = await smtpService.sendRawMessage(rawMessage, envelope);

  let sentFolderPath = "Sent";
  if (!smtpService.config.autoSent) {
    try {
      sentFolderPath = await imapService.getSpecialUseFolder("\\Sent");
      await imapService.appendMessage(sentFolderPath, rawMessage, ["\\Seen"]);
    } catch (appendError) {
      console.error("[email-mcp] Failed to copy to Sent folder:", appendError);
    }
  }

  return ok(
    JSON.stringify({
      status: "sent",
      messageId: sendResult.messageId,
      folder: sentFolderPath,
    }),
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/services/SmtpService.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): implement send_email threading, drafts, and Sent folder copy"
```

---

### Task 8: Implement `send_draft` handler

**Files:**
- Modify: `packages/email-mcp/src/tools/emailTools.ts` (handler switch)
- Test: `packages/email-mcp/src/__tests__/emailTools.test.ts`

- [ ] **Step 1: Write failing tests for send_draft handler**

Add to `emailTools.test.ts`:

```typescript
describe("send_draft handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSpecialUseFolder.mockImplementation((flag: string) => {
      if (flag === "\\Drafts") return Promise.resolve("Drafts");
      if (flag === "\\Sent") return Promise.resolve("Sent");
      return Promise.reject(new Error("unknown flag"));
    });
    mockSendRawMessage.mockResolvedValue({
      messageId: "<sent-draft@test.com>",
      accepted: ["r@test.com"],
      rejected: [],
    });
    mockAppendMessage.mockResolvedValue({ uid: 300 });
    mockSmtpService.config = { autoSent: false, smtp: { user: "user@test.com" } };
  });

  it("fetches draft, sends via SMTP, copies to Sent, deletes from Drafts", async () => {
    const rawDraft = Buffer.from(
      "From: user@test.com\r\nTo: r@test.com\r\nSubject: Draft\r\nMessage-ID: <draft-1@test.com>\r\n\r\nDraft body",
    );
    mockFetchRawSource.mockResolvedValueOnce(rawDraft);

    // Mock deleteEmails for draft deletion
    const mockDeleteEmails = vi.fn().mockResolvedValue(undefined);
    mockImapService.deleteEmails = mockDeleteEmails;

    const result = await handleEmailTool(
      "send_draft",
      { uid: 500 },
      mockImapService,
      mockSmtpService,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("sent");
    expect(parsed.messageId).toBe("<sent-draft@test.com>");

    // Verify draft was fetched from Drafts folder
    expect(mockFetchRawSource).toHaveBeenCalledWith("Drafts", 500);

    // Verify SMTP send
    expect(mockSendRawMessage).toHaveBeenCalledWith(rawDraft, expect.objectContaining({
      from: "user@test.com",
      to: expect.arrayContaining(["r@test.com"]),
    }));

    // Verify Sent copy
    expect(mockAppendMessage).toHaveBeenCalledWith("Sent", rawDraft, ["\\Seen"]);

    // Verify draft deletion (permanent)
    expect(mockDeleteEmails).toHaveBeenCalledWith("Drafts", [500], true);
  });

  it("returns EMAIL_NOT_FOUND when draft does not exist", async () => {
    mockFetchRawSource.mockRejectedValueOnce(
      new Error("Email UID 999 not found"),
    );

    const result = await handleEmailTool(
      "send_draft",
      { uid: 999 },
      mockImapService,
      mockSmtpService,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("uses custom folder when provided", async () => {
    const rawDraft = Buffer.from(
      "From: user@test.com\r\nTo: r@test.com\r\nSubject: Test\r\nMessage-ID: <d@test.com>\r\n\r\nBody",
    );
    mockFetchRawSource.mockResolvedValueOnce(rawDraft);
    mockImapService.deleteEmails = vi.fn().mockResolvedValue(undefined);

    await handleEmailTool(
      "send_draft",
      { uid: 500, folder: "My Drafts" },
      mockImapService,
      mockSmtpService,
    );

    expect(mockFetchRawSource).toHaveBeenCalledWith("My Drafts", 500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts -t "send_draft handler"`
Expected: FAIL — `send_draft` not handled.

- [ ] **Step 3: Implement send_draft handler**

Add `import { simpleParser } from "mailparser";` at the top of `emailTools.ts` (needed to parse envelope from raw source). Note: `simpleParser` is intentionally NOT mocked in `emailTools.test.ts` — the tests provide well-formed raw RFC 822 buffers that the real parser can handle. This gives us integration-level confidence that envelope extraction works correctly.

Add to the switch statement in `handleEmailTool`:

```typescript
case "send_draft": {
  const uid = args.uid as number;
  const draftFolder =
    (args.folder as string) || (await imapService.getSpecialUseFolder("\\Drafts"));

  // Fetch raw source
  const rawSource = await imapService.fetchRawSource(draftFolder, uid);

  // Parse headers for SMTP envelope
  const parsed = await simpleParser(rawSource);
  const toAddrs = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [])
    .flatMap((addr) => addr.value)
    .map((a) => a.address)
    .filter((a): a is string => !!a);
  const ccAddrs = (Array.isArray(parsed.cc) ? parsed.cc : parsed.cc ? [parsed.cc] : [])
    .flatMap((addr) => addr.value)
    .map((a) => a.address)
    .filter((a): a is string => !!a);
  const bccAddrs = (Array.isArray(parsed.bcc) ? parsed.bcc : parsed.bcc ? [parsed.bcc] : [])
    .flatMap((addr) => addr.value)
    .map((a) => a.address)
    .filter((a): a is string => !!a);

  const allRecipients = [...toAddrs, ...ccAddrs, ...bccAddrs];
  if (allRecipients.length === 0) {
    return error("Draft has no recipients — cannot send");
  }

  // Send via SMTP
  const envelope = {
    from: smtpService.config.smtp.user,
    to: allRecipients,
  };
  const sendResult = await smtpService.sendRawMessage(rawSource, envelope);

  // Copy to Sent
  let sentFolderPath = "Sent";
  if (!smtpService.config.autoSent) {
    try {
      sentFolderPath = await imapService.getSpecialUseFolder("\\Sent");
      await imapService.appendMessage(sentFolderPath, rawSource, ["\\Seen"]);
    } catch (appendError) {
      console.error("[email-mcp] Failed to copy to Sent folder:", appendError);
    }
  }

  // Delete draft (permanently — not move to Trash)
  await imapService.deleteEmails(draftFolder, [uid], true);

  return ok(
    JSON.stringify({
      status: "sent",
      messageId: sendResult.messageId,
      folder: sentFolderPath,
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/email-mcp && npx vitest run src/__tests__/emailTools.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/email-mcp/src/tools/emailTools.ts packages/email-mcp/src/__tests__/emailTools.test.ts
git commit -m "feat(email-mcp): implement send_draft handler"
```

---

### Task 9: Full test suite + build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all email-mcp tests**

Run: `cd packages/email-mcp && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run full monorepo build**

Run: `npm run build`
Expected: Clean build, no type errors.

- [ ] **Step 3: Run full monorepo test suite**

Run: `npm test`
Expected: All tests across all packages PASS.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: No lint errors (fix any formatting issues with `npm run format` if needed).

- [ ] **Step 6: Final commit if any formatting fixes**

```bash
git add -A
git commit -m "chore(email-mcp): fix formatting"
```

---

## Dependency Order

```
Task 1 (get_email threading fields)
  └─ no dependencies — standalone

Task 2 (getSpecialUseFolder)
  └─ no dependencies — standalone

Task 3 (appendMessage + fetchRawSource)
  └─ no dependencies — standalone

Task 4 (composeRawMessage + sendRawMessage)
  └─ no dependencies — standalone

Task 5 (autoSent config)
  └─ no dependencies — standalone

Tasks 1-5 can run in parallel.

Task 6 (send_email handler) ← depends on Tasks 1-5
Task 7 (send_email handler implementation) ← depends on Task 6
Task 8 (send_draft handler) ← depends on Tasks 3, 4, 5, 6

Task 9 (verification) ← depends on all above
```

**Parallelizable groups:**
- **Group A (infrastructure):** Tasks 1, 2, 3, 4, 5 — all independent
- **Group B (integration):** Tasks 6, 7, 8 — sequential, depends on Group A
- **Group C (verification):** Task 9 — depends on all
