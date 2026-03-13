import ical from "ical-generator";
import * as nodeIcal from "node-ical";

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
  }>;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  is_recurring: boolean;
}

export interface EventCreateProps {
  title: string;
  start: string;
  end: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  attendees?: Array<{ email: string; name?: string }>;
}

export function parseIcsEvents(icsContent: string): ParsedEvent[] {
  if (!icsContent.trim()) return [];

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
    }> = [];
    if (vevent.attendee) {
      const attendeeList = Array.isArray(vevent.attendee) ? vevent.attendee : [vevent.attendee];
      for (const att of attendeeList) {
        const email =
          typeof att === "string"
            ? att.replace("mailto:", "")
            : (att.val || "").replace("mailto:", "");
        const name = typeof att === "string" ? null : (att.params?.CN ?? null);
        attendees.push({ email, name, status: null, role: null });
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

    events.push({
      uid: vevent.uid || "",
      title: vevent.summary || "",
      start: vevent.start ? new Date(vevent.start).toISOString() : "",
      end: vevent.end ? new Date(vevent.end).toISOString() : "",
      all_day: allDay,
      location: vevent.location ?? null,
      description: vevent.description ?? null,
      status: vevent.status ? vevent.status.toLowerCase() : null,
      availability,
      url: (vevent as any).url ?? null,
      attendees: attendees.length > 0 ? attendees : [],
      organizer: organizer ?? null,
      recurrence_rule: vevent.rrule?.toString() ?? null,
      created: vevent.created ? new Date(vevent.created).toISOString() : null,
      last_modified: vevent.lastmodified ? new Date(vevent.lastmodified).toISOString() : null,
      is_recurring: !!vevent.rrule,
    });
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

  if (props.attendees) {
    for (const att of props.attendees) {
      event.createAttendee({ email: att.email, name: att.name });
    }
  }

  return calendar.toString();
}
