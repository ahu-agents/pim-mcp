# Changelog

## v0.1.0 - 2026-05-14

First AHU-maintained PIM MCP foundation release.

### Added
- Unified `pim-mcp` package and `pim-mcp` binary combining mail, calendar, and CalDAV VTODO task tools in one MCP server.
- CalDAV VTODO reminders/tasks server (`@miguelarios/tasks-mcp` 0.1.0).
- `SMTP_ALLOWED_FROM` support for allowed visible `From:` addresses while keeping the SMTP envelope sender on the configured SMTP account.
- `fromName` support for sent mail display names.
- CalDAV `move_event` support for moving events between calendars.

### Deployment
- Primary OpenClaw `claw` deploy path: `/opt/pim-mcp/current`.
- Canonical OpenClaw MCP server name: `pim`.
- Compatibility MCP entries `email`, `calendar`, and `reminders` remain available during migration.

### Validation
- Core, email, calendar, tasks, and unified PIM builds passed.
- Unified `pim-mcp` stdio smoke returned `pim-mcp 0.1.0` and 31 tools.
- Live read-only OpenClaw smokes passed for task lists, calendars, and INBOX status.
