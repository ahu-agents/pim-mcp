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
  location: string | null;   // always present, null when absent
  status: string | null;     // lowercase values, null when absent
  is_recurring: boolean;     // was isRecurring
}
```

**EventFull (extends EventSummary):**

All fields always present in JSON output. Use `| null` not `?` (optional).
The spec requires keys to be present with `null` values, not omitted.

```typescript
interface EventFull extends EventSummary {
  description: string | null;
  url: string | null;                     // NEW, parse from vevent.url
  availability: string | null;            // was transparency, values: busy/free/tentative/unavailable
  attendees: Array<{
    name: string | null;
    email: string;
    status: string | null;                // lowercase
    role: string | null;                  // NEW (not populated by CalDAV yet, always null)
  }>;                                     // always present, empty array when none
  organizer: {
    name: string | null;
    email: string;
  } | null;                               // null when absent
  recurrence_rule: string | null;         // was recurrenceRule
  created: string | null;
  last_modified: string | null;           // was lastModified
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

Type renames flow through automatically. Signature changes noted below.

- **`listCalendars()`**: Add `color` (from tsdav `calendarColor` if available, else `null`), `read_only` (from tsdav privileges if available, else `false`), rename `providerId` → `source` in mapping.

- **`listEvents()`**: Internal `toEventSummary()` mapping uses new field names from ParsedEvent. Adds `all_day`. Ensures `location` and `status` are `null` (not `undefined`) when absent.

- **`getEvent()`**: Internal `toEventFull()` mapping uses new field names. All nullable fields emit `null` when absent (not omitted). `attendees` is `[]` when none. `organizer` is `null` when absent.

- **`createEvent()`**: Signature changes from `Promise<void>` to `Promise<EventFull>`. After creating the calendar object, performs a fetch-after-write: calls `getEvent(calendarId, uid)` to retrieve and return the created event. The UID is extracted from the generated ICS before upload.

- **`updateEvent()`**: Signature changes from `Promise<void>` to `Promise<EventFull>`. After updating, calls `getEvent(calendarId, uid)` to retrieve and return the updated event.

- **`findFreeSlots()`**: `FindFreeSlotsOptions` gains `excludeCalendars` and `includeAllDayAsBusy`. Filter logic: skip events where `availability === "free"`, skip all-day events unless `includeAllDayAsBusy` is `true`, skip tentative events when `ignoreTentative` is `true`, skip events from `excludeCalendars`. Block otherwise.

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
- Input validation failures (missing required fields, invalid date formats) → `validation_error`
- Everything else → `backend_error`

### Tool Schema Changes (Existing)

| Tool | Change |
|------|--------|
| `create_event` | `summary` → `title`, add `all_day` param. `calendar` stays required (CalDAV needs a target account+calendar; "system default" does not apply to multi-account CalDAV). |
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
- Logic: default start = 90 days ago, end = 90 days ahead. Call `service.listEvents()` for range, then filter where `query` matches (case-insensitive) against `title` and `location` (the summary-level fields). If no `calendar`, iterate all calendars.
- Returns: `{ events: [...] }` (matched events only)
- For `detail_level: "full"`, fetch full details via `service.getEvent()` for each match. At full detail, also match against `description`.
- Note: at summary level, `description` is not available so it is not searched. This is an acceptable tradeoff — most searches target title/location anyway.

### `detail_level` Implementation

- `list_events`, `get_today_events`, `search_events` default to `"summary"`
- When `"full"`: fetch each event via `service.getEvent()` for `EventFull` objects
- Tradeoff: extra CalDAV calls per event, but keeps service layer simple

### `calendar` Optional on List Tools

When `calendar` is omitted on `list_events`, `get_today_events`, or `search_events`: call `service.listCalendars()`, iterate all, merge results.

### `span` Parameter

- `update_event`: accept `span`, default `"this"`. For non-recurring events, `"this"` behaves identically to `"all"` (modifying "this instance" of a non-recurring event IS modifying the whole event). For recurring events, `"this"` and `"future"` return `error("not_implemented", "Recurring event instance modification is not yet supported")`. `"all"` is current behavior (update the whole event object).
- `delete_event`: accept `span`, default `"all"`. Same logic: `"this"` and `"future"` on recurring events return `not_implemented`. `"this"` on a non-recurring event behaves like `"all"`. `"all"` is current behavior.

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

## Implementation Notes

- **`all_day` detection in ical.ts:** Verify that `node-ical` exposes `vevent.datetype === "date"` for all-day events. If not available, fall back to checking if start/end times are midnight-to-midnight.
- **`all_day` in ical-generator:** Use `allDay: true` option on the event to produce DATE-only DTSTART/DTEND (no time component).
- **`color` from tsdav:** Check if `DAVCalendar` type has a `calendarColor` property. If not, always return `null`.
- **`read_only` from tsdav:** Check tsdav for `privilege` or `acl` properties. If not available, default to `false` and note as known limitation.
- **Internal vs wire casing:** Response types (`EventSummary`, `EventFull`, `CalendarInfo`) use snake_case to match the wire format — no translation layer needed. Internal options types (`FindFreeSlotsOptions`, `EventCreateProps`) use camelCase per TypeScript convention since they never hit the wire directly; the tool layer maps snake_case input params to camelCase options.

---

## Out of Scope

- Implementing `span` for `"this"`/`"future"` (CalDAV RECURRENCE-ID semantics — deferred)
- `attendee.role` population (reserved field, always `null` until CalDAV parse supports it)
- Shared validation fixtures with macos-calendar-mcp (separate follow-up)
