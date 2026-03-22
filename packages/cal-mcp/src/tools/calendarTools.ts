import { getTimezone, toPimError } from "@miguelarios/pim-core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { generateEventIcs, parseIcsEvents } from "../ical.js";
import type { CalDavService, CalendarObjectMeta, EventSummary } from "../services/CalDavService.js";

export const CALENDAR_TOOLS: Tool[] = [
  {
    name: "list_calendars",
    description:
      "List all calendars across all configured CalDAV providers. Returns provider-prefixed IDs (e.g., mailbox/work).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_events",
    description:
      "Query events in a date range. Recurring events are expanded into individual instances.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description:
            "Provider-prefixed calendar ID (e.g., mailbox/Work). If omitted, queries all calendars.",
        },
        start: {
          type: "string",
          description: "Start of date range (ISO 8601)",
        },
        end: {
          type: "string",
          description: "End of date range (ISO 8601)",
        },
        detail_level: {
          type: "string",
          enum: ["summary", "full"],
          description: "Response verbosity (default: summary)",
        },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_today_events",
    description: "Get all events for today. Convenience wrapper over list_events.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID. If omitted, queries all calendars.",
        },
        detail_level: {
          type: "string",
          enum: ["summary", "full"],
          description: "Response verbosity (default: summary)",
        },
      },
    },
  },
  {
    name: "search_events",
    description: "Keyword search across event title, description, and location.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term",
        },
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID. If omitted, searches all calendars.",
        },
        start: {
          type: "string",
          description: "Range start (ISO 8601). Defaults to 90 days ago.",
        },
        end: {
          type: "string",
          description: "Range end (ISO 8601). Defaults to 90 days ahead.",
        },
        detail_level: {
          type: "string",
          enum: ["summary", "full"],
          description: "Response verbosity (default: summary)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_event",
    description: "Get full details of a single event by calendar and UID.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        uid: { type: "string", description: "Event UID" },
      },
      required: ["calendar", "uid"],
    },
  },
  {
    name: "create_event",
    description: "Create a new calendar event.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        title: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description: "Start time (ISO 8601)",
        },
        end: { type: "string", description: "End time (ISO 8601)" },
        all_day: {
          type: "boolean",
          description: "All-day event flag (default: false)",
        },
        location: { type: "string", description: "Event location" },
        description: {
          type: "string",
          description: "Event description",
        },
        attendees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              name: { type: "string" },
            },
            required: ["email"],
          },
          description: "List of attendees",
        },
        alarms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["relative", "absolute"], description: "Alarm type" },
              trigger: {
                description:
                  "Seconds offset (negative=before event) for relative, or ISO 8601 datetime for absolute",
              },
            },
            required: ["type", "trigger"],
          },
          description: "Event reminders/alarms",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Event categories/tags",
        },
      },
      required: ["calendar", "title", "start", "end"],
    },
  },
  {
    name: "update_event",
    description: "Update an existing event. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        uid: {
          type: "string",
          description: "Event UID to update",
        },
        title: { type: "string", description: "New event title" },
        start: {
          type: "string",
          description: "New start time (ISO 8601)",
        },
        end: {
          type: "string",
          description: "New end time (ISO 8601)",
        },
        all_day: {
          type: "boolean",
          description: "All-day event flag",
        },
        location: { type: "string", description: "New location" },
        description: {
          type: "string",
          description: "New description",
        },
        attendees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              name: { type: "string" },
            },
            required: ["email"],
          },
          description: "New attendee list (replaces existing)",
        },
        alarms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["relative", "absolute"], description: "Alarm type" },
              trigger: {
                description:
                  "Seconds offset (negative=before event) for relative, or ISO 8601 datetime for absolute",
              },
            },
            required: ["type", "trigger"],
          },
          description: "Event reminders/alarms",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Event categories/tags",
        },
        span: {
          type: "string",
          enum: ["this", "future", "all"],
          description: "Recurring event scope (default: this)",
        },
      },
      required: ["calendar", "uid"],
    },
  },
  {
    name: "delete_event",
    description: "Delete a calendar event by UID.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        uid: {
          type: "string",
          description: "Event UID to delete",
        },
        span: {
          type: "string",
          enum: ["this", "future", "all"],
          description: "Recurring event scope (default: all)",
        },
      },
      required: ["calendar", "uid"],
    },
  },
  {
    name: "create_events_batch",
    description: "Create multiple events at once. Returns created event count.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event title" },
              start: {
                type: "string",
                description: "Start time (ISO 8601)",
              },
              end: { type: "string", description: "End time (ISO 8601)" },
              all_day: {
                type: "boolean",
                description: "All-day event flag (default: false)",
              },
              location: { type: "string", description: "Event location" },
              description: {
                type: "string",
                description: "Event description",
              },
              attendees: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    email: { type: "string", description: "Attendee email address" },
                    name: { type: "string", description: "Attendee display name" },
                  },
                  required: ["email"],
                },
                description: "List of attendees",
              },
              alarms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["relative", "absolute"],
                      description: "Alarm type",
                    },
                    trigger: {
                      description:
                        "Seconds offset (negative=before event) for relative, or ISO 8601 datetime for absolute",
                    },
                  },
                  required: ["type", "trigger"],
                },
                description: "Event reminders/alarms",
              },
              categories: {
                type: "array",
                items: { type: "string" },
                description: "Event categories/tags",
              },
            },
            required: ["title", "start", "end"],
          },
          description: "Array of events to create",
        },
      },
      required: ["calendar", "events"],
    },
  },
  {
    name: "import_ics",
    description: "Import events from iCalendar (.ics) content into a calendar.",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Provider-prefixed calendar ID",
        },
        ics_content: {
          type: "string",
          description: "Raw iCalendar content string",
        },
      },
      required: ["calendar", "ics_content"],
    },
  },
  {
    name: "find_free_slots",
    description:
      "Find available time slots across specified calendars. Returns free windows matching the requested duration.",
    inputSchema: {
      type: "object",
      properties: {
        calendars: {
          type: "array",
          items: { type: "string" },
          description:
            "Provider-prefixed calendar IDs to check availability against. If omitted, uses all calendars.",
        },
        start: {
          type: "string",
          description: "Start of search range (ISO 8601)",
        },
        end: {
          type: "string",
          description: "End of search range (ISO 8601)",
        },
        duration: {
          type: "number",
          description: "Minimum slot duration in minutes",
        },
        preferred_start: {
          type: "string",
          description: "Preferred earliest time (HH:MM, e.g., 08:00)",
        },
        preferred_end: {
          type: "string",
          description: "Preferred latest time (HH:MM, e.g., 17:00)",
        },
        exclude_calendars: {
          type: "array",
          items: { type: "string" },
          description: "Calendar IDs to exclude from busy time calculation",
        },
        include_all_day_as_busy: {
          type: "boolean",
          description: "Treat all-day events as busy (default: false)",
        },
        ignore_tentative: {
          type: "boolean",
          description: "If true, tentative events don't block slots (default: false)",
        },
      },
      required: ["start", "end", "duration"],
    },
  },
];

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function error(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

export async function handleCalendarTool(
  name: string,
  args: Record<string, unknown>,
  service: CalDavService,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    switch (name) {
      case "list_calendars": {
        const calendars = await service.listCalendars();
        return ok({ calendars });
      }

      case "list_events": {
        const calendar = args.calendar as string | undefined;
        const detailLevel = (args.detail_level as string) ?? "summary";

        let events: EventSummary[];
        if (calendar) {
          events = await service.listEvents(calendar, args.start as string, args.end as string);
        } else {
          const calendars = await service.listCalendars();
          events = [];
          for (const cal of calendars) {
            const calEvents = await service.listEvents(
              cal.calendar_id,
              args.start as string,
              args.end as string,
            );
            events.push(...calEvents);
          }
        }

        if (detailLevel === "full") {
          const fullEvents = [];
          for (const evt of events) {
            fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
          }
          return ok({ events: fullEvents });
        }
        return ok({ events });
      }

      case "get_today_events": {
        const calendar = args.calendar as string | undefined;
        const detailLevel = (args.detail_level as string) ?? "summary";
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const todayEnd = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
        ).toISOString();

        let events: EventSummary[];
        if (calendar) {
          events = await service.listEvents(calendar, todayStart, todayEnd);
        } else {
          const calendars = await service.listCalendars();
          events = [];
          for (const cal of calendars) {
            const calEvents = await service.listEvents(cal.calendar_id, todayStart, todayEnd);
            events.push(...calEvents);
          }
        }

        if (detailLevel === "full") {
          const fullEvents = [];
          for (const evt of events) {
            fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
          }
          return ok({ events: fullEvents });
        }
        return ok({ events });
      }

      case "search_events": {
        const query = (args.query as string).toLowerCase();
        const calendar = args.calendar as string | undefined;
        const detailLevel = (args.detail_level as string) ?? "summary";
        const now = new Date();
        const start =
          (args.start as string) ?? new Date(now.getTime() - 90 * 86400000).toISOString();
        const end = (args.end as string) ?? new Date(now.getTime() + 90 * 86400000).toISOString();

        let summaryEvents: EventSummary[];
        if (calendar) {
          summaryEvents = await service.listEvents(calendar, start, end);
        } else {
          const calendars = await service.listCalendars();
          summaryEvents = [];
          for (const cal of calendars) {
            const calEvents = await service.listEvents(cal.calendar_id, start, end);
            summaryEvents.push(...calEvents);
          }
        }

        if (detailLevel === "full") {
          const fullEvents = [];
          for (const evt of summaryEvents) {
            fullEvents.push(await service.getEvent(evt.calendar_id, evt.uid));
          }
          const matched = fullEvents.filter((e) => {
            const title = e.title?.toLowerCase() ?? "";
            const location = e.location?.toLowerCase() ?? "";
            const description = e.description?.toLowerCase() ?? "";
            return title.includes(query) || location.includes(query) || description.includes(query);
          });
          return ok({ events: matched });
        }

        const matched = summaryEvents.filter((e) => {
          const title = e.title?.toLowerCase() ?? "";
          const location = e.location?.toLowerCase() ?? "";
          return title.includes(query) || location.includes(query);
        });
        return ok({ events: matched });
      }

      case "get_event": {
        const event = await service.getEvent(args.calendar as string, args.uid as string);
        return ok({ event });
      }

      case "create_event": {
        const icsString = generateEventIcs({
          title: args.title as string,
          start: args.start as string,
          end: args.end as string,
          all_day: (args.all_day as boolean) ?? false,
          location: args.location as string | undefined,
          description: args.description as string | undefined,
          attendees: args.attendees as Array<{ email: string; name?: string }> | undefined,
          alarms: args.alarms as
            | Array<{ type: "relative" | "absolute"; trigger: number | string }>
            | undefined,
          categories: args.categories as string[] | undefined,
          timezone: getTimezone(),
        });
        const uidMatch = icsString.match(/UID:(.+)/);
        const uid = uidMatch ? uidMatch[1].trim() : crypto.randomUUID();
        const event = await service.createEvent(args.calendar as string, icsString, uid);
        return ok({ event });
      }

      case "update_event": {
        const span = (args.span as string) ?? "this";
        const { event: existing, meta } = await service.getEventWithMeta(
          args.calendar as string,
          args.uid as string,
        );

        if (existing.is_recurring && (span === "this" || span === "future")) {
          return error(
            "not_implemented",
            "Recurring event instance modification is not yet supported",
          );
        }

        const icsString = generateEventIcs({
          uid: args.uid as string,
          title: (args.title as string) ?? existing.title,
          start: (args.start as string) ?? existing.start,
          end: (args.end as string) ?? existing.end,
          all_day: (args.all_day as boolean) ?? existing.all_day,
          location: (args.location as string) ?? existing.location ?? undefined,
          description: (args.description as string) ?? existing.description ?? undefined,
          attendees:
            (args.attendees as Array<{ email: string; name?: string }> | undefined) ??
            existing.attendees?.map((a: { email: string; name?: string | null }) => ({
              email: a.email,
              name: a.name ?? undefined,
            })),
          alarms:
            (args.alarms as
              | Array<{ type: "relative" | "absolute"; trigger: number | string }>
              | undefined) ??
            existing.alarms?.map((a: any) => ({ type: a.type, trigger: a.trigger })),
          categories: (args.categories as string[] | undefined) ?? existing.categories,
          timezone: getTimezone(),
        });
        const event = await service.updateEvent(
          args.calendar as string,
          args.uid as string,
          icsString,
          meta,
        );
        return ok({ event });
      }

      case "delete_event": {
        const span = (args.span as string) ?? "all";
        let meta: CalendarObjectMeta | undefined;
        if (span === "this" || span === "future") {
          const result = await service.getEventWithMeta(
            args.calendar as string,
            args.uid as string,
          );
          if (result.event.is_recurring) {
            return error(
              "not_implemented",
              "Recurring event instance deletion is not yet supported",
            );
          }
          meta = result.meta;
        }
        await service.deleteEvent(args.calendar as string, args.uid as string, meta);
        return ok({ deleted: true, uid: args.uid });
      }

      case "create_events_batch": {
        const eventInputs = args.events as Array<{
          title: string;
          start: string;
          end: string;
          all_day?: boolean;
          location?: string;
          description?: string;
          attendees?: Array<{ email: string; name?: string }>;
          alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
          categories?: string[];
        }>;
        const createdEvents = [];
        for (const input of eventInputs) {
          const icsString = generateEventIcs({ ...input, timezone: getTimezone() });
          const uidMatch = icsString.match(/UID:(.+)/);
          const uid = uidMatch ? uidMatch[1].trim() : crypto.randomUUID();
          const event = await service.createEvent(args.calendar as string, icsString, uid);
          createdEvents.push(event);
        }
        return ok({ created: createdEvents.length, events: createdEvents });
      }

      case "import_ics": {
        const icsContent = args.ics_content as string;
        const parsed = parseIcsEvents(icsContent);
        if (parsed.length === 0) {
          return error("validation_error", "No events found in ICS content");
        }
        await service.createEvent(args.calendar as string, icsContent, parsed[0].uid);
        const importedEvents = [];
        for (const evt of parsed) {
          try {
            const event = await service.getEvent(args.calendar as string, evt.uid);
            importedEvents.push(event);
          } catch {
            // Event may not be fetchable individually if multi-event ICS — skip
          }
        }
        return ok({ imported: parsed.length, events: importedEvents });
      }

      case "find_free_slots": {
        let calendarIds = args.calendars as string[] | undefined;
        if (!calendarIds || calendarIds.length === 0) {
          const allCals = await service.listCalendars();
          calendarIds = allCals.map((c: { calendar_id: string }) => c.calendar_id);
        }
        const slots = await service.findFreeSlots(
          calendarIds,
          args.start as string,
          args.end as string,
          args.duration as number,
          {
            preferredStart: args.preferred_start as string | undefined,
            preferredEnd: args.preferred_end as string | undefined,
            ignoreTentative: (args.ignore_tentative as boolean) ?? false,
            excludeCalendars: args.exclude_calendars as string[] | undefined,
            includeAllDayAsBusy: (args.include_all_day_as_busy as boolean) ?? false,
          },
        );
        return ok({ slots, count: slots.length });
      }

      default:
        return error("validation_error", `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const calErr = err as any;
      if (calErr.code === "CALENDAR_NOT_FOUND" || calErr.code === "EVENT_NOT_FOUND") {
        return error("not_found", calErr.message);
      }
    }
    const pimError = toPimError(err instanceof Error ? err : new Error(String(err)));
    return error("backend_error", pimError.message);
  }
}
