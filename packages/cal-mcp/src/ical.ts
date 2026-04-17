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
  occurrence_date: string | null;
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

// node-ical + rrule store DTSTART as "wall-clock reinterpreted as UTC" and strip
// the TZID before passing to rrule. As a result, rrule.between() returns UTC
// timestamps that do not represent the correct moment of the wall-clock time in
// the original tzid, and the offset is also not DST-aware. We recompute UTC
// per-occurrence: take the wall-clock time-of-day from DTSTART (in tzid) and
// resolve it against each occurrence's date using Intl.
function getTzOffsetMs(instantMs: number, tzid: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(instantMs));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number.parseInt(m[2], 10);
  const mm = m[3] ? Number.parseInt(m[3], 10) : 0;
  return sign * (hh * 3600000 + mm * 60000);
}

function wallClockInTzToUtc(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tzid: string,
): Date {
  const guess = Date.UTC(year, month1 - 1, day, hour, minute, second);
  const offsetMs = getTzOffsetMs(guess, tzid);
  return new Date(guess - offsetMs);
}

function extractWallClockInTz(
  instant: Date,
  tzid: string,
): {
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const hourRaw = parts.hour === "24" ? "0" : parts.hour;
  return {
    hour: Number.parseInt(hourRaw, 10),
    minute: Number.parseInt(parts.minute, 10),
    second: Number.parseInt(parts.second, 10),
  };
}

function correctOccurrenceUtc(rawOcc: Date, dtstart: Date, tzid: string | undefined): Date {
  if (!tzid) return rawOcc;
  const wall = extractWallClockInTz(dtstart, tzid);
  return wallClockInTzToUtc(
    rawOcc.getUTCFullYear(),
    rawOcc.getUTCMonth() + 1,
    rawOcc.getUTCDate(),
    wall.hour,
    wall.minute,
    wall.second,
    tzid,
  );
}

// Extract the raw wall-clock time-of-day and tzid from a VEVENT's DTSTART line
// in the raw ICS, keyed by UID. This bypasses node-ical's TZID interpretation,
// which differs across Node builds/container tzdata and produces wrong UTC
// instants for recurring events when resolution fails silently.
export function extractDtstartWallClockFromIcs(
  icsContent: string,
  uid: string,
): { tzid?: string; hour: number; minute: number; second: number } | null {
  if (!icsContent || !uid) return null;
  // Unfold ICS line folding (RFC 5545: continuation lines start with space/tab)
  const unfolded = icsContent.replace(/\r?\n[ \t]/g, "");
  // Find each VEVENT block and match the one whose UID equals the target.
  // Escape regex metacharacters in uid for safety.
  const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const veventRe = /BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g;
  const uidLineRe = new RegExp(`^UID:${escapedUid}\\s*$`, "m");
  const blocks = unfolded.match(veventRe) ?? [];
  const block = blocks.find((b) => uidLineRe.test(b));
  if (!block) return null;
  // DTSTART line, with optional TZID param. Match only the first (master) DTSTART
  // — exception VEVENTs have RECURRENCE-ID but still just one DTSTART each.
  const m = block.match(
    /^DTSTART(?:;[^:\r\n]*?TZID=([^:;\r\n]+))?[^:\r\n]*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/m,
  );
  if (!m) return null;
  return {
    tzid: m[1],
    hour: Number.parseInt(m[5], 10),
    minute: Number.parseInt(m[6], 10),
    second: Number.parseInt(m[7], 10),
  };
}

