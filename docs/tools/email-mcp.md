# Email MCP Tools

`@miguelarios/email-mcp` — IMAP/SMTP email server with 12 tools.

## search_emails

Search and list emails in a folder. Returns email summaries with configurable sorting (default: date descending). All filters combine with AND logic.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder path. Defaults to "INBOX". |
| `subject` | string | | Search subject line. Multiple words are ANDed. Use `-term` to exclude. Use quotes for exact phrase. |
| `from` | string | | Match sender name or email address (substring match). |
| `to` | string | | Match recipient name or email address (substring match). |
| `cc` | string | | Match CC recipient (substring match). |
| `bcc` | string | | Match BCC recipient (substring match). |
| `body` | string | | Search body text. Multiple words are ANDed. Use `-term` to exclude. Use quotes for exact phrase. |
| `hasWords` | string | | Search all message content (headers + body, IMAP TEXT). Multiple words are ANDed. Use quotes for exact phrase. Use `-term` for exclusion. |
| `since` | string | | Emails on or after this date (YYYY-MM-DD). |
| `before` | string | | Emails before this date (YYYY-MM-DD). |
| `unread` | boolean | | Filter by unread status. |
| `flagged` | boolean | | Filter by flagged/starred status. |
| `hasAttachment` | boolean | | Filter for emails with attachments. |
| `tags` | string[] | | Filter by IMAP keyword flags. |
| `limit` | number | | Max results to return. Defaults to 50. |
| `offset` | number | | Number of results to skip for pagination. Defaults to 0. |
| `sortBy` | `"date"` \| `"from"` \| `"subject"` | | Sort field. Defaults to `date`. |
| `sortOrder` | `"asc"` \| `"desc"` | | Sort direction. Defaults to `desc` (newest first for date). |

## get_email

Fetch a full email by UID including headers, body, and attachment metadata. Returns body as markdown by default for token efficiency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder containing the email. Defaults to INBOX. |
| `uid` | number | yes | The UID of the email to fetch. |
| `format` | `"markdown"` \| `"html"` \| `"text"` | | Body format to return. `markdown` (default) converts HTML to clean markdown. `html` returns raw HTML. `text` returns plain text only. |

## send_email

Compose and send an email, or save it as a draft. Supports replies with automatic threading — when `replyToUid` is provided, the tool fetches the original email and sets correct In-Reply-To/References headers and Re: subject prefix automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string[] | yes | Recipient email addresses. |
| `cc` | string[] | | CC email addresses. |
| `bcc` | string[] | | BCC email addresses. |
| `subject` | string | | Email subject line. Required for new emails. When `replyToUid` is set and subject is omitted, automatically uses "Re: \<original subject\>". |
| `text` | string | | Plain text body. |
| `html` | string | | HTML body. |
| `attachments` | object[] | | File attachments. Each object: `filename` (required), `path`, `content`. |
| `replyToUid` | number | | UID of the email to reply to. Sets In-Reply-To and References headers automatically. |
| `replyToFolder` | string | | IMAP folder containing the email referenced by `replyToUid`. Defaults to INBOX. |
| `saveToDrafts` | boolean | | When true, saves to Drafts folder instead of sending. Defaults to false. |

## send_draft

Send an existing email draft from the Drafts folder. Fetches the draft's raw RFC 822 source, sends it via SMTP, copies it to the Sent folder, and removes it from Drafts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | number | yes | UID of the draft email in the Drafts folder. |
| `folder` | string | | IMAP folder containing the draft. Defaults to the server's Drafts folder. |

## move_email

Move one or more emails to a different IMAP folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | Source IMAP folder. Defaults to INBOX. |
| `uids` | number[] | yes | UIDs of emails to move. |
| `destination` | string | yes | Destination folder path. |

## mark_email

Set or unset flags on one or more emails. Common flags: `\Seen` (read), `\Flagged` (starred).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder. Defaults to INBOX. |
| `uids` | number[] | yes | UIDs of emails to modify. |
| `flags` | string[] | yes | Flags to set/unset (e.g., `\Seen`, `\Flagged`). |
| `action` | `"add"` \| `"remove"` | | Whether to add or remove the flags. Defaults to `add`. |

## delete_email

Delete one or more emails. Moves to Trash by default, or permanently deletes if specified.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder. Defaults to INBOX. |
| `uids` | number[] | yes | UIDs of emails to delete. |
| `permanent` | boolean | | If true, permanently delete instead of moving to Trash. Defaults to false. |

## list_folders

List all IMAP folders with their paths and special-use flags (Inbox, Sent, Trash, etc.).

*No parameters.*

## create_folder

Create a new IMAP folder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Folder path to create (e.g., "Projects/Work"). |

## download_attachment

Download a specific attachment from an email. Returns the attachment content as base64.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder. Defaults to INBOX. |
| `uid` | number | yes | UID of the email containing the attachment. |
| `partId` | string | yes | MIME part ID of the attachment (from `get_email` attachment metadata). |

## get_email_raw

Export an email as raw .eml (RFC 822 source). Useful for archival or forwarding.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder. Defaults to INBOX. |
| `uid` | number | yes | UID of the email to export. |

## get_folder_status

Get total and unread message counts for a folder via IMAP STATUS (single round-trip, no payload).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | | IMAP folder path. Defaults to INBOX. |
