# cal-mcp Unified Schema Migration Design

**Date:** 2026-03-11
**Spec:** `docs/specs/unified-calendar-mcp-spec-v1.md` (v1.1, LOCKED)
**Release:** 0.3.0 (breaking, clean break)
**Approach:** File-by-file with TDD, dependency order

---

## Overview

Migrate cal-mcp from its current tool schema to the unified calendar MCP spec agreed with macos-calendar-mcp. This is a breaking change release (0.3.0). All renames, new fields, new tools, and response format changes are applied at once with no backward compatibility layer.

---

## Layer 1: Types & Parsing (ical.ts)

### Type Renames

All response types move to snake_case keys. Types stay in `CalDavService.ts` (no file extraction needed).

**CalendarInfo:**
```typescript
interface CalendarInfo {
  calendar_id: string;       // was calendarId
  display_name: string;      // was displayName
  color: string | null;      // NEW
  source: string;            // was providerId
  read_only: boolean;        // NEW
  url: string;               // internal use, kept but not in tool responses
  ctag?: string;             // internal use, kept but not in tool responses
}
```

**EventSummary:**
```typescript
interface EventSummary {
  uid: string;
  calendar_id: string;       // was calendarId
  title: string;             // was summary
  start: string;
  end: string;
  all_day: boolean;          // NEW
  location?: string;
  status?: string;           // lowercase values
  is_recurring: boolean;     // was isRecurring
}
```

**EventFull (extends EventSummary):**
```typescript
interface EventFull extends EventSummary {
  description?: string;
  url?: string;              // NEW
  availability?: string;     // was transparency, values: busy/free/tentative/unavailable
  attendees?: Array<{
    name?: string;
    email: string;
    status?: string;         // lowercase
    role?: string;           // NEW (not populated by CalDAV yet, reserved)
  }>;
  organizer?: {
    name?: string;
    email: string;
  };
  recurrence_rule?: string;  // was recurrenceRule
  created?: string;
  last_modified?: string;    // was lastModified
}
```

**ParsedEvent (ical.ts):** Same field names as EventFull (1:1 mapping).

**EventCreateProps (ical.ts):**
```typescript
interface EventCreateProps {
  title: string;             // was summary
  start: string;
  end: string;
  all_day?: boolean;         // NEW
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
}
```

**FindFreeSlotsOptions:**
```typescript
interface FindFreeSlotsOptions {
  ignoreTentative?: boolean;
  preferredStart?: string;
  preferredEnd?: string;
  excludeCalendars?: string[];       // NEW
  includeAllDayAsBusy?: boolean;     // NEW, default false
}
```

**FreeSlot:** No changes (already compliant).

### ical.ts Changes

- `parseIcsEvents()`: Return `ParsedEvent` with new field names. Map `vevent.transparency` OPAQUE→"busy", TRANSPARENT→"free". Lowercase `status` values. Detect `all_day` from `vevent.datetype === "date"`.
- `generateEventIcs()`: Accept `title` (pass as `summary` to ical-generator since ICS format uses SUMMARY). Accept `all_day`.

---

## Layer 2: Service (CalDavService.ts)

### Existing Method Changes

No signature changes. Type renames flow through automatically.

- **`listCalendars()`**: Add `color` (from tsdav `calendarColor` or `null`), `read_only` (default `false`), rename `providerId` → `source` in mapping.

- **`listEvents()`**: Internal `toEventSummary()` mapping uses new field names from ParsedEvent. Adds `all_day`.

- **`getEvent()`**: Internal `toEventFull()` mapping uses new field names.

- **`findFreeSlots()`**: Add `excludeCalendars` filtering (skip events from those calendars). Add `includeAllDayAsBusy` filtering (skip all-day events unless `true`). Transparency→availability rename is cosmetic — filtering logic checks same underlying values.

### No New Service Methods

`get_today_events` and `search_events` tools use existing `listEvents()` — date computation and keyword filtering happen at the tool layer.

---

## Layer 3: Tools (calendarTools.ts)

### Response Format

**Success helper:**
```typescript
function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
```

Each tool wraps its result in the spec envelope:
- `list_calendars` → `ok({ calendars: [...] })`
- `list_events` / `get_today_events` / `search_events` → `ok({ events: [...] })`
- `get_event` / `create_event` / `update_event` → `ok({ event: {...} })`
- `delete_event` → `ok({ deleted: true, uid: "..." })`
- `find_free_slots` → `ok({ slots: [...], count: N })`
- `create_events_batch` → `ok({ created: N, events: [...] })`
- `import_ics` → `ok({ imported: N, events: [...] })`

