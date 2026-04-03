# Email Draft, Threading & Sent Folder — Design Spec

**Date:** March 20, 2026
**Status:** Implemented (email-mcp@0.7.0)
**Scope:** `@miguelarios/email-mcp` — Add draft management, reply threading, and Sent folder copy
**Changes:** 1 new tool (`send_draft`), 2 enhanced tools (`send_email`, `get_email`)

---

## Problem

The current `send_email` tool is a thin SMTP wrapper. Three gaps cause broken user experiences:

1. **No threading.** Sent replies appear as new conversations in every email client. The tool accepts no `In-Reply-To` or `References` headers, so replies are orphaned from their original thread.

2. **No Sent folder copy.** SMTP delivers to the recipient but does not touch the sender's mailbox. Most IMAP servers (including Mailbox.org's Dovecot backend) do not auto-copy to Sent — that's a Gmail-specific behavior. Sent emails vanish from the user's perspective.

3. **No draft support.** There is no way to save an email as a draft for later review, editing, or collaborative iteration. The only option is immediate send.

These are not novel problems. Every email client (Apple Mail, Thunderbird, Gmail web, Outlook) solves all three transparently. The MCP should operate at the same abstraction level: the agent expresses intent ("reply to this," "save as draft," "send that draft") and the tool handles all IMAP/SMTP choreography internally.

---

## Design Principles

**Intent over protocol.** The agent should never need to know about `In-Reply-To` headers, IMAP APPEND, or RFC 822 message construction. A weaker or cheaper model should produce correct results with no protocol knowledge.

**Draft-first is the safe default.** The emerging best practice across the email MCP ecosystem is "always draft, never send" — Anthropic's own Gmail connector only creates drafts and cannot send. Harper Reed's Claude Code email workflow enforces drafts-only so the human reviews before sending. The MCP should make drafting the natural path, with direct send as an explicit opt-in.

**The Drafts folder is the collaboration surface.** In the collaborative workflow, the human edits in their email client and the agent reads/revises via the MCP. The draft must appear correctly threaded so the human sees proper context. Every draft the MCP saves must be a fully valid RFC 822 message with correct threading headers.

**Copy to Sent by default.** Since there is no standard way to detect whether an SMTP server auto-copies to Sent, the safe default is always APPEND after send. A config flag (`SMTP_AUTO_SENT=true`) can disable this for providers like Gmail that handle it server-side.

---

## Changes Summary

| Change | Tool | Type |
|--------|------|------|
| Add reply threading, draft mode, Sent folder copy | `send_email` | Enhanced |
| Return threading headers in response | `get_email` | Enhanced |
| Send an existing draft from Drafts folder | `send_draft` | New |

---

## Change 1: Enhanced `send_email`

### Current State

Composes and sends via SMTP. No threading, no drafts, no Sent copy.

### New Behavior

The tool now supports three modes based on parameter combinations:

- **Send new email:** `saveToDrafts` omitted or `false`, no `replyToUid` → compose, SMTP send, APPEND to Sent.
- **Send reply:** `replyToUid` provided, `saveToDrafts` omitted or `false` → fetch original for threading context, compose with headers, SMTP send, APPEND to Sent.
- **Save as draft:** `saveToDrafts: true` → compose (with threading if `replyToUid` provided), APPEND to Drafts folder. No SMTP send.

### Tool Definition

