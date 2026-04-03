# cal-mcp Recurring Event Instance Operations

**Date:** 2026-03-24
**Status:** Implemented (cal-mcp@0.7.0)
**Scope:** `@miguelarios/cal-mcp` — Add single-instance update/delete for recurring events
**Changes:** 2 enhanced tools (`update_event`, `delete_event`), response schema additions, ICS manipulation infrastructure

---

## Problem

The cal-mcp server can expand recurring events into occurrences for reading, but cannot modify or delete individual instances. `update_event` and `delete_event` both return `not_implemented` when `span` is `"this"` on a recurring event. The macos-calendar-mcp handles this natively via EventKit's `EKSpan`, and the unified schema spec (v1.1) allows backends to return `not_implemented` — but a CalDAV server is fully capable of these operations via RECURRENCE-ID and EXDATE.

This creates a gap: an LLM managing a user's calendar cannot reschedule a single meeting in a recurring series, or cancel one occurrence without deleting the entire series.

---

## Design Principles

**Unified schema alignment.** The tool interface (param names, response shapes, error codes) must match macos-calendar-mcp so the LLM sees a consistent abstraction regardless of backend. `occurrence_date` as both a response field and input param. `span: "this"/"all"` with the same defaults. **Note:** `occurrence_date` is not in the locked unified spec v1.1 — this spec is a co-requisite with a v1.2 amendment that adds `occurrence_date` to EventSummary and as a tool param. Both MCPs already use it as a backend extra; v1.2 promotes it to a core field.

**ICS string preservation.** CalDAV calendar objects may contain properties we don't parse (X-properties, VTIMEZONE, etc.). Operations on the raw ICS must preserve unrecognized content — targeted insertions, not regeneration from scratch.

**Scope: `this` + `all` only.** `span: "future"` requires RRULE manipulation (adding UNTIL, creating a new series) — deferred to a follow-up spec. Recurring event creation via `create_event` is also deferred.

---

## Changes Summary

| Change | Component | Type |
|--------|-----------|------|
| Add `occurrence_date` to EventSummary/EventFull responses | Response schema | Enhanced |
| Populate `occurrence_date` during RRULE expansion and RECURRENCE-ID parsing | ical.ts | Enhanced |
| Implement `span: "this"` for `update_event` on recurring events | Handler + ICS manipulation | New |
| Implement `span: "this"` for `delete_event` on recurring events | Handler + ICS manipulation | New |
| Add `occurrence_date` param to `update_event` and `delete_event` | Tool schema | Enhanced |
| Add ICS manipulation functions (EXDATE, exception VEVENT, combine) | ical.ts | New |
| Expose raw calendar object fetch in CalDavService | Service layer | Enhanced |

---

## Change 1: Response Schema — `occurrence_date`

### Current State

Expanded occurrences from `list_events` all share the same `uid` and `is_recurring: true`. There is no way to distinguish or target a specific occurrence.

### New Behavior

Every expanded occurrence carries an `occurrence_date` field — the ISO 8601 datetime of that specific instance. The LLM uses this value to target the instance in update/delete calls.

### Schema Changes

```typescript
interface EventSummary {
  uid: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  status: string | null;
  is_recurring: boolean;
  occurrence_date: string | null;  // NEW
}
```

`EventFull` inherits `occurrence_date` via `extends EventSummary`. `ParsedEvent` (in ical.ts) also gains `occurrence_date: string | null` — it's the source type that flows through `toEventFull()` and `toEventSummary()` in CalDavService.

### Population Rules

| Context | `occurrence_date` value |
|---------|------------------------|
| `list_events` expanded occurrence (from RRULE) | Start datetime of that occurrence |
| `list_events` expanded occurrence (RECURRENCE-ID exception) | RECURRENCE-ID datetime |
| `get_event` (master/series template) | `null` |
| Non-recurring event | `null` |
| `create_event` result | `null` |

### Implementation

In `parseIcsEvents()`, when expanding occurrences via `rrule.between()`:

```typescript
for (const occStart of occurrences) {
  events.push({
    ...baseProps,
    start: formatTime(occStart.toISOString()),
    end: formatTime(occEnd.toISOString()),
    occurrence_date: formatTime(occStart.toISOString()),  // NEW
  });
}
```

For exception VEVENTs (those with RECURRENCE-ID), parse the RECURRENCE-ID value and set `occurrence_date` to it.

For non-recurring events and master templates: `occurrence_date: null`.

---

## Change 2: Tool Schema — `occurrence_date` param and `span` enum update

### `update_event`

Add `occurrence_date` property, update `span` enum:

