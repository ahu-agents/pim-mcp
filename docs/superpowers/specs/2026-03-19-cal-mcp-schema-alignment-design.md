# cal-mcp Schema Alignment with macos-calendar-mcp

**Date:** 2026-03-19
**Status:** Implemented (cal-mcp@0.6.0)
**Scope:** packages/cal-mcp (no pim-core changes)
**Goal:** Add missing iCal/CalDAV data fields so cal-mcp and macos-calendar-mcp return interchangeable responses from an agent's perspective.

## Decisions

- **Omit EventKit-only fields** (virtual_conference, is_detached, occurrence_date, travel_time) — keep responses lean, no phantom nulls
- **Omit `is_current_user`** on attendees/organizer — CalDAV can't reliably determine this
- **GEO as `{ latitude, longitude }`** — not the macos `location_detail` shape; honest representation of what iCal provides (no name, no radius)
- **Tool descriptions already aligned** — macos-calendar-mcp was updated to match cal-mcp; no description changes needed
- **Trigger sign convention:** RFC 5545 semantics — negative = before event, positive = after event. Invert when calling ical-generator on write (ical-generator uses positive = before).
- **New fields are backend-specific extras** per unified spec convention — agents MUST NOT depend on them until unified spec is updated to v1.2

## 1. ParsedEvent & Response Schema Changes

### ParsedEvent (ical.ts) gains:

```typescript
alarms: Array<{
  type: "relative" | "absolute";
  trigger: number | string;     // seconds offset (negative=before) or ISO 8601 datetime
  trigger_human: string;        // "15 minutes before", "March 19, 2026 at 2:00 PM UTC"
}>;
categories: string[];
geo: { latitude: number; longitude: number } | null;
```

### Attendee gains `type`:

```typescript
attendees: Array<{
  name: string | null;
  email: string;
  status: string | null;
  role: string | null;
  type: string;  // "unknown" | "person" | "room" | "resource" | "group"
}>;
```

### EventFull (CalDavService.ts) gains same fields

### EventSummary — unchanged

### CalendarInfo — `read_only` becomes real (currently hardcoded false)

### Refactor: toEventFull helper

Extract a `toEventFull(event: ParsedEvent, calendarId: string): EventFull` helper in CalDavService.ts to eliminate the 5 copy-paste mapping sites (getEvent, getEventWithMeta, createEvent, updateEvent, listEvents full). New fields are added in one place.

## 2. Parsing (ical.ts — parseIcsEvents)

### Alarms

node-ical v0.20 exposes `vevent.alarms` as `VAlarm[]` with typed `trigger: string` and `action: string`. Use this structured data — no raw ICS regex parsing needed.

The trigger string is the raw iCal TRIGGER value:
- Relative: `-PT15M`, `-PT2H`, `-P1D`, `-PT1H30M` — parse ISO 8601 duration to seconds
- Absolute: `20260319T140000Z` — convert to ISO 8601 datetime string

Duration parser: lightweight inline function covering `P[nD][T[nH][nM][nS]]` patterns. No external dependency needed — the format is well-constrained.

`trigger_human` formatting rules:
- Relative: `"{n} {unit} before"` / `"{n} {unit} after"` / `"At time of event"` (for 0). Uses largest meaningful unit (e.g., "1 day before" not "86400 seconds before"). Combined units: "1 hour, 30 minutes before".
- Absolute: formatted datetime string (e.g., "March 19, 2026 at 2:00 PM UTC")

`TRIGGER;RELATED=END` (relative to event end): represent with negative seconds same as start-relative. The RELATED param distinction is lost — acceptable for MVP since it's rarely used.

### Categories

node-ical's VEvent type does not declare `categories` but the runtime parser populates it. Access via `(vevent as any).categories` — consistent with existing `url` pattern. Runtime shape may be `string[]` or `string`; normalize to `string[]` with fallback.

### CUTYPE

Available on attendee params via node-ical. Mapping:
- `INDIVIDUAL` → `"person"`
- `ROOM` → `"room"`
- `RESOURCE` → `"resource"`
- `GROUP` → `"group"`
- default/missing → `"unknown"`

Note: This uses friendly names unlike `role` which uses raw iCal values lowercased. Justified because it aligns with macos-calendar-mcp and is more readable for agents.

### GEO

node-ical exposes `vevent.geo` as `{ lat, lon }`. Map to `{ latitude: number, longitude: number }`. If either value is NaN or missing, return `null`. Access via `(vevent as any).geo` if not in type definitions.