```json
{
  "name": "send_email",
  "description": "Compose and send an email, or save it as a draft. Supports replies with automatic threading — when replyToUid is provided, the tool fetches the original email and sets correct In-Reply-To/References headers and Re: subject prefix automatically. Set saveToDrafts to true to save to the Drafts folder instead of sending. Sent emails are automatically copied to the Sent folder.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "to": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Recipient email addresses."
      },
      "cc": {
        "type": "array",
        "items": { "type": "string" },
        "description": "CC email addresses."
      },
      "bcc": {
        "type": "array",
        "items": { "type": "string" },
        "description": "BCC email addresses."
      },
      "subject": {
        "type": "string",
        "description": "Email subject line. When replyToUid is set and subject is omitted, automatically uses 'Re: <original subject>'."
      },
      "text": {
        "type": "string",
        "description": "Plain text body."
      },
      "html": {
        "type": "string",
        "description": "HTML body."
      },
      "attachments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "filename": { "type": "string" },
            "path": { "type": "string", "description": "File path to attach." },
            "content": { "type": "string", "description": "String content to attach." }
          },
          "required": ["filename"]
        },
        "description": "File attachments."
      },
      "replyToUid": {
        "type": "number",
        "description": "UID of the email to reply to. When set, the tool automatically fetches the original email's Message-ID and References chain, sets In-Reply-To and References headers, and prepends 'Re:' to the subject if not already present. The reply will appear threaded in all email clients."
      },
      "replyToFolder": {
        "type": "string",
        "description": "IMAP folder containing the email referenced by replyToUid. Defaults to INBOX."
      },
      "saveToDrafts": {
        "type": "boolean",
        "description": "When true, saves the composed email to the Drafts folder instead of sending it. The draft will appear in any email client and can be edited there. Defaults to false."
      }
    },
    "required": ["to"]
  }
}
```

### Validation

- If `subject` is omitted and `replyToUid` is not provided → return validation error (`VALIDATION_FAILED`): "subject is required when not replying to an existing email"
- If `subject` is provided explicitly → use it as-is (override path, even for replies)
- If `subject` is omitted and `replyToUid` is provided → auto-derive as `Re: <original subject>`

### Internal Flow: Send Mode (`saveToDrafts` is false or omitted)

```
1. Validate: if no subject and no replyToUid, return VALIDATION_FAILED
2. If replyToUid provided:
   a. Fetch original email from replyToFolder (default INBOX)
   b. Extract Message-ID → set as In-Reply-To header
   c. Extract References chain → append Message-ID → set as References header
   d. If subject not provided → use "Re: <original subject>"
      If subject provided but doesn't start with "Re:" → use as-is (explicit override)
3. Build RFC 822 message via nodemailer MailComposer
   - Set From using SMTP_USER + SMTP_FROM_NAME
   - Set all addressing headers (To, Cc, Bcc)
   - Set threading headers (In-Reply-To, References) if replying
   - Generate Message-ID
4. Send raw message via SMTP
5. IMAP APPEND the same raw message to Sent folder with [\Seen] flag
   - Sent folder discovered via RFC 6154 special-use flag (\Sent)
   - Falls back to common names: "Sent", "Sent Messages", "Sent Items"
6. Return { status: "sent", messageId, folder: "Sent" }
```

### Internal Flow: Draft Mode (`saveToDrafts` is true)

```
1. Validate: if no subject and no replyToUid, return VALIDATION_FAILED
2. If replyToUid provided:
   a–d. Same threading header construction as send mode
3. Build RFC 822 message via nodemailer MailComposer (same as send mode)
4. IMAP APPEND to Drafts folder with [\Draft, \Seen] flags
   - Drafts folder discovered via RFC 6154 special-use flag (\Drafts)
   - Falls back to common names: "Drafts"
5. Return { status: "draft", uid: <new draft UID>, folder: "Drafts" }
```

### Response Schema

```typescript
// Send mode
{ status: "sent", messageId: string, folder: string }

// Draft mode
{ status: "draft", uid: number, folder: string }
```

---

## Change 2: Enhanced `get_email`

### Current State

Returns email headers, body, and attachment metadata. Does not return `messageId`, `inReplyTo`, or `references` fields needed for threading context.

### New Behavior

The response now includes threading headers so the agent has full context when constructing replies or understanding conversation structure.

### Tool Definition Changes

The tool schema (input parameters) is **unchanged**. Only the response payload is extended.

### Response Schema Changes

```typescript
interface EmailFull {
  // Existing fields (unchanged)
  uid: number;
  subject: string;
  from: { name?: string; address: string };
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  date: string;
  flags: string[];
  hasAttachments: boolean;
  textBody?: string;
  htmlBody?: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    partId: string;
  }>;

  // New threading fields
  messageId: string;       // The email's Message-ID header (already on EmailSummary, now also on full)
  inReplyTo: string | null; // Message-ID of the parent email, null if not a reply
  references: string[];     // Full References chain as array of Message-IDs, empty if none
}
```

