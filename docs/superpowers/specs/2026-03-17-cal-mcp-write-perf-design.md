# cal-mcp Write Path Performance Optimization

**Status:** Implemented (cal-mcp@0.5.0)

## Problem

The `update_event` tool times out after 90s on Mailbox.org's CalDAV server (via MCPorter). The current implementation makes 7 network round trips for a single update — many redundant. `createEvent` has similar inefficiency (4 calls), and `deleteEvent` costs 3 calls.

The most expensive call is `fetchCalendarObjects`, which downloads every event in the calendar to find one by UID. This is called up to 3 times per `update_event`.

Additionally, tsdav's write methods (`createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`) do not check HTTP response status — a 412, 404, or 500 is silently swallowed. The post-write `getEvent()` re-fetch accidentally serves as the only error detection.

## Solution

Four changes that reduce `updateEvent` from 7 network calls to 2, with similar reductions for `createEvent` and `deleteEvent`.

## Design

### 1. Explicit Write Response Checking

All three write methods check the `Response` object returned by tsdav:

```typescript
const response = await client.updateCalendarObject({ ... });
if (!response.ok) {
  throw new CalendarError(
    `Failed to update event: ${response.status} ${response.statusText}`,
    ErrorCode.WRITE_FAILED,
    uid,
  );
}
```

Add `WRITE_FAILED` to the `ErrorCode` enum in `pim-core`. `WRITE_FAILED` errors will fall through to the existing `backend_error` path in the tool handler's error switch — no special handling needed.

This replaces the accidental error detection from the post-write re-fetch with proper, immediate error handling that gives specific error messages.

### 2. Cache `fetchCalendars` Per Account

Add a `Map<string, DAVCalendar[]>` to `CalDavService`, keyed by `account.id`, populated on first `findCalendar` call per account.

- `findCalendar` checks the cache first, falls back to network
- `listCalendars` always fetches fresh (user expects current data) and populates the cache as a side effect
- Cache is invalidated on write errors (if a PUT/DELETE fails, clear the cache)
- No TTL — cache lives as long as the process

When the MCP server runs with a persistent process (e.g., MCPorter `"lifecycle": "keep-alive"`, Claude Desktop, or any long-lived MCP client), the cache persists across tool calls. In ephemeral mode (MCPorter default), the cache helps within a single invocation where `findCalendar` is called multiple times.

### 3. Eliminate Redundant `fetchCalendarObjects` in Write Paths

Currently `updateEvent` fetches all calendar objects twice: once in the handler's `getEvent()` call (to read existing fields for merging), and again in the service's `updateEvent()` call (to get the object's URL and ETag for the PUT).

Introduce `getEventWithMeta` that returns both the `EventFull` and the raw CalDAV object metadata:

```typescript
interface CalendarObjectMeta {
  url: string;
  etag?: string;
}

async getEventWithMeta(
  calendarId: string,
  uid: string,
): Promise<{ event: EventFull; meta: CalendarObjectMeta }>
```

Update write method signatures to accept optional pre-fetched metadata:

```typescript
async updateEvent(
  calendarId: string,
  uid: string,
  icalString: string,
  meta?: CalendarObjectMeta,
): Promise<EventFull>

async deleteEvent(
  calendarId: string,
  uid: string,
  meta?: CalendarObjectMeta,
): Promise<void>
```

When `meta` is provided, skip `findCalendarObject` entirely — go straight to PUT/DELETE using the pre-fetched URL and ETag. When omitted, fall back to current behavior (methods still work standalone).

The handler calls `getEventWithMeta` once, then passes `meta` into the write method.

For `createEvent`, there is no prior object to look up. Changes: add response checking after `createCalendarObject`, replace `this.getEvent()` with `parseIcsEvents` to construct the `EventFull` response locally. The `create_events_batch` and `import_ics` handlers call `createEvent` in loops and benefit automatically from the `fetchCalendars` cache.

### 4. Construct `EventFull` From ICS Instead of Re-fetching

After a successful write (create/update), construct the `EventFull` response from the ICS string using `parseIcsEvents` instead of calling `getEvent()` (which costs 2 more network calls).

```typescript
// After successful PUT:
const parsed = parseIcsEvents(icalString, undefined, this.timezone);
const event = parsed.find((e) => e.uid === uid);
// Build EventFull from parsed event + calendarId
```

CalDAV servers store what you send without modification, so parsing the ICS we just wrote is equivalent to fetching it back. Note: some servers may update `DTSTAMP`, `LAST-MODIFIED`, or `SEQUENCE` fields server-side — the constructed response will reflect the values we sent, not any server-side adjustments. This is an accepted minor fidelity trade-off.

The `calendar_id` field must be set from the caller context (it's not in the ICS), matching how `getEvent` sets it today.

## Call Reduction Summary

| Operation | Before | After | Savings |
|-----------|--------|-------|---------|
| `updateEvent` | 7 (fetchCalendars ×3, fetchCalendarObjects ×3, PUT) | 2 (fetchCalendarObjects ×1, PUT) | 5 calls |
| `createEvent` | 4 (fetchCalendars ×2, fetchCalendarObjects ×1, PUT) | 1-2 (PUT, +fetchCalendars if cold cache) | 2-3 calls |
| `deleteEvent` | 3 (fetchCalendars ×1, fetchCalendarObjects ×1, DELETE) | 1-2 (DELETE, +fetchCalendarObjects if no meta) | 1-2 calls |

With `fetchCalendars` cache warm, calendar lookups add 0 network calls. Cold cache adds 1.

## Files Changed

- `packages/core/src/errors.ts` — add `WRITE_FAILED` to `ErrorCode`
- `packages/cal-mcp/src/services/CalDavService.ts` — cache, `getEventWithMeta`, response checking, construct-from-ICS
- `packages/cal-mcp/src/tools/calendarTools.ts` — use `getEventWithMeta`, pass `meta` to write methods
- `packages/cal-mcp/src/__tests__/CalDavService.test.ts` — new and updated tests

## Testing

- Mock write methods to return `Response`-like objects; test both `ok: true` and `ok: false` paths
- Test `getEventWithMeta` returns both event and meta (url, etag)
- Test `updateEvent`/`deleteEvent` skip `findCalendarObject` when `meta` is provided
- Test `fetchCalendars` cache: hit, miss, invalidation on write error
- Existing tests pass with optional `meta` parameter omitted
