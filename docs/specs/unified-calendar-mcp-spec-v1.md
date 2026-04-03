# Unified Calendar MCP Tool Schema — v1.1

**Date:** 2026-03-11
**Status:** LOCKED
**Agreed by:** cal-mcp (pim-agents) and macos-calendar-mcp

This is the canonical spec for both calendar MCP servers. All tool names, parameter names, types, defaults, response shapes, and MCP response formatting defined here are the contract. Both implementations MUST conform to this spec.

---

## Conventions

- All tool parameter names: **snake_case**
- All response object keys: **snake_case**
- All timestamps: **ISO 8601** (e.g., `2026-03-11T09:00:00-05:00`)
- All time-of-day values: **HH:MM** 24-hour format (e.g., `"08:00"`)
- Status/enum values: **lowercase** (e.g., `"confirmed"`, `"busy"`)
- Backend-specific extra fields MAY appear in responses but agents MUST NOT depend on them

---

## MCP Response Format

Both servers MUST return tool results using the standard MCP response structure. This section defines the wire format the LLM agent receives.

### Success responses

```json
{
  "content": [
    { "type": "text", "text": "<JSON-stringified payload>" }
  ]
}
```

- `content[0].text` contains the **JSON-stringified** tool payload (the response shapes defined per-tool below)
- No `ok` envelope — the absence of `isError` signals success
- Pretty-print JSON (`null, 2` indent) for LLM readability

### Error responses

```json
{
  "content": [
    { "type": "text", "text": "<JSON-stringified error object>" }
  ],
  "isError": true
}
```

- Use MCP's native `isError: true` flag — do NOT rely on `"ok": false` in the payload
- Error payload MUST be a JSON-stringified object with `error` and `message` keys:

```json
{
  "error": "string (error code)",
  "message": "string (human-readable description)"
}
```

Standard error codes:

| Code | When |
|---|---|
| `not_found` | Calendar or event not found |
| `validation_error` | Invalid input parameters |
| `not_implemented` | Optional-support tool not yet available on this backend |
| `backend_error` | CalDAV/EventKit operation failed |

### Implementation notes

- **cal-mcp (TypeScript):** Already uses `isError: true` via MCP SDK. Change error text to JSON-stringified error objects.
- **macos-calendar-mcp (Python/FastMCP):** FastMCP auto-wraps return values into `content` array. Return raw dicts (FastMCP JSON-stringifies them). For errors, use FastMCP's error mechanism or raise `ToolError` to set `isError: true`. Stop using `{"ok": false}` envelope.

---

## Response Types

### CalendarInfo

```json
{
  "calendar_id": "string",
  "display_name": "string",
  "color": "string (#RRGGBB) | null",
  "source": "string (provider/account name)",
  "read_only": "boolean"
}
```

### EventSummary

```json
{
  "uid": "string",
  "calendar_id": "string",
  "title": "string",
  "start": "string (ISO 8601)",
  "end": "string (ISO 8601)",
  "all_day": "boolean",
  "location": "string | null",
  "status": "confirmed | tentative | cancelled | null",
  "is_recurring": "boolean"
}
```

### EventFull (extends EventSummary)

```json
{
  "uid": "string",
  "calendar_id": "string",
  "title": "string",
  "start": "string (ISO 8601)",
  "end": "string (ISO 8601)",
  "all_day": "boolean",
  "location": "string | null",
  "status": "confirmed | tentative | cancelled | null",
  "is_recurring": "boolean",
  "description": "string | null",
  "url": "string | null",
  "availability": "busy | free | tentative | unavailable | null",
  "attendees": [
    {
      "name": "string | null",
      "email": "string",
      "status": "accepted | declined | tentative | pending | null",
      "role": "required | optional | chair | null"
    }
  ],
  "organizer": {
    "name": "string | null",
    "email": "string"
  },
  "recurrence_rule": "string (RRULE) | null",
  "created": "string (ISO 8601) | null",
  "last_modified": "string (ISO 8601) | null"
}
```

