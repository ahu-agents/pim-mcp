# PIM Agents

AI agent tooling for email (IMAP/SMTP), calendar (CalDAV), and contacts (CardDAV). Three independent MCP servers built on open protocols.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [@miguelarios/email-mcp](packages/email-mcp) | Email via IMAP/SMTP | `npx @miguelarios/email-mcp` |
| [@miguelarios/cal-mcp](packages/cal-mcp) | Calendars via CalDAV | `npx @miguelarios/cal-mcp` |
| [@miguelarios/card-mcp](packages/card-mcp) | Contacts via CardDAV | `npx @miguelarios/card-mcp` |

## Tools

### Email (10 tools)

| Tool | Description |
|------|-------------|
| `list_emails` | Search and filter emails by folder, sender, subject, date, flags |
| `get_email` | Fetch full email by UID — headers, body, attachment metadata |
| `send_email` | Compose and send via SMTP with attachment support |
| `move_email` | Move email between folders |
| `mark_email` | Set/unset flags (read, unread, flagged) |
| `delete_email` | Move to trash or permanently delete |
| `list_folders` | List all IMAP folders |
| `create_folder` | Create an IMAP folder |
| `download_attachment` | Download attachment by email UID and filename |
| `get_email_raw` | Export email as .eml |

### Calendar (9 tools)

| Tool | Description |
|------|-------------|
| `list_calendars` | Discover calendars across all configured providers |
| `list_events` | Query events by date range and calendar |
| `get_event` | Get event details by UID |
| `create_event` | Create event with title, start/end, location, attendees |
| `update_event` | Update existing event by UID |
| `delete_event` | Delete event by UID |
| `create_events_batch` | Create multiple events at once |
| `import_ics` | Parse .ics content and create events |
| `find_free_slots` | Find available time slots across calendars |

### Contacts (6 tools)

| Tool | Description |
|------|-------------|
| `list_contacts` | List and search contacts by name, email, phone, org |
| `get_contact` | Get full contact details by UID |
| `create_contact` | Create a new contact |
| `update_contact` | Update an existing contact (merge-based) |
| `delete_contact` | Delete a contact by UID |
| `resolve_contact` | Given a name, return email address |

## Configuration

Add the servers to your MCP client config (Claude Desktop, Claude Code, etc.). Credentials are passed via environment variables.

### Email

```json
{
  "mcpServers": {
    "email": {
      "command": "npx",
      "args": ["-y", "@miguelarios/email-mcp"],
      "env": {
        "IMAP_HOST": "imap.example.com",
        "IMAP_USER": "user@example.com",
        "IMAP_PASS": "your-app-password",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_USER": "user@example.com",
        "SMTP_PASS": "your-app-password"
      }
    }
  }
}
```

Optional email env vars: `IMAP_PORT` (default 993), `IMAP_SECURE` (default true), `SMTP_PORT` (default 465), `SMTP_SECURE` (default true), `SMTP_FROM_NAME`.

### Calendar

```json
{
  "mcpServers": {
    "calendar": {
      "command": "npx",
      "args": ["-y", "@miguelarios/cal-mcp"],
      "env": {
        "CALDAV_ACCOUNTS": "[{\"id\":\"mailbox\",\"url\":\"https://dav.mailbox.org/caldav/\",\"username\":\"user@mailbox.org\",\"password\":\"app-password\"}]"
      }
    }
  }
}
```

`CALDAV_ACCOUNTS` is a JSON array — each entry needs `id`, `url`, `username`, and `password`. You can configure multiple providers.

### Contacts

```json
{
  "mcpServers": {
    "contacts": {
      "command": "npx",
      "args": ["-y", "@miguelarios/card-mcp"],
      "env": {
        "CARDDAV_URL": "https://dav.example.com/carddav/",
        "CARDDAV_USER": "user@example.com",
        "CARDDAV_PASS": "your-app-password"
      }
    }
  }
}
```

### All three together

```json
{
  "mcpServers": {
    "email": {
      "command": "npx",
      "args": ["-y", "@miguelarios/email-mcp"],
      "env": {
        "IMAP_HOST": "imap.example.com",
        "IMAP_USER": "user@example.com",
        "IMAP_PASS": "your-app-password",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_USER": "user@example.com",
        "SMTP_PASS": "your-app-password"
      }
    },
    "calendar": {
      "command": "npx",
      "args": ["-y", "@miguelarios/cal-mcp"],
      "env": {
        "CALDAV_ACCOUNTS": "[{\"id\":\"provider\",\"url\":\"https://dav.example.com/caldav/\",\"username\":\"user\",\"password\":\"app-password\"}]"
      }
    },
    "contacts": {
      "command": "npx",
      "args": ["-y", "@miguelarios/card-mcp"],
      "env": {
        "CARDDAV_URL": "https://dav.example.com/carddav/",
        "CARDDAV_USER": "user@example.com",
        "CARDDAV_PASS": "your-app-password"
      }
    }
  }
}
```

## License

MIT
