import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDavService } from "../services/TaskDavService.js";

vi.mock("tsdav", () => {
  const mockClient = {
    login: vi.fn().mockResolvedValue(undefined),
    fetchCalendars: vi.fn().mockResolvedValue([
      {
        displayName: "Reminders",
        url: "/caldav/reminders/",
        ctag: "ctag-1",
        calendarColor: "#ff0000",
        components: ["VTODO"],
      },
      {
        displayName: "Work",
        url: "/caldav/work/",
        ctag: "ctag-2",
        components: ["VEVENT"],
      },
    ]),
    fetchCalendarObjects: vi.fn().mockResolvedValue([]),
    createCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
    updateCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
    deleteCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
    propfind: vi.fn().mockResolvedValue([]),
  };
  return {
    DAVClient: vi.fn().mockImplementation(() => mockClient),
    __mockClient: mockClient,
  };
});

const TEST_CONFIG = {
  accounts: [
    {
      id: "icloud",
      url: "https://caldav.example.com/",
      username: "user@example.com",
      password: "secret",
    },
  ],
};

describe("TaskDavService", () => {
  let service: TaskDavService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaskDavService(TEST_CONFIG);
  });

  it("lists only VTODO-capable task lists", async () => {
    const lists = await service.listTaskLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].task_list_id).toBe("icloud/Reminders");
    expect(lists[0].display_name).toBe("Reminders");
  });

  it("lists tasks from a VTODO calendar", async () => {
    const { __mockClient } = (await import("tsdav")) as any;
    __mockClient.fetchCalendarObjects.mockResolvedValue([
      {
        data: "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:todo-1\nSUMMARY:Buy milk\nSTATUS:NEEDS-ACTION\nEND:VTODO\nEND:VCALENDAR",
        url: "/caldav/reminders/todo-1.ics",
        etag: '"t1"',
      },
    ]);

    const tasks = await service.listTasks("icloud/Reminders");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].uid).toBe("todo-1");
    expect(tasks[0].title).toBe("Buy milk");
  });

  it("gets a single task with meta via UID lookup", async () => {
    const { __mockClient } = (await import("tsdav")) as any;
    __mockClient.fetchCalendarObjects
      .mockResolvedValueOnce([
        {
          data: "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:todo-2\nSUMMARY:Call bank\nEND:VTODO\nEND:VCALENDAR",
          url: "/caldav/reminders/todo-2.ics",
          etag: '"t2"',
        },
      ])
      .mockResolvedValueOnce([
        {
          data: "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:todo-2\nSUMMARY:Call bank\nEND:VTODO\nEND:VCALENDAR",
          url: "/caldav/reminders/todo-2.ics",
          etag: '"t2"',
        },
      ]);

    const result = await service.getTaskWithMeta("icloud/Reminders", "todo-2");
    expect(result.task.uid).toBe("todo-2");
    expect(result.meta.url).toContain("todo-2.ics");
  });
});
