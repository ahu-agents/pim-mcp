# pim-mcp

Unified MCP server for personal information management tools:

- email via IMAP/SMTP
- calendar events via CalDAV
- reminders/tasks via CalDAV VTODO

The tool names intentionally stay explicit (`search_emails`, `list_events`, `create_task`, etc.) so agents can see the capability boundary without guessing.

## Why this package exists

Running one PIM server keeps shared config, health, versioning, deployment, and rollback simpler than managing separate mail/calendar/tasks MCP processes.

## Configuration

`pim-mcp` reuses the existing environment variables from the component servers:

- IMAP/SMTP: `IMAP_*`, `SMTP_*`, `SMTP_ALLOWED_FROM`, `SMTP_FROM_NAME`, `SMTP_AUTO_SENT`
- CalDAV: `CALDAV_<PROVIDER>_URL`, `CALDAV_<PROVIDER>_USER`, `CALDAV_<PROVIDER>_PASS`
- Optional: `TZ`

`SMTP_ALLOWED_FROM` is enforced for the visible `From:` header. The SMTP envelope sender remains the configured SMTP account.

## Run

```sh
pim-mcp
```

## Build/test

```sh
npm --workspace packages/core run build
npm --workspace packages/email-mcp run build
npm --workspace packages/cal-mcp run build
npm --workspace packages/tasks-mcp run build
npm --workspace packages/pim-mcp test
npm --workspace packages/pim-mcp run build
```
