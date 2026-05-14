# @miguelarios/tasks-mcp

MCP server for CalDAV VTODO task lists and reminders.

## Usage

```bash
npx @miguelarios/tasks-mcp
```

## Environment Variables

Uses the same multi-account CalDAV env pattern as `cal-mcp`:

- `CALDAV_<ID>_URL`
- `CALDAV_<ID>_USER`
- `CALDAV_<ID>_PASS`

Example:

```bash
CALDAV_ICLOUD_URL=https://caldav.icloud.com/
CALDAV_ICLOUD_USER=you@example.com
CALDAV_ICLOUD_PASS=app-password
```

## Tools

- `list_task_lists`
- `list_tasks`
- `get_task`
- `create_task`
- `update_task`
- `complete_task`
- `delete_task`

## Notes

- This package is VTODO-only.
- It does not enable contacts/CardDAV.
- Current task support is due-date centric; VTODO `DTSTART` is not exposed yet.