// Extract EXDATE UTC instants from a VEVENT in the raw ICS, resolving each one
// through the same wallClockInTzToUtc pipeline as occurrence expansion so the
// returned millis align exactly with occurrence millis (enabling Set lookup).
// Handles: EXDATE with TZID, UTC (Z-suffixed), floating, VALUE=DATE (all-day),
// comma-separated values, and multiple EXDATE lines per VEVENT.
export function extractExdatesFromIcs(icsContent: string, uid: string): Set<number> {
  const result = new Set<number>();
  if (!icsContent || !uid) return result;
  const unfolded = icsContent.replace(/\r?\n[ \t]/g, "");
  const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const veventRe = /BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g;
  const uidLineRe = new RegExp(`^UID:${escapedUid}\\s*$`, "m");
  const blocks = unfolded.match(veventRe) ?? [];
  const block = blocks.find((b) => uidLineRe.test(b));
  if (!block) return result;

  const exdateLineRe = /^EXDATE(?:;([^:\r\n]+))?:([^\r\n]+)/gm;
  for (const match of block.matchAll(exdateLineRe)) {
    const paramsStr = match[1] ?? "";
    const valuesStr = match[2];
    const tzidMatch = paramsStr.match(/TZID=([^;]+)/);
    const isDateOnly = /VALUE=DATE(?!-TIME)/.test(paramsStr);
    const tzid = tzidMatch?.[1];

    for (const raw of valuesStr.split(",")) {
      const v = raw.trim();
      if (!v) continue;

      if (isDateOnly) {
        const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (!m) continue;
        // All-day: UTC midnight matches how node-ical/rrule represent all-day occurrences
        const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        result.add(ms);
        continue;
      }

      const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
      if (!m) continue;
      const [, y, mo, d, h, mi, s, z] = m;
      if (z === "Z") {
        result.add(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      } else if (tzid) {
        result.add(wallClockInTzToUtc(+y, +mo, +d, +h, +mi, +s, tzid).getTime());
      } else {
        // Floating time (no TZID, no Z) — treat wall-clock as UTC to match
        // rrule's internal representation. Rare in practice.
        result.add(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      }
    }
  }
  return result;
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
    const baseProps: Omit<ParsedEvent, "start" | "end" | "occurrence_date"> = {
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

      // Prefer the raw DTSTART from the ICS so TZID resolution is deterministic
      // across Node builds/container tzdata. Fall back to node-ical's parsed
      // tz only if the raw extraction fails (e.g., unusual ICS shape).
      const raw = extractDtstartWallClockFromIcs(icsContent, vevent.uid || "");
      const tzid = raw?.tzid ?? (vevent.start as unknown as { tz?: string }).tz;
      const exdateMs = extractExdatesFromIcs(icsContent, vevent.uid || "");

      const occurrences = vevent.rrule.between(
        new Date(range.start),
        new Date(range.end),
        true, // inclusive
      );

      for (const rawOcc of occurrences) {
        const occStart = raw?.tzid
          ? wallClockInTzToUtc(
              rawOcc.getUTCFullYear(),
              rawOcc.getUTCMonth() + 1,
              rawOcc.getUTCDate(),
              raw.hour,
              raw.minute,
              raw.second,
              raw.tzid,
            )
          : correctOccurrenceUtc(rawOcc, originalStart, tzid);
        // Skip cancelled occurrences (EXDATE). Compared on exact UTC millis
        // because EXDATEs are resolved through the same pipeline above.
        if (exdateMs.has(occStart.getTime())) continue;
        const occEnd = new Date(occStart.getTime() + duration);
        events.push({
          ...baseProps,
          start: formatTime(occStart.toISOString()),
          end: formatTime(occEnd.toISOString()),
          occurrence_date: formatTime(occStart.toISOString()),
        });
      }
    } else {
      // Non-recurring, or no range provided — return as-is
      // Detect RECURRENCE-ID for exception VEVENTs (node-ical exposes it as a Date)
      const recurrenceId = (vevent as any).recurrenceid;
      const occDate = recurrenceId ? formatTime(new Date(recurrenceId).toISOString()) : null;

      events.push({
        ...baseProps,
        start: vevent.start ? formatTime(new Date(vevent.start).toISOString()) : "",
        end: vevent.end ? formatTime(new Date(vevent.end).toISOString()) : "",
        occurrence_date: occDate,
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

export function createExceptionVevent(
  masterIcs: string,
  occurrenceDate: string,
  overrides: {
    title?: string;
    start?: string;
    end?: string;
    all_day?: boolean;
    location?: string;
    description?: string;
    attendees?: Array<{ email: string; name?: string }>;
    alarms?: Array<{ type: "relative" | "absolute"; trigger: number | string }>;
    categories?: string[];
  },
  allDay: boolean,
): string {
  // Parse master to extract base properties
  const masterEvents = parseIcsEvents(masterIcs);
  const master = masterEvents[0];
  if (!master) throw new Error("Could not parse master event from ICS");

  const uid = master.uid;
  const date = new Date(occurrenceDate);

  // Format dates for iCal
  const formatIcalDate = (iso: string, isAllDay: boolean): string => {
    const d = new Date(iso);
    if (isAllDay) return d.toISOString().slice(0, 10).replace(/-/g, "");
    return d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  };

  // Determine effective values (override or inherit)
  const title = overrides.title ?? master.title;
  const location = overrides.location ?? master.location;
  const description = overrides.description ?? master.description;
  const isAllDay = overrides.all_day ?? allDay;

  // For start/end: default to the occurrence's original time (not master's DTSTART)
  const occDuration = new Date(master.end).getTime() - new Date(master.start).getTime();
  const defaultStart = occurrenceDate;
  const defaultEnd = new Date(date.getTime() + occDuration).toISOString();
  const effectiveStart = overrides.start ?? defaultStart;
  const effectiveEnd = overrides.end ?? defaultEnd;

  // Build RECURRENCE-ID line
  const recurrenceId = isAllDay
    ? `RECURRENCE-ID;VALUE=DATE:${formatIcalDate(occurrenceDate, true)}`
    : `RECURRENCE-ID:${formatIcalDate(occurrenceDate, false)}`;

  // Build DTSTART/DTEND lines
  const dtstart = isAllDay
    ? `DTSTART;VALUE=DATE:${formatIcalDate(effectiveStart, true)}`
    : `DTSTART:${formatIcalDate(effectiveStart, false)}`;
  const dtend = isAllDay
    ? `DTEND;VALUE=DATE:${formatIcalDate(effectiveEnd, true)}`
    : `DTEND:${formatIcalDate(effectiveEnd, false)}`;

  // Extract SEQUENCE from master (default 0), increment
  const seqMatch = masterIcs.match(/SEQUENCE:(\d+)/);
  const sequence = (seqMatch ? Number.parseInt(seqMatch[1], 10) : 0) + 1;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    recurrenceId,
    dtstart,
    dtend,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${title}`,
  ];

  if (location) lines.push(`LOCATION:${location}`);
  if (description) lines.push(`DESCRIPTION:${description}`);

  // Attendees
  const attendees = overrides.attendees ?? master.attendees;
  if (attendees) {
    for (const att of attendees) {
      const cn = att.name ? `;CN=${att.name}` : "";
      lines.push(`ATTENDEE${cn}:mailto:${att.email}`);
    }
  }

  // Categories
  const categories = overrides.categories ?? master.categories;
  if (categories && categories.length > 0) {
    lines.push(`CATEGORIES:${categories.join(",")}`);
  }

  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");

  return lines.join("\r\n");
}

export function combineIcsComponents(masterIcs: string, exceptionVevent: string): string {
  let ics = masterIcs;

  // Extract RECURRENCE-ID from the new exception to find existing match
  const recIdMatch = exceptionVevent.match(/RECURRENCE-ID[^:]*:(.+)/);
  if (recIdMatch) {
    const recIdValue = recIdMatch[1].trim();
    // Remove any existing exception VEVENT with the same RECURRENCE-ID
    // Match from BEGIN:VEVENT through END:VEVENT that contains this RECURRENCE-ID
    const regex = new RegExp(
      `BEGIN:VEVENT\\r?\\n(?:(?!BEGIN:VEVENT)[\\s\\S])*?RECURRENCE-ID[^:]*:${recIdValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?END:VEVENT\\r?\\n?`,
    );
    ics = ics.replace(regex, "");
  }

  // Insert exception VEVENT before END:VCALENDAR
  return ics.replace("END:VCALENDAR", `${exceptionVevent}\r\nEND:VCALENDAR`);
}

export function addExdateToIcs(
  icsContent: string,
  occurrenceDate: string,
  allDay: boolean,
): string {
  // Format the EXDATE value
  const date = new Date(occurrenceDate);
  let exdateLine: string;
  if (allDay) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    exdateLine = `EXDATE;VALUE=DATE:${dateStr}`;
  } else {
    const dtStr = date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    exdateLine = `EXDATE:${dtStr}`;
  }

  // Check for existing EXDATE with same date (idempotency)
  if (icsContent.includes(exdateLine)) {
    return icsContent;
  }

  // Insert before the first END:VEVENT
  return icsContent.replace("END:VEVENT", `${exdateLine}\r\nEND:VEVENT`);
}
