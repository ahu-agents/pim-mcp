import { toPimError } from "@miguelarios/pim-core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { htmlToMarkdown } from "../htmlToMarkdown.js";
import type { SearchParams } from "../search.js";
import type { ImapService } from "../services/ImapService.js";
import type { SmtpService } from "../services/SmtpService.js";

export const EMAIL_TOOLS: Tool[] = [
  {
    name: "search_emails",
    description:
      "Search and list emails in a folder. Returns email summaries with configurable sorting (default: date descending). All filters combine with AND logic. Use the dedicated fields (subject, from, to, etc.) for most searches. Note: for result sets >1000, non-date sort fields are approximate (sorted within page only).",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: 'IMAP folder path. Defaults to "INBOX".',
        },
        subject: {
          type: "string",
          description:
            "Search subject line. Multiple words are ANDed. Use -term to exclude. Use quotes for exact phrase: '\"weekly report\"'.",
        },
        from: {
          type: "string",
          description: "Match sender name or email address (substring match).",
        },
        to: {
          type: "string",
          description: "Match recipient name or email address (substring match).",
        },
        cc: {
          type: "string",
          description: "Match CC recipient (substring match).",
        },
        bcc: {
          type: "string",
          description: "Match BCC recipient (substring match).",
        },
        body: {
          type: "string",
          description:
            "Search body text. Multiple words are ANDed. Use -term to exclude. Use quotes for exact phrase: '\"project update\"'.",
        },
        hasWords: {
          type: "string",
          description:
            'Search all message content (headers + body, IMAP TEXT). Multiple words are ANDed. Use quotes for exact phrase. Use -term for exclusion. Examples: "budget", "report -draft", \'"quarterly report"\'.',
        },
        since: {
          type: "string",
          description: "Emails on or after this date (YYYY-MM-DD).",
        },
        before: {
          type: "string",
          description: "Emails before this date (YYYY-MM-DD).",
        },
        unread: {
          type: "boolean",
          description: "Filter by unread status.",
        },
        flagged: {
          type: "boolean",
          description: "Filter by flagged/starred status.",
        },
        hasAttachment: {
          type: "boolean",
          description: "Filter for emails with attachments.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by IMAP keyword flags.",
        },
        limit: {
          type: "number",
          description: "Max results to return. Defaults to 50.",
        },
        offset: {
          type: "number",
          description: "Number of results to skip for pagination. Defaults to 0.",
        },
        sortBy: {
          type: "string",
          enum: ["date", "from", "subject"],
          description: "Sort field. Defaults to date.",
        },
        sortOrder: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction. Defaults to desc (newest first for date).",
        },
      },
    },
  },
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
  {
    name: "send_email",
    description:
      "Compose and send an email via SMTP. Supports to/cc/bcc, text and HTML body, and file attachments.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses.",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "BCC email addresses.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        text: {
          type: "string",
          description: "Plain text body.",
        },
        html: {
          type: "string",
          description: "HTML body.",
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string" },
              path: {
                type: "string",
                description: "File path to attach.",
              },
              content: {
                type: "string",
                description: "String content to attach.",
              },
            },
            required: ["filename"],
          },
          description: "File attachments.",
        },
      },
      required: ["to", "subject"],
    },
  },
  {
    name: "move_email",
    description: "Move one or more emails to a different IMAP folder.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Source IMAP folder. Defaults to INBOX.",
        },
        uids: {
          type: "array",
          items: { type: "number" },
          description: "UIDs of emails to move.",
        },
        destination: {
          type: "string",
          description: "Destination folder path.",
        },
      },
      required: ["uids", "destination"],
    },
  },
  {
    name: "mark_email",
    description:
      'Set or unset flags on one or more emails. Common flags: "\\Seen" (read), "\\Flagged" (starred).',
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder. Defaults to INBOX.",
        },
        uids: {
          type: "array",
          items: { type: "number" },
          description: "UIDs of emails to modify.",
        },
        flags: {
          type: "array",
          items: { type: "string" },
          description: 'Flags to set/unset (e.g., "\\Seen", "\\Flagged").',
        },
        action: {
          type: "string",
          enum: ["add", "remove"],
          description: 'Whether to add or remove the flags. Defaults to "add".',
        },
      },
      required: ["uids", "flags"],
    },
  },
  {
    name: "delete_email",
    description:
      "Delete one or more emails. Moves to Trash by default, or permanently deletes if specified.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder. Defaults to INBOX.",
        },
        uids: {
          type: "array",
          items: { type: "number" },
          description: "UIDs of emails to delete.",
        },
        permanent: {
          type: "boolean",
          description: "If true, permanently delete instead of moving to Trash. Defaults to false.",
        },
      },
      required: ["uids"],
    },
  },
  {
    name: "list_folders",
    description:
      "List all IMAP folders with their paths and special-use flags (Inbox, Sent, Trash, etc.).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_folder",
    description: "Create a new IMAP folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Folder path to create (e.g., 'Projects/Work').",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "download_attachment",
    description:
      "Download a specific attachment from an email. Returns the attachment content as base64.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder. Defaults to INBOX.",
        },
        uid: {
          type: "number",
          description: "UID of the email containing the attachment.",
        },
        partId: {
          type: "string",
          description: "MIME part ID of the attachment (from get_email attachment metadata).",
        },
      },
      required: ["uid", "partId"],
    },
  },
  {
    name: "get_email_raw",
    description: "Export an email as raw .eml (RFC 822 source). Useful for archival or forwarding.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder. Defaults to INBOX.",
        },
        uid: {
          type: "number",
          description: "UID of the email to export.",
        },
      },
      required: ["uid"],
    },
  },
  {
    name: "get_folder_status",
    description:
      "Get total and unread message counts for a folder via IMAP STATUS (single round-trip, no payload).",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "IMAP folder path. Defaults to INBOX.",
        },
      },
    },
  },
];

