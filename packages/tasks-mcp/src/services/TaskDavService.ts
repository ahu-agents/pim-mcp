import {
  type CalDavAccount,
  type CalDavConfig,
  CalendarError,
  ErrorCode,
  toPimError,
} from "@miguelarios/pim-core";
import { type ParsedAlarm, type ParsedTodo, parseIcsTodos } from "@miguelarios/pim-core/ics";
import { DAVClient } from "tsdav";

export interface TaskListInfo {
  task_list_id: string;
  display_name: string;
  color: string | null;
  source: string;
  read_only: boolean;
  url: string;
  ctag?: string;
}

export interface TaskSummary {
  uid: string;
  task_list_id: string;
  title: string;
  due: string | null;
  completed: string | null;
  status: string | null;
  percent_complete: number | null;
  priority: number | null;
}

export interface TaskFull extends TaskSummary {
  description: string | null;
  categories: string[];
  alarms: ParsedAlarm[];
  recurrence_rule: string | null;
  created: string | null;
  last_modified: string | null;
  occurrence_date: string | null;
}

export interface CalendarObjectMeta {
  url: string;
  etag?: string;
}

function buildCanonicalHref(calendarUrl: string, uid: string): string | null {
  if (!calendarUrl || !uid) return null;
  const filename = `${uid}.ics`;
  try {
    return new URL(filename, calendarUrl).href;
  } catch {
    const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
    return `${base}${filename}`;
  }
}

function toSummary(taskListId: string, todo: ParsedTodo): TaskSummary {
  return {
    uid: todo.uid,
    task_list_id: taskListId,
    title: todo.title,
    due: todo.due,
    completed: todo.completed,
    status: todo.status,
    percent_complete: todo.percent_complete,
    priority: todo.priority,
  };
}

function toFull(taskListId: string, todo: ParsedTodo): TaskFull {
  return {
    ...toSummary(taskListId, todo),
    description: todo.description,
    categories: todo.categories,
    alarms: todo.alarms,
    recurrence_rule: todo.recurrence_rule,
    created: todo.created,
    last_modified: todo.last_modified,
    occurrence_date: todo.occurrence_date,
  };
}

export class TaskDavService {
  private accounts: Map<string, CalDavAccount>;
  private clients: Map<string, DAVClient> = new Map();
  private calendarsCache: Map<string, any[]> = new Map();

