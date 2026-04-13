# Calendar MCP Tools

`@miguelarios/cal-mcp` — CalDAV calendar server with 11 tools.

## list_calendars

List all calendars across all configured CalDAV providers. Returns provider-prefixed IDs (e.g., `mailbox/work`).

*No parameters.*

## list_events

Query events in a date range. Recurring events are expanded into individual instances.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | | Provider-prefixed calendar ID (e.g., `mailbox/Work`). If omitted, queries all calendars. |
| `start` | string | yes | Start of date range (ISO 8601). |
| `end` | string | yes | End of date range (ISO 8601). |
| `detail_level` | `"summary"` \| `"full"` | | Response verbosity. Defaults to `summary`. |

## get_today_events

Get all events for today. Convenience wrapper over `list_events`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | | Provider-prefixed calendar ID. If omitted, queries all calendars. |
| `detail_level` | `"summary"` \| `"full"` | | Response verbosity. Defaults to `summary`. |

## search_events

Keyword search across event title, description, and location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term. |
| `calendar` | string | | Provider-prefixed calendar ID. If omitted, searches all calendars. |
| `start` | string | | Range start (ISO 8601). Defaults to 90 days ago. |
| `end` | string | | Range end (ISO 8601). Defaults to 90 days ahead. |
| `detail_level` | `"summary"` \| `"full"` | | Response verbosity. Defaults to `summary`. |

## get_event

Get full details of a single event by calendar and UID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `uid` | string | yes | Event UID. |

## create_event

Create a new calendar event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `title` | string | yes | Event title. |
| `start` | string | yes | Start time (ISO 8601). |
| `end` | string | yes | End time (ISO 8601). |
| `all_day` | boolean | | All-day event flag. Defaults to false. |
| `location` | string | | Event location. |
| `description` | string | | Event description. |
| `attendees` | object[] | | List of attendees. Each object: `email` (required), `name`. |
| `alarms` | object[] | | Event reminders. Each object: `type` (`"relative"` or `"absolute"`, required), `trigger` (seconds offset for relative, ISO 8601 datetime for absolute, required). |
| `categories` | string[] | | Event categories/tags. |

## update_event

Update an existing event. Only provided fields are changed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `uid` | string | yes | Event UID to update. |
| `title` | string | | New event title. |
| `start` | string | | New start time (ISO 8601). |
| `end` | string | | New end time (ISO 8601). |
| `all_day` | boolean | | All-day event flag. |
| `location` | string | | New location. |
| `description` | string | | New description. |
| `attendees` | object[] | | New attendee list (replaces existing). Each object: `email` (required), `name`. |
| `alarms` | object[] | | Event reminders. Each object: `type` (`"relative"` or `"absolute"`, required), `trigger` (required). |
| `categories` | string[] | | Event categories/tags. |
| `occurrence_date` | string | | ISO 8601 date of the specific occurrence to modify. Required when `span` is `"this"` on a recurring event. Get this value from `list_events` results. |
| `span` | `"this"` \| `"all"` | | `"this"` modifies only this occurrence, `"all"` modifies the entire series. Defaults to `this`. |

## delete_event

Delete a calendar event by UID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `uid` | string | yes | Event UID to delete. |
| `occurrence_date` | string | | ISO 8601 date of the specific occurrence to delete. Required when `span` is `"this"` on a recurring event. Get this value from `list_events` results. |
| `span` | `"this"` \| `"all"` | | `"this"` deletes only this occurrence, `"all"` deletes the entire series. Defaults to `all`. |

## create_events_batch

Create multiple events at once. Returns created event count.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `events` | object[] | yes | Array of events to create. Each event follows the same schema as `create_event`. |

## import_ics

Import events from iCalendar (.ics) content into a calendar.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendar` | string | yes | Provider-prefixed calendar ID. |
| `ics_content` | string | yes | Raw iCalendar content string. |

## find_free_slots

Find available time slots across specified calendars. Returns free windows matching the requested duration.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendars` | string[] | | Provider-prefixed calendar IDs to check. If omitted, uses all calendars. |
| `start` | string | yes | Start of search range (ISO 8601). |
| `end` | string | yes | End of search range (ISO 8601). |
| `duration` | number | yes | Minimum slot duration in minutes. |
| `preferred_start` | string | | Preferred earliest time (HH:MM, e.g., "08:00"). |
| `preferred_end` | string | | Preferred latest time (HH:MM, e.g., "17:00"). |
| `exclude_calendars` | string[] | | Calendar IDs to exclude from busy time calculation. |
| `include_all_day_as_busy` | boolean | | Treat all-day events as busy. Defaults to false. |
| `ignore_tentative` | boolean | | If true, tentative events don't block slots. Defaults to false. |