export async function handleEmailTool(
  name: string,
  args: Record<string, unknown>,
  imapService: ImapService,
  smtpService: SmtpService,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const folder = (args.folder as string) || "INBOX";

    switch (name) {
      case "search_emails": {
        const searchParams: SearchParams = {
          hasWords: args.hasWords as string | undefined,
          body: args.body as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          cc: args.cc as string | undefined,
          bcc: args.bcc as string | undefined,
          subject: args.subject as string | undefined,
          since: args.since as string | undefined,
          before: args.before as string | undefined,
          unread: args.unread as boolean | undefined,
          flagged: args.flagged as boolean | undefined,
          hasAttachment: args.hasAttachment as boolean | undefined,
          tags: args.tags as string[] | undefined,
        };
        const limit = (args.limit as number) || 50;
        const offset = (args.offset as number) || 0;
        const sortBy = (args.sortBy as string | undefined) ?? "date";
        const sortOrder = (args.sortOrder as string | undefined) ?? "desc";
        const emails = await imapService.searchEmails(folder, searchParams, {
          limit,
          offset,
          sortBy: sortBy as "date" | "from" | "subject",
          sortOrder: sortOrder as "asc" | "desc",
        });
        return ok(JSON.stringify(emails, null, 2));
      }

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

      case "send_email": {
        const result = await smtpService.sendEmail({
          to: args.to as string[],
          cc: args.cc as string[] | undefined,
          bcc: args.bcc as string[] | undefined,
          subject: args.subject as string,
          text: args.text as string | undefined,
          html: args.html as string | undefined,
          attachments: args.attachments as any[] | undefined,
        });
        return ok(JSON.stringify({ status: "sent", ...result }));
      }

      case "move_email": {
        const uids = args.uids as number[];
        const destination = args.destination as string;
        await imapService.moveEmails(folder, uids, destination);
        return ok(JSON.stringify({ status: "moved", uids, destination }));
      }

      case "mark_email": {
        const uids = args.uids as number[];
        const flags = args.flags as string[];
        const action = (args.action as "add" | "remove") || "add";
        await imapService.markEmails(folder, uids, flags, action);
        return ok(JSON.stringify({ status: "updated", uids, flags, action }));
      }

      case "delete_email": {
        const uids = args.uids as number[];
        const permanent = (args.permanent as boolean) || false;
        await imapService.deleteEmails(folder, uids, permanent);
        return ok(
          JSON.stringify({
            status: permanent ? "permanently_deleted" : "moved_to_trash",
            uids,
          }),
        );
      }

      case "list_folders": {
        const folders = await imapService.listFolders();
        return ok(JSON.stringify(folders, null, 2));
      }

      case "create_folder": {
        const path = args.path as string;
        await imapService.createFolder(path);
        return ok(JSON.stringify({ status: "created", path }));
      }

      case "download_attachment": {
        const uid = args.uid as number;
        const partId = args.partId as string;
        const attachment = await imapService.downloadAttachment(folder, uid, partId);
        return ok(
          JSON.stringify({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            content: attachment.content.toString("base64"),
          }),
        );
      }

      case "get_email_raw": {
        const uid = args.uid as number;
        const raw = await imapService.fetchRawEmail(folder, uid);
        return ok(raw);
      }

      case "get_folder_status": {
        const status = await imapService.getFolderStatus(folder);
        return ok(JSON.stringify(status));
      }

      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const pimError = toPimError(err instanceof Error ? err : new Error(String(err)));
    return error(`${pimError.message}${pimError.isRetryable ? " (retryable)" : ""}`);
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function error(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