### Implementation Notes

The `messageId` field already exists on `EmailSummary` but the parsing in `fetchEmail` already extracts it via `mailparser`. The two new fields come from `mailparser`'s `parsed.inReplyTo` (string) and `parsed.references` (already an array of strings — no splitting needed).

---

## Change 3: New `send_draft` Tool

### Purpose

Sends an existing draft from the Drafts folder. This covers two workflows:

1. The agent saved a draft via `send_email` with `saveToDrafts: true`, the user said "send it."
2. The user and agent collaborated on a draft (editing in email client, refining via MCP), and it's ready to go.

### Tool Definition

```json
{
  "name": "send_draft",
  "description": "Send an existing email draft from the Drafts folder. Fetches the draft's raw RFC 822 source, sends it via SMTP, copies it to the Sent folder, and removes it from Drafts. The draft must already exist in the Drafts folder — use send_email with saveToDrafts: true to create one.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "uid": {
        "type": "number",
        "description": "UID of the draft email in the Drafts folder."
      },
      "folder": {
        "type": "string",
        "description": "IMAP folder containing the draft. Defaults to the server's Drafts folder."
      }
    },
    "required": ["uid"]
  }
}
```

### Internal Flow

```
1. Fetch raw RFC 822 source of the draft from Drafts folder (via IMAP FETCH BODY[])
2. Parse headers to extract To/Cc/Bcc recipients for SMTP envelope
3. Send raw message via SMTP
4. IMAP APPEND the raw message to Sent folder with [\Seen] flag
5. Delete the draft: STORE +FLAGS (\Deleted) on the UID, then EXPUNGE
6. Return { status: "sent", messageId, folder: "Sent" }
```

### Response Schema

```typescript
{ status: "sent", messageId: string, folder: string }
```

### Edge Cases

- **Draft has been edited in email client:** The user may have modified the draft via Apple Mail, Thunderbird, or webmail since the agent last saved it. This is expected and correct — `send_draft` always sends whatever is currently in the Drafts folder at that UID, not what the agent originally composed. The email client's edits are preserved.
- **Draft no longer exists:** If the UID doesn't exist (user deleted it, or it was already sent), return an error with code `EMAIL_NOT_FOUND`.
- **Draft has no recipients:** If the To header is empty after parsing, return an error with code `SEND_FAILED` and a descriptive message.

---

## Shared Infrastructure: Special-Use Folder Discovery

Both `send_email` (for Sent and Drafts folders) and `send_draft` (for Drafts and Sent) need to find the correct folder paths. Folder names vary across providers ("Sent", "Sent Messages", "Sent Items", etc.).

### Approach

Use RFC 6154 special-use flags via `imapflow`'s `list()` method, which returns folder attributes including `\Sent`, `\Drafts`, `\Trash`, etc. Cache the mapping per connection.

```typescript
// New method on ImapService
async getSpecialUseFolder(flag: '\\Sent' | '\\Drafts' | '\\Trash'): Promise<string> {
  // 1. LIST with special-use flags
  // 2. Find folder with matching flag
  // 3. Fallback to common names if flag not found
  // 4. Throw FOLDER_NOT_FOUND if nothing matches
}
```

### Fallback Names

| Flag | Fallbacks |
|------|-----------|
| `\Sent` | "Sent", "Sent Messages", "Sent Items", "INBOX.Sent" |
| `\Drafts` | "Drafts", "Draft", "INBOX.Drafts" |

---

## Shared Infrastructure: Raw Message Composition

Both `send_email` (all modes) and the Sent folder copy need to produce a raw RFC 822 message from the composed email.

### Approach

Use `nodemailer`'s `MailComposer` class (already available via the nodemailer dependency) to build the message, then call `compile().createReadStream()` to get the raw source as a Buffer. This is the same message object used for SMTP send, ensuring the IMAP APPEND copy is byte-identical to what was delivered.