**Error helper:**
```typescript
function error(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}
```

Error code mapping:
- `CalendarError(CALENDAR_NOT_FOUND)` → `not_found`
- `CalendarError(EVENT_NOT_FOUND)` → `not_found`
- Everything else → `backend_error`

### Tool Schema Changes (Existing)

| Tool | Change |
|------|--------|
| `create_event` | `summary` → `title`, add `all_day` param |
| `update_event` | `summary` → `title`, add `all_day` param, add `span` param |
| `delete_event` | Add `span` param |
| `create_events_batch` | `summary` → `title` in event objects |
| `import_ics` | `icsContent` → `ics_content` |
| `list_events` | Add `detail_level` param, make `calendar` optional |
| `find_free_slots` | Make `calendars` optional, add `exclude_calendars`, `include_all_day_as_busy`, `ignore_tentative`, rename `preferredStart`/`preferredEnd` → `preferred_start`/`preferred_end` |

### New Tools

**`get_today_events`**
- Input: `calendar?`, `detail_level?`
- Logic: compute today's date as ISO start (00:00:00) and end (23:59:59), call `service.listEvents(calendar, start, end)`. If no `calendar`, iterate all calendars.
- Returns: `{ events: [...] }`

**`search_events`**
- Input: `query`, `calendar?`, `start?`, `end?`, `detail_level?`
- Logic: default start = 90 days ago, end = 90 days ahead. Call `service.listEvents()` for range, then filter where `query` matches (case-insensitive) against `title`, `description`, or `location`. If no `calendar`, iterate all calendars.
- Returns: `{ events: [...] }` (matched events only)
- For `detail_level: "full"`, fetch full details via `service.getEvent()` for each match.

### `detail_level` Implementation

- `list_events`, `get_today_events`, `search_events` default to `"summary"`
- When `"full"`: fetch each event via `service.getEvent()` for `EventFull` objects
- Tradeoff: extra CalDAV calls per event, but keeps service layer simple

### `calendar` Optional on List Tools

When `calendar` is omitted on `list_events`, `get_today_events`, or `search_events`: call `service.listCalendars()`, iterate all, merge results.

### `span` Parameter

- `update_event`: accept `span`, default `"this"`. For `"this"` and `"future"`, return `error("not_implemented", "Recurring event instance modification is not yet supported")`. `"all"` is current behavior (update the whole event object).
- `delete_event`: accept `span`, default `"all"`. Same stub for `"this"` and `"future"`. `"all"` is current behavior.

---

## Testing Strategy

TDD per layer. Update tests first to assert new spec, then update implementation.

### ical.test.ts
- `parseIcsEvents()`: assert new field names (`title`, `availability`, `is_recurring`, `all_day`, `last_modified`, `recurrence_rule`), lowercase status
- `generateEventIcs()`: accept `title`, `all_day`

### CalDavService.test.ts
- `listCalendars()`: assert `calendar_id`, `display_name`, `color`, `source`, `read_only`
- `listEvents()`: assert `title`, `calendar_id`, `is_recurring`, `all_day`
- `getEvent()`: assert `availability`, `recurrence_rule`, `last_modified`, lowercase status
- `findFreeSlots()`: test `excludeCalendars`, `includeAllDayAsBusy` filtering

### calendarTools.test.ts
- Envelope wrapping: `{ calendars: [...] }`, `{ events: [...] }`, `{ event: {...} }`
- Error format: `{ error: "not_found", message: "..." }`
- New tools: `get_today_events`, `search_events`
- `span` param: stub `not_implemented` for `"this"`/`"future"`
- `detail_level` param
- Tool count: 11 (was 9)
- Input param renames: `title`, `ics_content`, `preferred_start`, etc.

---

## Version & Package Changes

- Bump `package.json` version to `0.3.0`
- Fix `main.ts` server version string (currently hardcoded `"0.1.0"`)
- Update `cal-mcp-tools.json` to reflect new tool schemas

---

## Out of Scope

- Implementing `span` for `"this"`/`"future"` (CalDAV RECURRENCE-ID semantics — deferred)
- `attendee.role` population (reserved field, not available from CalDAV parse currently)
- `url` field population on EventFull (reserved, parse from vevent.url if present)
- Shared validation fixtures with macos-calendar-mcp (separate follow-up)