```json
{
  "occurrence_date": {
    "type": "string",
    "description": "ISO 8601 date of the specific occurrence to modify. Required when span is 'this' on a recurring event. Get this value from list_events results."
  },
  "span": {
    "type": "string",
    "enum": ["this", "all"],
    "description": "Recurring event scope. 'this' modifies only this occurrence, 'all' modifies the entire series. Default: this."
  }
}
```

### `delete_event`

Add `occurrence_date` property, update `span` enum:

```json
{
  "occurrence_date": {
    "type": "string",
    "description": "ISO 8601 date of the specific occurrence to delete. Required when span is 'this' on a recurring event. Get this value from list_events results."
  },
  "span": {
    "type": "string",
    "enum": ["this", "all"],
    "description": "Recurring event scope. 'this' deletes only this occurrence, 'all' deletes the entire series. Default: all."
  }
}
```

### Validation

- `span: "this"` + `is_recurring` + no `occurrence_date` → `VALIDATION_FAILED`: "occurrence_date is required when modifying a single occurrence of a recurring event"
- `span: "this"` + non-recurring → `occurrence_date` ignored, normal update/delete
- `span: "all"` → `occurrence_date` ignored
- `span: "future"` → `not_implemented` (deferred)

---

## Change 3: ICS Manipulation Infrastructure

Three new functions in `ical.ts` for manipulating raw ICS strings.

### `addExdateToIcs(icsContent: string, occurrenceDate: string, allDay: boolean): string`

Inserts an EXDATE line into the master VEVENT to exclude a specific occurrence. **Used only by delete `span: "this"` — update uses RECURRENCE-ID exception instead (no EXDATE needed).**

```
Input:  Raw ICS content, occurrence date, all-day flag
Output: ICS content with EXDATE added before the first END:VEVENT

Behavior:
- Formats date as EXDATE:20260324T090000Z (timed) or EXDATE;VALUE=DATE:20260324 (all-day)
- Uses the same timezone as the master event's DTSTART (TZID param if present)
- Inserts before the first END:VEVENT in the ICS
- If an EXDATE for that date already exists, no-op (idempotent)
  - Idempotency check: normalize both dates to UTC before comparison to handle
    format differences (Z suffix vs TZID-parameterized, comma-separated lists)
- Preserves all other ICS content unchanged
```

### `createExceptionVevent(masterIcs: string, occurrenceDate: string, overrides: object, allDay: boolean): string`

Builds an exception VEVENT for a modified single occurrence.

```
Input:  Master ICS (to extract UID, base properties), occurrence date, property overrides, all-day flag
Output: A VEVENT string (BEGIN:VEVENT ... END:VEVENT) with RECURRENCE-ID

Behavior:
- Parses master ICS to extract UID and base event properties
- Applies overrides (title, start, end, location, description, attendees, alarms, categories)
- Non-overridden properties inherit from the master
- Sets RECURRENCE-ID to the occurrence date (same timezone format as master DTSTART)
- Sets DTSTART/DTEND from overrides (or original occurrence time if not overridden)
- Sets SEQUENCE to master's SEQUENCE + 1 (RFC 5545 best practice for modifications)
- Built via string construction (not ical-generator — it does not support RECURRENCE-ID)
- Returns the VEVENT block as a string (not a full VCALENDAR)
```

### `combineIcsComponents(masterIcs: string, exceptionVevent: string): string`

Merges the exception VEVENT into the master's VCALENDAR.

```
Input:  Master ICS, exception VEVENT string
Output: Combined ICS with both master and exception VEVENTs in one VCALENDAR

Behavior:
- If an existing VEVENT with matching RECURRENCE-ID already exists in the ICS,
  remove it first (prevents duplicates when re-editing an already-modified occurrence)
- Inserts the exception VEVENT before END:VCALENDAR
- Preserves VTIMEZONE, X-properties, and all other components
- Returns a valid ICS string ready for CalDAV PUT
```

### Why String Manipulation

The master ICS may contain properties and components that our parser doesn't model (VTIMEZONE blocks, X-properties from other clients, VALARM with exotic actions, etc.). Regenerating from scratch would lose these. By operating on the raw string with targeted insertions, we preserve everything we don't understand.

---

## Change 4: CalDavService — Expose `findCalendarObject()`

### Purpose

The existing private `findCalendarObject()` method already returns `{ url, etag, data }` — the raw ICS string and CalDAV metadata needed for ICS manipulation. Rather than creating a duplicate method, make it accessible to the handler.

### Approach

Change `findCalendarObject()` from `private` to `public` (or add a thin public wrapper). The method signature is already correct:

```typescript
async findCalendarObject(
  client: DAVClient,
  calendar: any,
  uid: string,
): Promise<{ url: string; etag?: string; data?: string }>
```

Since this requires a `client` and `calendar` param (internal tsdav objects), the cleanest approach is a new public method that handles connection setup:

