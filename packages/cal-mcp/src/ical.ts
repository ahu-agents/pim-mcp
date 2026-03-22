import { formatInTimezone } from "@miguelarios/pim-core";
import ical, { ICalAlarmType, ICalEventStatus } from "ical-generator";
import nodeIcal from "node-ical";

export interface ParsedAlarm {
  type: "relative" | "absolute";
  trigger: number | string;
  trigger_human: string;
}

export interface ParsedEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  status: string | null;
  availability: string | null;
  url: string | null;
  attendees: Array<{
    name: string | null;
    email: string;
    status: string | null;
    role: string | null;
    type: string;
  }>;
  categories: string[];
  geo: { latitude: number; longitude: number } | null;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  is_recurring: boolean;
  alarms: ParsedAlarm[];
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
  uid?: string;
  timezone?: string;
  alarms?: Array<{
    type: "relative" | "absolute";
    trigger: number | string;
  }>;
  categories?: string[];
}

const CUTYPE_MAP: Record<string, string> = {
  INDIVIDUAL: "person",
  ROOM: "room",
  RESOURCE: "resource",
  GROUP: "group",
};

function parseDurationToSeconds(duration: string): number {
  const negative = duration.startsWith("-");
  const match = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (!match) return 0;
  const days = Number.parseInt(match[1] || "0", 10);
  const hours = Number.parseInt(match[2] || "0", 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  const seconds = Number.parseInt(match[4] || "0", 10);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return negative ? -total : total;
}

function formatTriggerHuman(seconds: number): string {
  if (seconds === 0) return "At time of event";
  const abs = Math.abs(seconds);
  const suffix = seconds < 0 ? "before" : "after";
  const parts: string[] = [];
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (parts.length === 0) {
    const secs = abs;
    parts.push(`${secs} ${secs === 1 ? "second" : "seconds"}`);
  }
  return `${parts.join(", ")} ${suffix}`;
}

function parseAlarm(alarm: { trigger: unknown; action: string }): ParsedAlarm {
  const raw = alarm.trigger;

  // Absolute trigger: node-ical returns an object with params.VALUE = "DATE-TIME" and a val string
  if (raw !== null && typeof raw === "object") {
    const obj = raw as { params?: { VALUE?: string }; val?: string };
    const val = obj.val ?? "";
    const date = new Date(
      val.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, "$1-$2-$3T$4:$5:$6Z"),
    );
    return {
      type: "absolute",
      trigger: date.toISOString(),
      trigger_human: date.toISOString(),
    };
  }

  const trigger = String(raw);

  // Relative trigger: duration string like -PT15M
  const seconds = parseDurationToSeconds(trigger);
  return {
    type: "relative",
    trigger: seconds,
    trigger_human: formatTriggerHuman(seconds),
  };
}

