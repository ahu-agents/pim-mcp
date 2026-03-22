import {
  type CalDavAccount,
  type CalDavConfig,
  CalendarError,
  ErrorCode,
  formatInTimezone,
  getTimezone,
  toPimError,
} from "@miguelarios/pim-core";
import { DAVClient } from "tsdav";
import { type ParsedAlarm, type ParsedEvent, type TimeRange, parseIcsEvents } from "../ical.js";

export interface CalendarInfo {
  calendar_id: string;
  display_name: string;
  color: string | null;
  source: string;
  read_only: boolean;
  url: string;
  ctag?: string;
}

export interface EventSummary {
  uid: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  status: string | null;
  is_recurring: boolean;
}

export interface EventFull extends EventSummary {
  description: string | null;
  url: string | null;
  availability: string | null;
  attendees: Array<{
    name: string | null;
    email: string;
    status: string | null;
    role: string | null;
    type: string;
  }>;
  organizer: { name: string | null; email: string } | null;
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  alarms: ParsedAlarm[];
  categories: string[];
  geo: { latitude: number; longitude: number } | null;
}

export interface FreeSlot {
  start: string;
  end: string;
  duration: number;
}

export interface FindFreeSlotsOptions {
  ignoreTentative?: boolean;
  preferredStart?: string;
  preferredEnd?: string;
  excludeCalendars?: string[];
  includeAllDayAsBusy?: boolean;
}

export interface CalendarObjectMeta {
  url: string;
  etag?: string;
}

export class CalDavService {
  private accounts: Map<string, CalDavAccount>;
  private clients: Map<string, DAVClient> = new Map();
  private calendarsCache: Map<string, any[]> = new Map();
  private timezone: string;

  constructor(config: CalDavConfig) {
    this.accounts = new Map(config.accounts.map((a) => [a.id, a]));
    this.timezone = getTimezone();
  }