```typescript
// New method on SmtpService
async composeRawMessage(options: ComposeOptions): Promise<Buffer> {
  // Uses nodemailer MailComposer to build RFC 822 source
  // Returns raw Buffer suitable for both SMTP send and IMAP APPEND
}
```

---

## Configuration

### New Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_AUTO_SENT` | No | `false` | Set to `true` if the SMTP server auto-copies to Sent (e.g., Gmail). Disables the IMAP APPEND to Sent after send. |

---

## Use Cases

### Use Case 1: Agent-Driven Send (New or Reply)

The "handle my email" flow. The user tells the assistant what to do, it composes in chat, and either sends directly or checkpoints with a draft.

#### 1A: Net New Email, Send Directly

```
USER    "Send an email to jane@acme.com letting her know I can't
         make Thursday's meeting and suggest Friday instead."

AGENT   [composes in chat, shows user the draft text]
        "Here's what I'll send:

         To: jane@acme.com
         Subject: Thursday Meeting — Need to Reschedule
         Hi Jane, ...

         Want me to send this or make changes?"

USER    "Looks good, send it."

AGENT   → send_email {
           to: ["jane@acme.com"],
           subject: "Thursday Meeting — Need to Reschedule",
           text: "Hi Jane, ..."
         }

MCP     1. Build RFC 822 message
        2. SMTP send
        3. IMAP APPEND to Sent with [\Seen]
        4. → { status: "sent", messageId: "<abc@...>" }

AGENT   "Sent! Jane should have it now."
```

#### 1B: Reply to Existing Email, Save as Draft First

```
USER    "That recruiter email from Sarah at TechCorp — draft a polite
         reply saying I'm interested but want to know more about the role."

AGENT   → search_emails { from: "sarah", hasWords: "TechCorp" }
        ← UID 4523, subject "Exciting opportunity at TechCorp"

        → get_email { uid: 4523 }
        ← full email with messageId, subject, body, from

        [composes reply in chat]
        "Here's a draft reply to Sarah's email:

         Hi Sarah, ...

         Want me to send this, save it as a draft, or tweak it?"

USER    "Save as draft, I want to add a few things."

AGENT   → send_email {
           to: ["grace@example.com"],
           text: "Hi Sarah, ...",
           replyToUid: 4523,
           saveToDrafts: true
         }

MCP     1. Fetch UID 4523 → extract Message-ID + References
        2. Build RFC 822 with In-Reply-To, References, "Re: ..." subject
        3. IMAP APPEND to Drafts with [\Draft, \Seen]
        4. → { status: "draft", uid: 8901, folder: "Drafts" }

AGENT   "Saved as a draft. You'll find it in your Drafts folder, threaded
         under Sarah's email. Edit it in any email client and tell me when
         you want me to send it."
```

#### 1C: User Says Send the Draft

```
USER    "Okay I edited that draft to Sarah, go ahead and send it."

AGENT   → send_draft { uid: 8901 }

MCP     1. Fetch raw source of UID 8901 from Drafts
        2. Parse To/Cc/Bcc for SMTP envelope
        3. SMTP send
        4. IMAP APPEND to Sent with [\Seen]
        5. Delete UID 8901 from Drafts (STORE \Deleted + EXPUNGE)
        6. → { status: "sent", messageId: "<def@...>" }

AGENT   "Sent! It'll show up threaded in your conversation with Sarah."
```

### Use Case 2: Collaborative Draft (Human-Led)

The "we're working on this together" flow. The user starts or has a draft, brings the assistant in to review or revise, and they iterate. The Drafts folder is the shared workspace.

#### 2A: User Starts Draft in Email Client, Brings Agent In