### FreeSlot

```json
{
  "start": "string (ISO 8601)",
  "end": "string (ISO 8601)",
  "duration": "number (minutes)"
}
```

---

## Tools

### 1. `list_calendars`

List all available calendars across configured providers.

**Input:** _(none)_

**Success payload:**

```json
{
  "calendars": [
    {
      "calendar_id": "work/Engineering",
      "display_name": "Engineering",
      "color": "#2952CC",
      "source": "work",
      "read_only": false
    }
  ]
}
```

---

### 2. `list_events`

Query events in a date range. Recurring events are expanded into individual instances.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | no | all calendars | Calendar ID to filter by |
| `start` | string (ISO 8601) | yes | — | Range start |
| `end` | string (ISO 8601) | yes | — | Range end |
| `detail_level` | `"summary"` \| `"full"` | no | `"summary"` | Response verbosity |

**Success payload:**

```json
{
  "events": [EventSummary, ...]
}
```

Returns `EventFull` objects when `detail_level` is `"full"`.

---

### 3. `get_today_events`

Get all events for today. Convenience wrapper over `list_events`.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | no | all calendars | Calendar ID to filter by |
| `detail_level` | `"summary"` \| `"full"` | no | `"summary"` | Response verbosity |

**Success payload:**

```json
{
  "events": [EventSummary, ...]
}
```

Returns `EventFull` objects when `detail_level` is `"full"`.

---

### 4. `search_events`

Keyword search across event title, description, and location.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search term |
| `calendar` | string | no | all calendars | Calendar ID to filter by |
| `start` | string (ISO 8601) | no | 90 days ago | Range start |
| `end` | string (ISO 8601) | no | 90 days ahead | Range end |
| `detail_level` | `"summary"` \| `"full"` | no | `"summary"` | Response verbosity |

**Success payload:**

```json
{
  "events": [EventSummary, ...]
}
```

Returns `EventFull` objects when `detail_level` is `"full"`.

---

### 5. `get_event`

Get full details of a single event. Always returns full detail.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | yes | — | Calendar ID (EventKit backends may ignore) |
| `uid` | string | yes | — | Event identifier |

**Success payload:**

```json
{
  "event": EventFull
}
```

---

### 6. `create_event`

Create a new calendar event.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | no | system default | Target calendar ID |
| `title` | string | yes | — | Event title |
| `start` | string (ISO 8601) | yes | — | Start datetime |
| `end` | string (ISO 8601) | yes | — | End datetime |
| `all_day` | boolean | no | `false` | All-day event flag |
| `location` | string | no | `null` | Location text |
| `description` | string | no | `null` | Event description |
| `attendees` | array of `{name?, email}` | no | `[]` | Attendee list |

**Success payload:**

```json
{
  "event": EventFull
}
```

---

### 7. `update_event`

Update an existing event. Partial update — only provided fields are changed.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | yes | — | Calendar ID (EventKit backends may ignore) |
| `uid` | string | yes | — | Event identifier |
| `title` | string | no | — | |
| `start` | string (ISO 8601) | no | — | |
| `end` | string (ISO 8601) | no | — | |
| `all_day` | boolean | no | — | |
| `location` | string | no | — | |
| `description` | string | no | — | |
| `attendees` | array of `{name?, email}` | no | — | |
| `span` | `"this"` \| `"future"` \| `"all"` | no | `"this"` | Recurring event scope |

**Success payload:**

```json
{
  "event": EventFull
}
```

**Notes:**
- `span` controls scope for recurring events. `"this"` modifies only the current instance, `"future"` modifies this and all future instances, `"all"` modifies the master event (all instances).
- Backends that do not yet support `span` values `"this"` or `"future"` MUST return an error with code `not_implemented`.

---

### 8. `delete_event`

Delete an event.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | yes | — | Calendar ID (EventKit backends may ignore) |
| `uid` | string | yes | — | Event identifier |
| `span` | `"this"` \| `"future"` \| `"all"` | no | `"all"` | Recurring event scope |

