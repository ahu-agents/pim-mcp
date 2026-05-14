# @miguelarios/email-mcp

MCP server for email via IMAP/SMTP — read, search, send, and manage emails.

## Usage

```bash
npx @miguelarios/email-mcp
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAP_HOST` | Yes | — | IMAP server hostname |
| `IMAP_USER` | Yes | — | IMAP username |
| `IMAP_PASS` | Yes | — | IMAP password |
| `IMAP_PORT` | No | `993` | IMAP port |
| `IMAP_SECURE` | No | `true` | Use TLS |
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_USER` | Yes | — | SMTP username |
| `SMTP_PASS` | Yes | — | SMTP password |
| `SMTP_PORT` | No | `465` | SMTP port |
| `SMTP_SECURE` | No | `true` | Use TLS |
| `SMTP_FROM_NAME` | No | — | Default display name for outgoing emails |
| `SMTP_ALLOWED_FROM` | No | — | Comma-separated allowlist of additional visible `From` addresses |

## Tools

| Tool | Description |
|------|-------------|
| `list_emails` | Search and filter emails by folder, sender, subject, date, flags |
| `get_email` | Fetch full email by UID — headers, body, attachment metadata |
| `send_email` | Compose/send via SMTP, save drafts, reply with threading, and optionally use an allowed visible From address |
| `move_email` | Move email between folders |
| `mark_email` | Set/unset flags (read, unread, flagged) |
| `delete_email` | Move to trash or permanently delete |
| `list_folders` | List all IMAP folders |
| `create_folder` | Create an IMAP folder |
| `download_attachment` | Download attachment by email UID and filename |
| `get_email_raw` | Export email as .eml |

## License

MIT