  constructor(config: CalDavConfig) {
    this.accounts = new Map(config.accounts.map((a) => [a.id, a]));
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

  private resolveAccount(taskListId: string): { account: CalDavAccount; listName: string } {
    const slashIndex = taskListId.indexOf("/");
    if (slashIndex === -1) {
      throw new CalendarError(
        `Invalid task list ID "${taskListId}" — must be "provider/list"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    const providerId = taskListId.substring(0, slashIndex);
    const listName = taskListId.substring(slashIndex + 1);
    const account = this.accounts.get(providerId);
    if (!account) {
      throw new CalendarError(`Unknown provider "${providerId}"`, ErrorCode.CALENDAR_NOT_FOUND);
    }
    return { account, listName };
  }

  private async findCalendar(client: DAVClient, listName: string, providerId: string): Promise<any> {
    let calendars = this.calendarsCache.get(providerId);
    if (!calendars) {
      calendars = await client.fetchCalendars();
      this.calendarsCache.set(providerId, calendars);
    }
    const calendar = calendars.find(
      (c) => (typeof c.displayName === "string" ? c.displayName : "") === listName,
    );
    if (!calendar) {
      throw new CalendarError(
        `Task list "${listName}" not found on provider "${providerId}"`,
        ErrorCode.CALENDAR_NOT_FOUND,
      );
    }
    return calendar;
  }

  private hasWritePrivilege(privileges: Array<Record<string, unknown>>): boolean {
    return privileges.some(
      (p) => p.write !== undefined || p["write-content"] !== undefined || p.bind !== undefined,
    );
  }

  private async fetchPrivileges(client: DAVClient, calendarUrl: string): Promise<boolean> {
    try {
      const responses = await (client as any).propfind({
        url: calendarUrl,
        props: {
          "d:current-user-privilege-set": {},
        },
        depth: "0",
      });
      const privSet = responses?.[0]?.props?.currentUserPrivilegeSet;
      if (!privSet) return true;
      const privileges = privSet.privilege;
      if (!privileges) return true;
      const privArray = Array.isArray(privileges) ? privileges : [privileges];
      return this.hasWritePrivilege(privArray);
    } catch {
      return true;
    }
  }

  private async findTodoObject(
    client: DAVClient,
    calendar: any,
    uid: string,
  ): Promise<{ url: string; etag?: string; data?: string }> {
    const canonicalUrl = buildCanonicalHref((calendar as { url: string }).url, uid);
    if (canonicalUrl) {
      try {
        const probe = await client.fetchCalendarObjects({ calendar, objectUrls: [canonicalUrl] });
        for (const obj of probe) {
          if (!obj.data) continue;
          if (parseIcsTodos(obj.data).some((todo) => todo.uid === uid)) {
            return obj as { url: string; etag?: string; data?: string };
          }
        }
      } catch {
        // fall through
      }
    }

    const filtered = await client.fetchCalendarObjects({
      calendar,
      filters: {
        "comp-filter": {
          _attributes: { name: "VCALENDAR" },
          "comp-filter": {
            _attributes: { name: "VTODO" },
            "prop-filter": {
              _attributes: { name: "UID" },
              "text-match": { _text: uid },
            },
          },
        },
      },
    });
    for (const obj of filtered) {
      if (!obj.data) continue;
      if (parseIcsTodos(obj.data).some((todo) => todo.uid === uid)) {
        return obj as { url: string; etag?: string; data?: string };
      }
    }

    const all = await client.fetchCalendarObjects({
      calendar,
      filters: {
        "comp-filter": {
          _attributes: { name: "VCALENDAR" },
          "comp-filter": { _attributes: { name: "VTODO" } },
        },
      },
    });
    for (const obj of all) {
      if (!obj.data || !obj.data.includes(uid)) continue;
      if (parseIcsTodos(obj.data).some((todo) => todo.uid === uid)) {
        return obj as { url: string; etag?: string; data?: string };
      }
    }

    throw new CalendarError(`Task "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
  }

  async listTaskLists(): Promise<TaskListInfo[]> {
    const allTaskLists: TaskListInfo[] = [];

    for (const [providerId, account] of this.accounts) {
      const client = await this.getClient(account);
      const calendars = await client.fetchCalendars();
      this.calendarsCache.set(providerId, calendars);

      for (const cal of calendars) {
        const components = Array.isArray(cal.components) ? cal.components : [];
        if (!components.includes("VTODO")) continue;
        const readOnly = !(await this.fetchPrivileges(client, cal.url));
        const displayName = typeof cal.displayName === "string" ? cal.displayName : "";
        allTaskLists.push({
          task_list_id: `${providerId}/${displayName}`,
          display_name: displayName,
          color: cal.calendarColor ?? null,
          source: providerId,
          read_only: readOnly,
          url: cal.url,
          ctag: cal.ctag,
        });
      }
    }

    return allTaskLists;
  }

  async listTasks(taskListId: string, options: { includeCompleted?: boolean } = {}): Promise<TaskSummary[]> {
    const { account, listName } = this.resolveAccount(taskListId);
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, listName, account.id);
    try {
      const objects = await client.fetchCalendarObjects({
        calendar,
        filters: {
          "comp-filter": {
            _attributes: { name: "VCALENDAR" },
            "comp-filter": { _attributes: { name: "VTODO" } },
          },
        },
      });
      return objects
        .filter((obj) => obj.data)
        .flatMap((obj) => parseIcsTodos(obj.data!))
        .filter(
          (todo) =>
            options.includeCompleted ||
            (todo.status !== "completed" && todo.percent_complete !== 100 && !todo.completed),
        )
        .map((todo) => toSummary(taskListId, todo));
    } catch (error) {
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getTask(taskListId: string, uid: string): Promise<TaskFull> {
    const { task } = await this.getTaskWithMeta(taskListId, uid);
    return task;
  }

  async getTaskWithMeta(
    taskListId: string,
    uid: string,
  ): Promise<{ task: TaskFull; meta: CalendarObjectMeta; rawIcs: string }> {
    const { account, listName } = this.resolveAccount(taskListId);
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, listName, account.id);
    const obj = await this.findTodoObject(client, calendar, uid);
    const todo = parseIcsTodos(obj.data ?? "").find((entry) => entry.uid === uid);
    if (!todo) {
      throw new CalendarError(`Task "${uid}" not found`, ErrorCode.EVENT_NOT_FOUND, uid);
    }
    return {
      task: toFull(taskListId, todo),
      meta: { url: obj.url, etag: obj.etag },
      rawIcs: obj.data ?? "",
    };
  }

  async createTask(taskListId: string, icsString: string, uid: string): Promise<TaskFull> {
    const { account, listName } = this.resolveAccount(taskListId);
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, listName, account.id);
    try {
      const response = await client.createCalendarObject({
        calendar,
        iCalString: icsString,
        filename: `${uid}.ics`,
      });
      if (response && !(response as any).ok) {
        throw new Error(`Failed to create task: ${(response as any).statusText ?? "unknown error"}`);
      }
      return await this.getTask(taskListId, uid);
    } catch (error) {
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async updateTask(
    taskListId: string,
    uid: string,
    icsString: string,
    meta?: CalendarObjectMeta,
  ): Promise<TaskFull> {
    const { account, listName } = this.resolveAccount(taskListId);
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, listName, account.id);
    const target = meta ?? (await this.findTodoObject(client, calendar, uid));
    try {
      await client.updateCalendarObject({
        calendarObject: {
          url: target.url,
          etag: target.etag,
          data: icsString,
        },
      });
      return await this.getTask(taskListId, uid);
    } catch (error) {
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async deleteTask(taskListId: string, uid: string, meta?: CalendarObjectMeta): Promise<void> {
    const { account, listName } = this.resolveAccount(taskListId);
    const client = await this.getClient(account);
    const calendar = await this.findCalendar(client, listName, account.id);
    const target = meta ?? (await this.findTodoObject(client, calendar, uid));
    try {
      await client.deleteCalendarObject({
        calendarObject: {
          url: target.url,
          etag: target.etag,
        },
      });
    } catch (error) {
      throw toPimError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
