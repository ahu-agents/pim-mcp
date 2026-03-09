# @miguelarios/cal-mcp

MCP server for calendars via CalDAV — CRUD events, free/busy, multi-provider.

## Usage

```bash
npx @miguelarios/cal-mcp
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CALDAV_ACCOUNTS` | Yes | JSON array of CalDAV accounts |

### CALDAV_ACCOUNTS format

```json
[
  {
    "id": "mailbox",
    "url": "https://dav.mailbox.org/caldav/",
    "username": "user@mailbox.org",
    "password": "app-password"
  },
  {
    "id": "nextcloud",
    "url": "https://cloud.example.com/remote.php/dav/calendars/user/",
    "username": "user",
    "password": "app-password"
  }
]
```

## Tools

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

## License

MIT