  private createClient(account: CalDavAccount): DAVClient {
    return new DAVClient({
      serverUrl: account.url,
      credentials: {
        username: account.username,
        password: account.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

  private async getClient(account: CalDavAccount): Promise<DAVClient> {
    const existing = this.clients.get(account.id);
    if (existing) return existing;

    const client = this.createClient(account);
    await client.login();
    this.clients.set(account.id, client);
    return client;
  }

  private resolveAccount(calendarId: string): {
    account: CalDavAccount;
    calendarName: string;
  } {
    const slashIndex = calendarId.indexOf("/");
    if (slashIndex === -1) {
      throw new CalendarError(
        `Invalid calendar ID "${calendarId}" — must be "provider/calendar"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    const providerId = calendarId.substring(0, slashIndex);
    const calendarName = calendarId.substring(slashIndex + 1);
    const account = this.accounts.get(providerId);
    if (!account) {
      throw new CalendarError(`Unknown provider "${providerId}"`, ErrorCode.CALENDAR_NOT_FOUND);
    }
    return { account, calendarName };
  }

  private async findCalendar(
    client: DAVClient,
    calendarName: string,
    providerId: string,
  ): Promise<any> {
    let calendars = this.calendarsCache.get(providerId);
    if (!calendars) {
      calendars = await client.fetchCalendars();
      this.calendarsCache.set(providerId, calendars);
    }
    const calendar = calendars.find(
      (c) => (typeof c.displayName === "string" ? c.displayName : "") === calendarName,
    );
    if (!calendar) {
      throw new CalendarError(
        `Calendar "${calendarName}" not found on provider "${providerId}"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    return calendar;
  }

  private async findCalendarObject(
    client: DAVClient,
    calendar: any,
    uid: string,
  ): Promise<{ url: string; etag?: string; data?: string }> {
    const objects = await client.fetchCalendarObjects({ calendar });
    for (const obj of objects) {
      if (!obj.data) continue;
      const events = parseIcsEvents(obj.data);
      if (events.some((e) => e.uid === uid)) {
        return obj as { url: string; etag?: string; data?: string };
      }
    }
    throw new CalendarError(`Event "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
  }

  private hasWritePrivilege(privileges: Array<Record<string, unknown>>): boolean {
    return privileges.some(
      (p) => p.write !== undefined || p["write-content"] !== undefined || p.bind !== undefined,
    );
  }

  private async fetchPrivileges(
    client: DAVClient,
    calendarUrl: string,
  ): Promise<boolean> {
    try {
      const responses = await (client as any).propfind({
        url: calendarUrl,
        props: {
          "d:current-user-privilege-set": {},
        },
        depth: "0",
      });
      const privSet = responses?.[0]?.props?.currentUserPrivilegeSet;
      if (!privSet) return true; // Default to writable
      const privileges = privSet.privilege;
      if (!privileges) return true;
      const privArray = Array.isArray(privileges) ? privileges : [privileges];
      return this.hasWritePrivilege(privArray);
    } catch {
      return true; // Default to writable on error
    }
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const allCalendars: CalendarInfo[] = [];

    for (const [providerId, account] of this.accounts) {
      try {
        const client = await this.getClient(account);
        const calendars = await client.fetchCalendars();
        this.calendarsCache.set(providerId, calendars);
        for (const cal of calendars) {
          const displayName = (typeof cal.displayName === "string" ? cal.displayName : "") || "";
          const canWrite = await this.fetchPrivileges(client, cal.url);
          allCalendars.push({
            calendar_id: `${providerId}/${displayName}`,
            display_name: displayName,
            color: (cal as any).calendarColor ?? null,
            source: providerId,
            read_only: !canWrite,
            url: cal.url,
            ctag: cal.ctag,
          });
        }
      } catch (error) {
        throw toPimError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return allCalendars;
  }

  async listEvents(calendarId: string, start: string, end: string): Promise<EventSummary[]> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);

      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start, end },
        expand: true,
      });

      const summaries: EventSummary[] = [];
      for (const obj of objects) {
        if (!obj.data) continue;
        const parsed = parseIcsEvents(obj.data, { start, end }, this.timezone);
        for (const event of parsed) {
          summaries.push({
            uid: event.uid,
            calendar_id: calendarId,
            title: event.title,
            start: event.start,
            end: event.end,
            all_day: event.all_day,
            location: event.location,
            status: event.status,
            is_recurring: event.is_recurring,
          });
        }
      }

      return summaries;
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getEvent(calendarId: string, uid: string): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const obj = await this.findCalendarObject(client, calendar, uid);
      const parsed = parseIcsEvents(obj.data!, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

      return this.toEventFull(event, calendarId);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getEventWithMeta(
    calendarId: string,
    uid: string,
  ): Promise<{ event: EventFull; meta: CalendarObjectMeta }> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const obj = await this.findCalendarObject(client, calendar, uid);
      const parsed = parseIcsEvents(obj.data!, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

      return {
        event: this.toEventFull(event, calendarId),
        meta: { url: obj.url, etag: obj.etag },
      };
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async createEvent(calendarId: string, icalString: string, uid: string): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const calendar = await this.findCalendar(client, calendarName, account.id);
      const response = await client.createCalendarObject({
        calendar,
        iCalString: icalString,
        filename: `${uid}.ics`,
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to create event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }

      const parsed = parseIcsEvents(icalString, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found in ICS`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

      return this.toEventFull(event, calendarId);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async updateEvent(
    calendarId: string,
    uid: string,
    icalString: string,
    meta?: CalendarObjectMeta,
  ): Promise<EventFull> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);
      const objUrl = meta?.url;
      const objEtag = meta?.etag;

      let url: string;
      let etag: string | undefined;
      if (objUrl) {
        url = objUrl;
        etag = objEtag;
      } else {
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const obj = await this.findCalendarObject(client, calendar, uid);
        url = obj.url;
        etag = obj.etag;
      }

      const response = await client.updateCalendarObject({
        calendarObject: { url, etag, data: icalString },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to update event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }

      const parsed = parseIcsEvents(icalString, undefined, this.timezone);
      const event = parsed.find((e) => e.uid === uid);
      if (!event) {
        throw new CalendarError(`Event "${uid}" not found in ICS`, ErrorCode.EVENT_NOT_FOUND, uid);
      }

      return this.toEventFull(event, calendarId);
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async deleteEvent(calendarId: string, uid: string, meta?: CalendarObjectMeta): Promise<void> {
    const { account, calendarName } = this.resolveAccount(calendarId);

    try {
      const client = await this.getClient(account);

      let url: string;
      let etag: string | undefined;
      if (meta?.url) {
        url = meta.url;
        etag = meta.etag;
      } else {
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const obj = await this.findCalendarObject(client, calendar, uid);
        url = obj.url;
        etag = obj.etag;
      }

      const response = await client.deleteCalendarObject({
        calendarObject: { url, etag },
      });
      if (!(response as any).ok) {
        throw new CalendarError(
          `Failed to delete event: ${(response as any).status} ${(response as any).statusText}`,
          ErrorCode.WRITE_FAILED,
          uid,
        );
      }
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      this.calendarsCache.delete(account.id);
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findFreeSlots(
    calendarIds: string[],
    start: string,
    end: string,
    durationMinutes: number,
    options: FindFreeSlotsOptions = {},
  ): Promise<FreeSlot[]> {
    // 1. Fetch all events across specified calendars
    const allEvents: Array<{
      start: string;
      end: string;
      status: string | null;
      availability: string | null;
      all_day: boolean;
      calendar_id: string;
    }> = [];

    for (const calendarId of calendarIds) {
      // Skip excluded calendars
      if (options.excludeCalendars?.includes(calendarId)) continue;

      try {
        const { account, calendarName } = this.resolveAccount(calendarId);
        const client = await this.getClient(account);
        const calendar = await this.findCalendar(client, calendarName, account.id);
        const objects = await client.fetchCalendarObjects({
          calendar,
          timeRange: { start, end },
          expand: true,
        });

        for (const obj of objects) {
          if (!obj.data) continue;
          const parsed = parseIcsEvents(obj.data, { start, end });
          for (const event of parsed) {
            allEvents.push({
              start: event.start,
              end: event.end,
              status: event.status,
              availability: event.availability,
              all_day: event.all_day,
              calendar_id: calendarId,
            });
          }
        }
      } catch (error) {
        if (error instanceof CalendarError) throw error;
        throw toPimError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // 2. Filter events — skip free, all-day (unless opted in), and optionally tentative
    const busyIntervals = allEvents.filter((e) => {
      // Skip all-day events unless includeAllDayAsBusy
      if (e.all_day && !options.includeAllDayAsBusy) return false;
      // Skip free events
      if (e.availability === "free") return false;
      // Skip tentative when ignoreTentative
      if (options.ignoreTentative && e.status === "tentative") return false;
      // Everything else blocks
      return true;
    });

    // 3. Merge overlapping busy intervals
    const sorted = busyIntervals
      .map((e) => ({
        start: new Date(e.start).getTime(),
        end: new Date(e.end).getTime(),
      }))
      .sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of sorted) {
      if (merged.length > 0 && interval.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }

    // 4. Find gaps >= durationMinutes
    const rangeStart = new Date(start).getTime();
    const rangeEnd = new Date(end).getTime();
    const durationMs = durationMinutes * 60 * 1000;

    const freeSlots: FreeSlot[] = [];
    let cursor = rangeStart;

    for (const busy of merged) {
      if (busy.start > cursor) {
        const gapMs = busy.start - cursor;
        if (gapMs >= durationMs) {
          freeSlots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(busy.start).toISOString(),
            duration: Math.round(gapMs / 60000),
          });
        }
      }
      cursor = Math.max(cursor, busy.end);
    }

    // Check final gap
    if (rangeEnd > cursor) {
      const gapMs = rangeEnd - cursor;
      if (gapMs >= durationMs) {
        freeSlots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(rangeEnd).toISOString(),
          duration: Math.round(gapMs / 60000),
        });
      }
    }

    // 5. Split and sort by preferred hours
    if (options.preferredStart && options.preferredEnd) {
      const [prefStartH, prefStartM] = options.preferredStart.split(":").map(Number);
      const [prefEndH, prefEndM] = options.preferredEnd.split(":").map(Number);
      const prefStartMinutes = prefStartH * 60 + prefStartM;
      const prefEndMinutes = prefEndH * 60 + prefEndM;

      // Split slots at preferred-hour boundaries so they can be reordered
      const splitSlots: FreeSlot[] = [];
      for (const slot of freeSlots) {
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);

        // Compute preferred boundary timestamps for each day the slot spans
        const dayStart = new Date(slotStart);
        dayStart.setUTCHours(0, 0, 0, 0);

        const boundaries: number[] = [];
        // Check current day and next day in case slot spans midnight
        for (let d = 0; d <= 1; d++) {
          const day = new Date(dayStart.getTime() + d * 86400000);
          const prefS = new Date(day);
          prefS.setUTCHours(prefStartH, prefStartM, 0, 0);
          const prefE = new Date(day);
          prefE.setUTCHours(prefEndH, prefEndM, 0, 0);
          if (prefS.getTime() > slotStart.getTime() && prefS.getTime() < slotEnd.getTime()) {
            boundaries.push(prefS.getTime());
          }
          if (prefE.getTime() > slotStart.getTime() && prefE.getTime() < slotEnd.getTime()) {
            boundaries.push(prefE.getTime());
          }
        }

        boundaries.sort((a, b) => a - b);

        // Split the slot at boundaries
        let splitCursor = slotStart.getTime();
        for (const boundary of boundaries) {
          if (boundary > splitCursor) {
            const dur = Math.round((boundary - splitCursor) / 60000);
            if (dur >= durationMinutes) {
              splitSlots.push({
                start: new Date(splitCursor).toISOString(),
                end: new Date(boundary).toISOString(),
                duration: dur,
              });
            }
            splitCursor = boundary;
          }
        }
        // Remainder
        if (slotEnd.getTime() > splitCursor) {
          const dur = Math.round((slotEnd.getTime() - splitCursor) / 60000);
          if (dur >= durationMinutes) {
            splitSlots.push({
              start: new Date(splitCursor).toISOString(),
              end: new Date(slotEnd.getTime()).toISOString(),
              duration: dur,
            });
          }
        }
      }

      // Sort: preferred-hours slots first, then chronologically
      splitSlots.sort((a, b) => {
        const aDate = new Date(a.start);
        const bDate = new Date(b.start);
        const aMinutes = aDate.getUTCHours() * 60 + aDate.getUTCMinutes();
        const bMinutes = bDate.getUTCHours() * 60 + bDate.getUTCMinutes();
        const aInPref = aMinutes >= prefStartMinutes && aMinutes < prefEndMinutes;
        const bInPref = bMinutes >= prefStartMinutes && bMinutes < prefEndMinutes;

        if (aInPref && !bInPref) return -1;
        if (!aInPref && bInPref) return 1;
        return aDate.getTime() - bDate.getTime();
      });

      return this.formatSlots(splitSlots);
    }

    return this.formatSlots(freeSlots);
  }

  private toEventFull(event: ParsedEvent, calendarId: string): EventFull {
    return {
      uid: event.uid,
      calendar_id: calendarId,
      title: event.title,
      start: event.start,
      end: event.end,
      all_day: event.all_day,
      location: event.location,
      status: event.status,
      is_recurring: event.is_recurring,
      description: event.description,
      url: event.url,
      availability: event.availability,
      attendees: event.attendees,
      organizer: event.organizer,
      recurrence_rule: event.recurrence_rule,
      created: event.created,
      last_modified: event.last_modified,
      alarms: event.alarms,
      categories: event.categories,
      geo: event.geo,
    };
  }

  private formatSlots(slots: FreeSlot[]): FreeSlot[] {
    return slots.map((s) => ({
      start: formatInTimezone(s.start, this.timezone),
      end: formatInTimezone(s.end, this.timezone),
      duration: s.duration,
    }));
  }
}