## 3. ICS Generation (ical.ts — generateEventIcs)

### EventCreateProps gains:

```typescript
alarms?: Array<{
  type: "relative" | "absolute";
  trigger: number | string;  // seconds for relative (negative=before), ISO 8601 for absolute
}>;
categories?: string[];
```

### Alarms

ical-generator supports alarms natively via `event.createAlarm()`. For relative alarms: invert sign (RFC negative → ical-generator positive) and pass to trigger option. For absolute alarms: pass `new Date(trigger)`. `trigger_human` is output-only — not accepted on input.

### Categories

ical-generator lacks built-in category support. Insert `CATEGORIES:tag1,tag2` line before `END:VEVENT` in the generated ICS string. For simplicity, assume short category names without commas — document this limitation. RFC 5545 line folding applies at 75 octets; handle by splitting if needed.

### GEO and CUTYPE — write deferred

GEO is rarely set by users (geocoding is client-side). CUTYPE defaults to INDIVIDUAL in the spec, so omitting on write is correct. Both are read-only.

## 4. read_only via CalDAV Privileges

In `CalDavService.listCalendars()`:

1. Override `props` param on `fetchCalendars()` to include `{DAV:}current-user-privilege-set` alongside ALL existing defaults (displayname, calendar-color, calendar-description, calendar-timezone, ctag, resourcetype, supported-calendar-component-set, sync-token). Note: tsdav's custom `props` replaces the default set, so all defaults must be explicitly included.
2. Inspect returned privilege set for `{DAV:}write` / `{DAV:}write-content` / `{DAV:}bind`
3. If no write privileges present → `read_only: true`
4. If server doesn't return privilege info → `read_only: false` (safe fallback)

No extra network round trips — single additional XML element in existing PROPFIND.

**Risk:** The privilege data may land in `projectedProps` or be stripped by tsdav's response parser. If `fetchCalendars` does not cleanly surface the privilege set, fallback to a separate `propfind()` call per calendar URL. This adds round trips but is more reliable. Spike test against the configured Nextcloud instance before committing to the approach.

## 5. Tool Schema & Handler Updates

### New params on create_event, update_event, create_events_batch:

```json
{
  "alarms": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["relative", "absolute"] },
        "trigger": { "description": "Seconds offset (negative=before event) for relative, or ISO 8601 datetime for absolute" }
      },
      "required": ["type", "trigger"]
    },
    "description": "Event reminders/alarms"
  },
  "categories": {
    "type": "array",
    "items": { "type": "string" },
    "description": "Event categories/tags"
  }
}
```

### Handler changes

- create_event and update_event pass alarms and categories through to generateEventIcs()
- On update, preserve existing alarms/categories when not provided (same merge pattern as other fields)
- No tool schema changes for read-only output fields — alarms, categories, geo, attendee type appear automatically in EventFull responses

## 6. Testing

All TDD — failing test first, then implement.

### ical.ts parsing tests
- Parse VALARM relative trigger (-PT15M → { type: "relative", trigger: -900, trigger_human: "15 minutes before" })
- Parse VALARM relative trigger with hours (-PT2H → trigger: -7200)
- Parse VALARM relative trigger with days (-P1D → trigger: -86400)
- Parse VALARM relative trigger with combined units (-PT1H30M → trigger: -5400, trigger_human: "1 hour, 30 minutes before")
- Parse VALARM absolute trigger
- Parse multiple alarms on one event
- Parse CATEGORIES (single and multi-value)
- Parse CATEGORIES runtime shape normalization (string vs string[])
- Parse CUTYPE on attendees (all 4 types + unknown default)
- Parse GEO property
- Parse GEO with malformed/missing values → null
- Event with no alarms/categories/geo → empty arrays / null

### ical.ts generation tests
- Generate ICS with relative alarm (verify sign inversion for ical-generator)
- Generate ICS with absolute alarm
- Generate ICS with multiple alarms
- Generate ICS with categories
- Generate ICS with alarms + categories together
- Alarm round-trip: generate → parse → verify alarms survive

### CalDavService tests
- listCalendars returns read_only: true when privilege set lacks write
- listCalendars returns read_only: false when privilege set includes write
- listCalendars defaults read_only: false when privilege info absent
- toEventFull helper maps all fields correctly
- getEvent / listEvents full detail includes new fields

### Handler tests
- create_event with alarms param
- update_event with categories param
- Existing alarm/category preservation on update when not provided
- list_calendars handler passes through read_only field
