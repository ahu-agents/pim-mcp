# cal-mcp Testing Bugs (2026-03-13)

Bugs found during manual testing via MCP Inspector against live CalDAV (Mailbox.org).

## BUG-1: `node-ical` ESM import broken (FIXED in v0.3.2)

- **Tool:** all tools that parse ICS (list_events, get_event, search_events, etc.)
- **Error:** `nodeIcal.parseICS is not a function`
- **Cause:** `import * as nodeIcal from "node-ical"` doesn't work for CJS packages in ESM context — `parseICS` is on the default export
- **Fix:** Changed to `import nodeIcal from "node-ical"` in `src/ical.ts`
- **Released:** cal-mcp@0.3.2

## BUG-2: Recurring events return original date, not occurrences in range

- **Tool:** list_events, search_events (likely get_today_events too)
- **Symptom:** Recurring events are returned by the CalDAV server (correctly matching the queried range), but cal-mcp displays the **original** start/end date from the ICS, not the occurrence within the range. Examples:
  - "Diana Dance Class" (original 2026-02-14) returned in a 2026-03-13–14 query
  - "Plan Birthday" (original 2025-06-04) returned in a search with 90-day default range (~2025-12-14 to ~2026-06-11)
- **Expected:** Expand recurrences into individual occurrences within the time range with correct dates.
- **Impact:** High — agents see wrong dates for recurring events, leading to confusion and potential scheduling errors.
- **Status:** FIXED in cal-mcp@0.4.0 — `parseIcsEvents` now expands recurring events via `rrule.between()` within the queried time range. Known limitation: EXDATE (cancelled occurrences) not handled.

## BUG-3: No timezone support — events created with GMT metadata

- **Tool:** All tools (read and write), also applies to email-mcp timestamps
- **Symptom (read):** All times returned in UTC (`Z` suffix). No conversion to user's local timezone.
- **Symptom (write):** Events created via cal-mcp have their timezone set to GMT in the ICS metadata. Even though the rendered time is correct (e.g., 10 AM CT = 15:00Z), the calendar app shows "timezone: GMT" on the event.
- **Expected behavior:**
  - **Output (read):** All timestamps returned by the MCP (calendar and email) should be converted to the user's local timezone, derived from the OS (like other apps do). E.g., return `2026-03-14T10:00:00-05:00` instead of `2026-03-14T15:00:00Z`.
  - **Input (write), option A:** Accept UTC timestamps and the MCP translates to the user's preferred timezone when generating ICS. E.g., agent sends `15:00Z`, MCP creates `DTSTART;TZID=America/Chicago:20260314T100000`.
  - **Input (write), option B:** Accept timestamps with explicit timezone (e.g., `2026-03-14T10:00:00-05:00` or `2026-03-14T09:00:00-07:00`). The MCP uses the provided timezone in the ICS, similar to how a person in Pacific time creates an event at their local time — the recipient sees it in their own timezone but the event retains the creator's timezone metadata.
  - Both options should be supported — UTC input gets the user's default TZ, explicit TZ input is used as-is.
- **Implementation:** Detect user timezone from OS (`Intl.DateTimeFormat().resolvedOptions().timeZone`) with optional `PIM_TIMEZONE` env var override. Apply to both cal-mcp and email-mcp.
- **Impact:** Medium-high — agents and users see confusing UTC times; created events show wrong timezone origin.
- **Status:** FIXED in pim-core@0.3.0 + cal-mcp@0.4.0 — timezone detection via `Intl`/`PIM_TIMEZONE` env var, read path formats output in local TZ, write path sets TZID on ICS events. Email-mcp changes deferred.

## BUG-4: Attendee status and role always null

- **Tool:** get_event (any tool returning detailed event)
- **Symptom:** `attendees[].status` and `attendees[].role` are always `null`, even when the ICS has `PARTSTAT=ACCEPTED` and `ROLE=REQ-PARTICIPANT`.
- **Cause:** `src/ical.ts` line 62 hardcodes `status: null, role: null` instead of reading `att.params?.PARTSTAT` and `att.params?.ROLE`.
- **Impact:** Agents can't tell if attendees accepted/declined, making RSVP-related queries impossible.
- **Status:** FIXED in cal-mcp@0.4.0 — reads `att.params.PARTSTAT` and `att.params.ROLE`, lowercased.

## BUG-6: update_event silently fails — generates ICS with wrong UID

- **Tool:** update_event
- **Symptom:** update_event reports success but the event is not actually modified on the server. The response shows the old event data.
- **Cause:** `generateEventIcs()` doesn't accept or set the event UID — `ical-generator` assigns a new random UID. The CalDAV server receives an ICS with a mismatched UID and likely rejects or ignores the update. The handler then re-fetches the original event by UID (line 277 in CalDavService.ts), returning stale data that looks like success.
- **Fix:** Pass the existing UID into `generateEventIcs()` and set it on the ical-generator event object.
- **Impact:** High — update_event is completely broken. No events can be updated.
- **Status:** FIXED in cal-mcp@0.4.0 — `generateEventIcs` now accepts and sets custom UID via `event.uid()`.

## BUG-7: DAVClient login not cached — redundant auth on every call

- **Tool:** All tools
- **Symptom:** Every method in `CalDavService` creates a new `DAVClient` and calls `login()`. For batch operations this means N logins for N events. Single operations do login + find calendar + action + re-fetch (4 round trips minimum).
- **Expected:** Cache the authenticated client per account for the lifetime of the MCP server process, or at minimum reuse within a single tool call (e.g., batch create).
- **Impact:** Medium — causes noticeable latency on every operation, compounds for batch tools.
- **Note:** card-mcp likely has the same issue (also uses tsdav). email-mcp is faster because imapflow manages its own connection.
- **Status:** FIXED in cal-mcp@0.4.0 — `getClient()` caches authenticated DAVClient per account ID. No TTL; acceptable for short-lived MCP processes.

## BUG-8: create_events_batch schema missing field descriptions and required markers

- **Tool:** create_events_batch
- **Symptom:** The `events` array items schema has bare `{ type: "string" }` for fields with no descriptions. The `required` array exists but field descriptions are missing, so agents have no guidance on formats (e.g., ISO 8601 for dates).
- **Expected:** Add descriptions and `required: ["title", "start", "end"]` to the items schema, matching create_event.
- **Impact:** Low-medium — agents may omit required fields or use wrong formats.
- **Status:** FIXED in cal-mcp@0.4.0 — added field descriptions matching create_event schema.

## BUG-5: Inconsistent parameter names across tools

- **Tool:** All tools
- **Symptom:** Some tools use `calendarId`/`eventId` (get_event, list_events), others use `calendar`/`uid` (update_event, delete_event), and find_free_slots uses `start`/`end` while list_events uses `timeMin`/`timeMax`. This confuses both agents and human testers.
- **Expected:** Consistent param names across all tools.
- **Impact:** Medium — agents may use wrong param names, causing silent failures or unexpected defaults.
- **Status:** NOT A BUG — all tools consistently use `calendar`/`uid`. `find_free_slots` uses `calendars` (plural array) which is intentional. Original report was caused by tester error.

## BUG-9: find_free_slots may overlap with event boundaries

- **Tool:** find_free_slots
- **Symptom:** A free slot was reported ending at 10:00 AM CT, but an actual event starts at 9:50 AM CT — a 10-minute overlap where the slot says "free" but the user is busy.
- **Expected:** Free slots should end at or before the next event's start time.
- **Impact:** Medium — could cause double-bookings if an agent schedules into the overlapping window.
- **Status:** FIXED — resolved by BUG-2 recurrence expansion fix. Free slot boundaries are exact.