```
USER    "I started drafting a reply to the investor update thread from Mark.
         It's in my Drafts. Can you take a look and tighten up the language?"

AGENT   → search_emails { folder: "Drafts", from: "me", hasWords: "investor update Mark" }
        ← UID 9010 in Drafts

        → get_email { uid: 9010, folder: "Drafts" }
        ← full draft body, threading headers, etc.

        [reads draft, presents feedback in chat]
        "Here's your draft. A few suggestions:
         - Paragraph 2 is a bit long, I'd tighten it to...
         - The closing could be stronger, maybe...

         Want me to apply these changes to the draft?"

USER    "Yeah, apply those. Also make the tone a bit warmer."

AGENT   [rewrites the full email body in chat]
        "Here's the updated version: ..."
        "Should I update the draft?"

USER    "Yes."

AGENT   → delete_email { uids: [9010], folder: "Drafts" }
        → send_email {
           to: ["frank@example.com"],
           text: "[revised body]",
           replyToUid: [original thread UID from draft's In-Reply-To],
           saveToDrafts: true
         }

MCP     1. Delete old draft UID 9010
        2. Fetch original for threading context
        3. Build new RFC 822 with updated body + threading headers
        4. IMAP APPEND to Drafts with [\Draft, \Seen]
        5. → { status: "draft", uid: 9015, folder: "Drafts" }

AGENT   "Updated draft saved. You can review it in your email client —
         it's still threaded under Mark's message."
```

#### 2B: Another Round — User Edits in Client, Agent Reviews Again

```
USER    [edits draft in Apple Mail, comes back]
        "Okay I made a few more tweaks to the Mark draft.
         Can you read it one more time?"

AGENT   → search_emails { folder: "Drafts", hasWords: "investor update" }
        ← UID 9015

        → get_email { uid: 9015, folder: "Drafts" }
        ← the version with user's manual edits from Apple Mail

        "Looks good. The tone is right. One small thing — you wrote
         'their' when you meant 'there' in paragraph 3.
         Want me to fix that and send, or just flag it for you?"

USER    "Fix it and send."

AGENT   → delete_email { uids: [9015], folder: "Drafts" }
        → send_email {
           to: ["frank@example.com"],
           text: "[body with typo fixed]",
           replyToUid: [original thread UID],
           saveToDrafts: false
         }

MCP     1. Delete old draft
        2. Build final message with threading
        3. SMTP send
        4. IMAP APPEND to Sent with [\Seen]
        5. → { status: "sent", messageId: "<ghi@...>" }

AGENT   "Sent! Typo fixed, threaded in the investor update conversation."
```

---

## Key Difference Between Use Cases

In **Use Case 1**, the assistant drives — it composes in chat, the MCP is the execution layer. The draft checkpoint is optional and exists for "trust but verify."

In **Use Case 2**, the draft is the shared workspace. The human edits in their email client, the assistant reads and edits via the MCP, and they ping-pong. The Drafts folder is the handoff surface between human and agent. This is where correct threading on every draft save earns its keep — each version must appear properly threaded so the human sees full conversation context in their email client.

Both flows use the same three tool changes. The difference is the sequence and who initiates each step.

---

## Deferred: `get_thread` Tool

### Why Not Now

With this spec, `get_email` will return `messageId`, `inReplyTo`, and `references` — the exact fields needed to reconstruct a conversation thread. The data model prerequisite is landing here. However, a `get_thread` tool has its own design surface that deserves focused treatment rather than being bolted on:

- **IMAP has no native thread concept.** Unlike Gmail's `threadId`, IMAP requires either RFC 5256 THREAD extension (Mailbox.org's Dovecot likely supports it, but imapflow doesn't expose it directly) or manual reconstruction by searching for emails whose `References` or `In-Reply-To` match Message-IDs in the chain.
- **Cross-folder search.** A thread spans INBOX, Sent, Drafts, and Archive. Reconstructing it means multiple IMAP SEARCH calls across folders, which gets expensive.
- **Token budget.** `get_email`'s markdown format was specifically optimized for single-email token efficiency. Returning a 15-message thread blows up response size by 15x. A thread tool needs its own truncation/summary strategy — maybe return full body for the most recent N messages and summaries for the rest, or let the agent specify a token budget.
- **Partial threads.** Some messages may have been deleted, moved, or may predate the user's mailbox. The tool needs to handle gaps gracefully.