```typescript
async fetchRawCalendarObject(
  calendarId: string,
  uid: string,
): Promise<{ data: string; url: string; etag: string }>
```

This wraps `findCalendarObject()` with the connection boilerplate (same pattern as `getEventWithMeta`), asserts `data` and `etag` are non-null, and returns them.

---

## Change 5: Handler Logic

### `update_event` handler — updated flow

```
1. Parse span (default: "this"), occurrence_date from args
2. Fetch event via getEventWithMeta() to check is_recurring

3. If is_recurring AND span === "this":
   a. Validate occurrence_date is present → VALIDATION_FAILED if missing
   b. fetchRawCalendarObject() → { data: masterIcs, url, etag }
   c. Validate occurrence_date matches an RRULE instance or existing RECURRENCE-ID
      (expand RRULE via parseIcsEvents with a range around the date, or check existing
      exception VEVENTs) → VALIDATION_FAILED if no match
   d. Parse master to get base properties for non-overridden fields
   e. createExceptionVevent(masterIcs, occurrence_date, overrides, existing.all_day)
   f. combineIcsComponents(masterIcs, exceptionVevent)
      (removes any existing exception for this date, then inserts new one)
   g. updateEvent(calendarId, uid, combinedIcs, { url, etag })
   h. Return { event: EventFull } (the exception event's properties)

4. If is_recurring AND span === "future":
   Return not_implemented (deferred)

5. If is_recurring AND span === "all":
   Existing behavior — fetch event, merge fields, regenerate full ICS, update

6. If non-recurring:
   Existing behavior unchanged (occurrence_date ignored)
```

### `delete_event` handler — updated flow

```
1. Parse span (default: "all"), occurrence_date from args

2. If span === "this":
   a. Fetch event via getEventWithMeta() to check is_recurring
   b. If non-recurring: existing delete behavior
   c. If recurring:
      i.   Validate occurrence_date is present → VALIDATION_FAILED if missing
      ii.  fetchRawCalendarObject() → { data: masterIcs, url, etag }
      iii. Validate occurrence_date matches an RRULE instance or existing RECURRENCE-ID
      iv.  addExdateToIcs(masterIcs, occurrence_date, event.all_day)
      v.   If an exception VEVENT exists for this date, remove it from the ICS
      vi.  updateEvent(calendarId, uid, masterWithExdate, { url, etag })
      vii. Return { deleted: true, uid }

3. If span === "future":
   Fetch event, check is_recurring → not_implemented if recurring

4. If span === "all":
   Existing behavior — delete entire calendar object
```

### Response for `update_event` span="this"

Same shape as existing `update_event` response — `{ event: EventFull }`. The `EventFull` object contains the exception event's properties, with `occurrence_date` set to the targeted date and `is_recurring: true`. No extra top-level fields — keeps the response shape consistent with the unified spec.

---

## Edge Cases

- **Occurrence already has an exception:** If the LLM targets an occurrence that was already modified (RECURRENCE-ID already exists for that date), the update should replace the existing exception VEVENT, not create a duplicate. The `addExdateToIcs` is idempotent, and the old exception VEVENT should be removed before inserting the new one.

- **Occurrence date doesn't match any RRULE instance:** Return `VALIDATION_FAILED` — the date doesn't correspond to a valid occurrence. We can validate this by checking if the date appears in `rrule.between()` results or existing RECURRENCE-IDs.

- **All-day events:** EXDATE and RECURRENCE-ID use `VALUE=DATE` format (`20260324`) instead of datetime format (`20260324T090000Z`). The `allDay` flag from the master event determines which format to use.

- **Timezone handling:** RECURRENCE-ID and EXDATE should use the same timezone as the master event's DTSTART. If DTSTART is `TZID=America/Chicago:20260324T090000`, then RECURRENCE-ID should also use that TZID.

- **list_events with detail_level="full":** When the handler fetches full details for expanded occurrences, it must preserve the `occurrence_date` from the summary-level expansion rather than re-fetching via `getEvent()` (which returns the master with `occurrence_date: null`).

---

## Deferred

- **`span: "future"`** — Requires RRULE manipulation (add UNTIL clause to truncate series, optionally create new series for remaining events). Complex RRULE parsing needed. Separate spec.
- **Recurring event creation** — Add `recurrence_rule` param to `create_event`. On the roadmap but not blocking.
- **`get_event` for exceptions** — Currently returns master only. Could add an `exceptions` array in future.

---

## Dependencies

No new package dependencies. All required functionality available through:

- `node-ical` — Existing RRULE expansion, will add RECURRENCE-ID parsing
- `ical-generator` — Existing event generation, used for building exception VEVENTs
- `tsdav` — Existing CalDAV operations, `fetchCalendarObjects` already returns raw data
- String manipulation — For EXDATE insertion and ICS component combining
