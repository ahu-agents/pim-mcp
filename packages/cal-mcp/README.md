# @miguelarios/cal-mcp

MCP server for calendars via CalDAV — CRUD events, free/busy, multi-provider.

## Usage

```bash
npx @miguelarios/cal-mcp
```

## Environment Variables

Configure one or more CalDAV accounts using prefixed env vars. The `<ID>` becomes the provider identifier.

| Variable | Required | Description |
|----------|----------|-------------|
| `CALDAV_<ID>_URL` | Yes | CalDAV server URL |
| `CALDAV_<ID>_USER` | Yes | CalDAV username |
| `CALDAV_<ID>_PASS` | Yes | CalDAV password |

### Example: two providers

```bash
CALDAV_MAILBOX_URL=https://dav.mailbox.org/caldav/
CALDAV_MAILBOX_USER=user@mailbox.org
CALDAV_MAILBOX_PASS=app-password

CALDAV_NEXTCLOUD_URL=https://cloud.example.com/remote.php/dav/calendars/user/
CALDAV_NEXTCLOUD_USER=user
CALDAV_NEXTCLOUD_PASS=app-password
```

## Tools

| Tool | Description |
|------|-------------|
| `list_calendars` | Discover calendars across all configured providers |
| `list_events` | Query events by date range and calendar |
| `get_event` | Get event details by UID |
| `create_event` | Create event with title, start/end, location, attendees |
| `update_event` | Update existing event by UID |
| `move_event` | Move an event to another calendar, equivalent to changing its calendar in iCal |
| `delete_event` | Delete event by UID |
| `create_events_batch` | Create multiple events at once |
| `import_ics` | Parse .ics content and create events |
| `find_free_slots` | Find available time slots across calendars |

## License

MIT