### What It Would Look Like

```json
{
  "name": "get_thread",
  "description": "Retrieve a full email conversation thread. Given a single email UID, follows the References/In-Reply-To chain to find all related messages across folders (INBOX, Sent, Drafts, Archive). Returns messages in chronological order.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "uid": {
        "type": "number",
        "description": "UID of any email in the thread. The tool traces the full conversation from this starting point."
      },
      "folder": {
        "type": "string",
        "description": "IMAP folder containing the starting email. Defaults to INBOX."
      },
      "format": {
        "type": "string",
        "enum": ["markdown", "text"],
        "description": "Body format for each message. Defaults to markdown."
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of messages to return. Most recent messages are prioritized. Defaults to 10."
      }
    },
    "required": ["uid"]
  }
}
```

### Possible Internal Approach

```
1. Fetch the starting email to get its Message-ID and References chain
2. Collect all Message-IDs in the chain (References + the starting email's Message-ID)
3. For each folder in [INBOX, Sent, Drafts, Archive]:
   a. IMAP SEARCH for messages where Message-ID, In-Reply-To, or References
      match any ID in the collected set
   b. Collect any new Message-IDs found → repeat until no new IDs discovered
4. Fetch full emails (respecting limit), sort chronologically
5. Return as array with folder provenance on each message
```

### Prerequisite

The threading headers added to `get_email` in this spec. Without `messageId`, `inReplyTo`, and `references` in the response, there's no chain to follow.

### Timeline

Separate spec, next phase after this change ships and is validated against Mailbox.org.

---

## Implementation Notes

### Service Layer Changes

**ImapService — new methods:**

- `appendMessage(folder: string, rawSource: Buffer, flags: string[]): Promise<{ uid: number }>` — IMAP APPEND with flags, returns UID of the new message via APPENDUID response.
- `getSpecialUseFolder(flag: string): Promise<string>` — Discover folder path by RFC 6154 special-use flag with fallbacks.
- `fetchRawSource(folder: string, uid: number): Promise<Buffer>` — Fetch raw RFC 822 source for a UID (for `send_draft`).

**SmtpService — new methods:**

- `composeRawMessage(options: ComposeOptions): Promise<Buffer>` — Build RFC 822 source via nodemailer MailComposer without sending.
- `sendRawMessage(rawSource: Buffer, envelope: { from: string; to: string[] }): Promise<SendResult>` — Send pre-composed raw message via SMTP (for `send_draft`).

### `required` Field Note

The `send_email` tool's `required` is `["to"]` only. Subject is conditionally required:
- **No `replyToUid`**: subject must be provided or the tool returns `VALIDATION_FAILED`
- **With `replyToUid`**: subject is optional — auto-derived as `Re: <original subject>` when omitted
- **Explicit subject always wins**: if the agent passes `subject`, it's used as-is regardless of `replyToUid`

This keeps the agent interface minimal for replies (just pass `replyToUid` and body) while still allowing subject overrides when needed.

### Partial Failure: SMTP Succeeds, Sent Copy Fails

If the SMTP send succeeds but the IMAP APPEND to Sent fails (connection dropped, quota exceeded, etc.), the email is delivered but not in the Sent folder. In this case, log a warning and still return `{ status: "sent" }` with the messageId. The email was delivered — that is the primary success condition. The Sent copy failure should not mask it or cause a retry of the SMTP send.

### Mailbox.org Behavior

Mailbox.org uses Dovecot as its IMAP server. Dovecot does not auto-copy to Sent on SMTP send. The `SMTP_AUTO_SENT` config defaults to `false`, meaning the IMAP APPEND to Sent is always performed. This is the correct default for Mailbox.org and most non-Gmail providers.

### Dependencies

No new dependencies. All required functionality is available through existing packages:

- `nodemailer` — MailComposer for RFC 822 message building, SMTP transport for sending
- `imapflow` — `append()` method for IMAP APPEND, `list()` for folder discovery
- `mailparser` — Already used in `fetchEmail`, provides `inReplyTo` and `references` fields