export function parseIcsEvents(
  icsContent: string,
  range?: TimeRange,
  timezone?: string,
): ParsedEvent[] {
  if (!icsContent.trim()) return [];

  const formatTime = (isoString: string): string => {
    return timezone ? formatInTimezone(isoString, timezone) : isoString;
  };

  const parsed = nodeIcal.parseICS(icsContent);
  const events: ParsedEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (component.type !== "VEVENT") continue;
    const vevent = component as nodeIcal.VEvent;

    const attendees: Array<{
      name: string | null;
      email: string;
      status: string | null;
      role: string | null;
      type: string;
    }> = [];
    if (vevent.attendee) {
      const attendeeList = Array.isArray(vevent.attendee) ? vevent.attendee : [vevent.attendee];
      for (const att of attendeeList) {
        const email =
          typeof att === "string"
            ? att.replace("mailto:", "")
            : (att.val || "").replace("mailto:", "");
        const name = typeof att === "string" ? null : (att.params?.CN ?? null);
        const status =
          typeof att === "string" ? null : (att.params?.PARTSTAT?.toLowerCase() ?? null);
        const role = typeof att === "string" ? null : (att.params?.ROLE?.toLowerCase() ?? null);
        const cutype =
          typeof att === "string" ? "unknown" : (CUTYPE_MAP[att.params?.CUTYPE ?? ""] ?? "unknown");
        attendees.push({ email, name, status, role, type: cutype });
      }
    }

    let organizer: { name: string | null; email: string } | null = null;
    if (vevent.organizer) {
      const org = vevent.organizer;
      organizer = {
        email: (typeof org === "string" ? org : org.val || "").replace("mailto:", ""),
        name: typeof org === "string" ? null : (org.params?.CN ?? null),
      };
    }

    // Map transparency to availability
    const rawTransparency = vevent.transparency?.toUpperCase();
    let availability: string | null = null;
    if (rawTransparency === "OPAQUE") availability = "busy";
    else if (rawTransparency === "TRANSPARENT") availability = "free";

    // Detect all-day: node-ical sets datetype to "date" for VALUE=DATE
    const allDay = (vevent as any).datetype === "date";

    // Extract VALARM alarms
    const alarms: ParsedAlarm[] = [];
    if ((vevent as any).alarms) {
      for (const alarm of (vevent as any).alarms) {
        alarms.push(parseAlarm(alarm));
      }
    }

    // Parse CATEGORIES
    const rawCategories = (vevent as any).categories;
    let categories: string[] = [];
    if (rawCategories) {
      if (Array.isArray(rawCategories)) {
        categories = rawCategories.flatMap((c: string | string[]) => (Array.isArray(c) ? c : [c]));
      } else if (typeof rawCategories === "string") {
        categories = [rawCategories];
      }
    }

    // Parse GEO — node-ical silently coerces GEO:; (empty) to {lat:0, lon:0},
    // so reject the 0,0 sentinel to avoid false positives from malformed values.
    const rawGeo = vevent.geo;
    let geo: { latitude: number; longitude: number } | null = null;
    if (
      rawGeo &&
      typeof rawGeo.lat === "number" &&
      typeof rawGeo.lon === "number" &&
      !Number.isNaN(rawGeo.lat) &&
      !Number.isNaN(rawGeo.lon) &&
      (rawGeo.lat !== 0 || rawGeo.lon !== 0)
    ) {
      geo = { latitude: rawGeo.lat, longitude: rawGeo.lon };
    }

    // Build base properties shared by all occurrences
    const baseProps: Omit<ParsedEvent, "start" | "end"> = {
      uid: vevent.uid || "",
      title: vevent.summary || "",
      all_day: allDay,
      location: vevent.location ?? null,
      description: vevent.description ?? null,
      status: vevent.status ? vevent.status.toLowerCase() : null,
      availability,
      url: (vevent as any).url ?? null,
      attendees: attendees.length > 0 ? attendees : [],
      organizer: organizer ?? null,
      recurrence_rule: vevent.rrule?.toString() ?? null,
      created: vevent.created ? formatTime(new Date(vevent.created).toISOString()) : null,
      last_modified: vevent.lastmodified
        ? formatTime(new Date(vevent.lastmodified).toISOString())
        : null,
      is_recurring: !!vevent.rrule,
      alarms,
      categories,
      geo,
    };

    // Expand recurring events into occurrences within the requested range
    if (vevent.rrule && range && typeof vevent.rrule.between === "function") {
      const originalStart = new Date(vevent.start);
      const originalEnd = new Date(vevent.end);
      const duration = originalEnd.getTime() - originalStart.getTime();

      const occurrences = vevent.rrule.between(
        new Date(range.start),
        new Date(range.end),
        true, // inclusive
      );

      for (const occStart of occurrences) {
        const occEnd = new Date(occStart.getTime() + duration);
        events.push({
          ...baseProps,
          start: formatTime(occStart.toISOString()),
          end: formatTime(occEnd.toISOString()),
        });
      }
    } else {
      // Non-recurring, or no range provided — return as-is
      events.push({
        ...baseProps,
        start: vevent.start ? formatTime(new Date(vevent.start).toISOString()) : "",
        end: vevent.end ? formatTime(new Date(vevent.end).toISOString()) : "",
      });
    }
  }

  return events;
}

export function generateEventIcs(props: EventCreateProps): string {
  const calendar = ical({ name: "cal-mcp" });

  const eventOptions: Parameters<typeof calendar.createEvent>[0] = {
    start: new Date(props.start),
    end: new Date(props.end),
    summary: props.title,
  };
  if (props.all_day) eventOptions.allDay = true;
  if (props.location) eventOptions.location = props.location;
  if (props.description) eventOptions.description = props.description;

  const event = calendar.createEvent(eventOptions);
  event.status(ICalEventStatus.CONFIRMED);

  if (props.uid) {
    event.uid(props.uid);
  }

  if (props.timezone) {
    event.timezone(props.timezone);
  }

  if (props.attendees) {
    for (const att of props.attendees) {
      event.createAttendee({ email: att.email, name: att.name });
    }
  }

  if (props.alarms) {
    for (const alarm of props.alarms) {
      if (alarm.type === "relative" && typeof alarm.trigger === "number") {
        event.createAlarm({
          type: ICalAlarmType.display,
          triggerBefore: Math.abs(alarm.trigger),
        });
      } else if (alarm.type === "absolute" && typeof alarm.trigger === "string") {
        event.createAlarm({
          type: ICalAlarmType.display,
          trigger: new Date(alarm.trigger),
        });
      }
    }
  }

  let icsString = calendar.toString();

  if (props.categories && props.categories.length > 0) {
    const categoriesLine = `CATEGORIES:${props.categories.join(",")}`;
    icsString = icsString.replace("END:VEVENT", `${categoriesLine}\r\nEND:VEVENT`);
  }

  return icsString;
}