**Success payload:**

```json
{
  "deleted": true,
  "uid": "abc123"
}
```

**Notes:**
- Default `"all"` for delete — deleting a single recurring instance without being explicit is surprising behavior.
- Same `not_implemented` error pattern as `update_event` for backends that don't support `span`.

---

### 9. `find_free_slots`

Find available time slots across calendars.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendars` | array of strings | no | all calendars | Calendar IDs to check for busy time |
| `start` | string (ISO 8601) | yes | — | Range start |
| `end` | string (ISO 8601) | yes | — | Range end |
| `duration` | number (minutes) | yes | — | Minimum slot duration |
| `preferred_start` | string (HH:MM) | no | `"08:00"` | Daily window start |
| `preferred_end` | string (HH:MM) | no | `"17:00"` | Daily window end |
| `exclude_calendars` | array of strings | no | `[]` | Calendar IDs to exclude |
| `include_all_day_as_busy` | boolean | no | `false` | Treat all-day events as busy |
| `ignore_tentative` | boolean | no | `false` | Ignore tentative events |

**Success payload:**

```json
{
  "slots": [
    {
      "start": "2026-03-11T10:00:00-05:00",
      "end": "2026-03-11T11:30:00-05:00",
      "duration": 90
    }
  ],
  "count": 5
}
```

**Notes:**
- An event blocks a slot if its availability is `busy` or `unavailable`, OR `tentative` when `ignore_tentative` is `false`.
- All-day events only block slots when `include_all_day_as_busy` is `true`.
- Slots within the `preferred_start`–`preferred_end` window are sorted first, then chronologically.

---

### 10. `create_events_batch` _(optional-support)_

Create multiple events in a single call.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | yes | — | Target calendar ID |
| `events` | array of event objects | yes | — | Each object has the same fields as `create_event` (minus `calendar`) |

Each event object in the array:

| Param | Type | Required |
|---|---|---|
| `title` | string | yes |
| `start` | string (ISO 8601) | yes |
| `end` | string (ISO 8601) | yes |
| `all_day` | boolean | no |
| `location` | string | no |
| `description` | string | no |
| `attendees` | array of `{name?, email}` | no |

**Success payload:**

```json
{
  "created": 3,
  "events": [EventFull, ...]
}
```

---

### 11. `import_ics` _(optional-support)_

Import events from raw iCalendar (.ics) content.

**Input:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `calendar` | string | yes | — | Target calendar ID |
| `ics_content` | string | yes | — | Raw iCalendar content (RFC 5545) |

**Success payload:**

```json
{
  "imported": 2,
  "events": [EventFull, ...]
}
```

---

## Field Mapping Reference

How each backend maps from its current names to the unified spec:

| Unified (spec) | cal-mcp (current) | macos-calendar-mcp (current) |
|---|---|---|
| `title` | `summary` | `title` (no change) |
| `description` | `description` (no change) | `notes` |
| `uid` | `uid` (no change) | `event_id` / `id` |
| `calendar_id` | `calendarId` | `calendar` (name string) |
| `display_name` | `displayName` | `title` (on calendar object) |
| `all_day` | _(not present)_ | `allDay` |
| `read_only` | _(not present)_ | `!allowsModify` |
| `is_recurring` | `isRecurring` | derived from `recurrence` |
| `last_modified` | `lastModified` | `lastModifiedDate` |
| `recurrence_rule` | `recurrenceRule` | `recurrence.rruleString` |
| `availability` | `transparency` (OPAQUE→busy, TRANSPARENT→free) | `availability` (no change) |
| `status` | uppercase → lowercase | lowercase (no change) |
| `detail_level` | _(not present)_ | `detail_level` (no change) |
| `start` / `end` (params) | `start` / `end` (no change) | `from_date` / `to_date` |
| `span` | _(not present)_ | `span` (no change) |
| `exclude_calendars` | _(not present)_ | `exclude_calendars` (no change) |
| `include_all_day_as_busy` | _(not present)_ | `include_all_day_as_busy` (no change) |
| `ignore_tentative` | _(not present)_ | `ignore_tentative` (no change) |
| `ics_content` | `icsContent` | _(not present)_ |

---

## Migration Checklists

### cal-mcp (pim-agents)

**Response format:**
- [ ] Wrap all success payloads in envelope objects (`{ "calendars": [...] }`, `{ "events": [...] }`, `{ "event": {...} }`, etc.) — stop returning bare arrays/objects
- [ ] Change error responses to JSON-stringified `{ "error": "<code>", "message": "<text>" }` (currently returns plain text strings)

**Field/tool changes:**
- [ ] Rename `summary` → `title` in create/update input and all event responses
- [ ] Add `all_day` field support (input on create/update, output on all events)
- [ ] Add `detail_level` parameter to `list_events`
- [ ] Add `get_today_events` tool
- [ ] Add `search_events` tool
- [ ] Map `transparency` → `availability` in responses (OPAQUE→busy, TRANSPARENT→free)
- [ ] Normalize `status` to lowercase in responses
- [ ] Add `color`, `read_only`, `source` to `list_calendars` response
- [ ] Rename response keys to snake_case (`calendarId`→`calendar_id`, `displayName`→`display_name`, `isRecurring`→`is_recurring`, `lastModified`→`last_modified`, `recurrenceRule`→`recurrence_rule`)
- [ ] Rename `icsContent` param → `ics_content` on `import_ics`
- [ ] Add `exclude_calendars`, `include_all_day_as_busy` (default `false`), `ignore_tentative` to `find_free_slots`
- [ ] Make `calendars` optional on `find_free_slots` (default: all)
- [ ] Add `span` param to `update_event` and `delete_event` (can return `not_implemented` for `"this"`/`"future"` initially; `"all"` should work immediately as it's the current behavior)

### macos-calendar-mcp

**Response format:**
- [ ] Wrap all success payloads in envelope objects (`{ "calendars": [...] }`, `{ "events": [...] }`, `{ "event": {...} }`, etc.) — stop returning raw dicts from Swift CLI
- [ ] Stop using `{"ok": false, "error": "..."}` pattern — use FastMCP's `ToolError` or equivalent to set MCP-level `isError: true` with JSON-stringified `{ "error": "<code>", "message": "<text>" }`
- [ ] Remove `"ok": true` from success payloads — success is implicit (no `isError` flag)

**Field/tool changes:**
- [ ] Rename tool `get_events` → `list_events`
- [ ] Rename params `from_date`/`to_date` → `start`/`end`
- [ ] Rename response field `notes` → `description`
- [ ] Rename `event_id`/`id` → `uid`
- [ ] Rename `calendar` (name) → `calendar_id` in responses
- [ ] Rename response keys to snake_case (`allDay`→`all_day`, `isRecurring`→`is_recurring`, `lastModifiedDate`→`last_modified`, etc.)
- [ ] Add `calendar_id`, `display_name`, `read_only`, `source` to `list_calendars` response
- [ ] Add `is_recurring` to event summary responses
- [ ] Add `attendees` param to `create_event` / `update_event`
- [ ] Add `calendars` (include list) to `find_free_slots`
- [ ] Add `span: "all"` support (apply to master event)
- [ ] Drop `get_upcoming_events`, `get_past_events` from unified exposure (keep as non-standard extras)
- [ ] Add `create_events_batch` tool (implement or `not_implemented` stub)
- [ ] Add `import_ics` tool (implement or `not_implemented` stub)
- [ ] Standardize `status` values to lowercase

---

## Changelog

- **v1.1 (2026-03-11):** Added MCP Response Format section — standardized success/error wire format, envelope objects for all payloads, structured error codes. Updated migration checklists.
- **v1.0 (2026-03-11):** Initial locked spec. Agreed by both agents.
