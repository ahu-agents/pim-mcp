# Email-MCP Timezone Conversion — Design Spec

**Date:** 2026-04-02
**Status:** Implemented (email-mcp@0.8.0)
**Scope:** Read-path only — convert UTC email dates to user's local timezone

## Problem

Email-mcp returns all dates in UTC (`2026-03-14T15:00:00.000Z`). Agents presenting these to users force mental timezone math. Cal-mcp already solves this with pim-core's timezone utilities; email-mcp should follow the same pattern.

## Design

### Approach

Convert dates in `ImapService` at the point of construction (Approach A). This matches the cal-mcp pattern in `CalDavService`.

### Changes to ImapService.ts

1. Import `getTimezone` and `formatInTimezone` from `@miguelarios/pim-core`
2. Add a `timezone` property resolved once via `getTimezone()` (constructor or class field)
3. Replace the two date formatting sites:
   - Line ~179 (envelope path): `date: envelope.date ? formatInTimezone(envelope.date.toISOString(), this.timezone) : ""`
   - Line ~222 (parsed path): `date: parsed.date ? formatInTimezone(parsed.date.toISOString(), this.timezone) : ""`

### Output Format

| Before | After |
|--------|-------|
| `2026-03-14T15:00:00.000Z` | `2026-03-14T10:00:00-05:00` |

Milliseconds are stripped (consistent with cal-mcp). Offset reflects the user's timezone at that moment, including DST.

### Timezone Resolution

Uses existing pim-core `getTimezone()`:
1. `PIM_TIMEZONE` env var (if set) — IANA identifier (e.g., `America/Chicago`)
2. Falls back to `Intl.DateTimeFormat().resolvedOptions().timeZone` (OS timezone)

### Testing

- Set `PIM_TIMEZONE` in test setup to control timezone deterministically
- Verify returned dates include offset instead of `Z` suffix
- Verify milliseconds are not present
- Follow cal-mcp test patterns

### Out of Scope

- Write-path timezone conversion (search filter `since`/`before` params)
- New tools or interfaces
- Any changes to EmailSummary/EmailFull type definitions (the `date` field remains `string`)
