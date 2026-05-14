import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_TOOLS, handleTaskTool } from "../tools/taskTools.js";

const mockService = {
  listTaskLists: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  getTaskWithMeta: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
};

describe("taskTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the expected tool definitions", () => {
    expect(TASK_TOOLS.map((tool) => tool.name)).toEqual([
      "list_task_lists",
      "list_tasks",
      "get_task",
      "create_task",
      "update_task",
      "complete_task",
      "delete_task",
    ]);
  });

  it("list_task_lists wraps in { task_lists }", async () => {
    mockService.listTaskLists.mockResolvedValue([{ task_list_id: "icloud/Reminders" }]);
    const result = await handleTaskTool("list_task_lists", {}, mockService as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task_lists).toHaveLength(1);
  });

  it("list_tasks wraps in { tasks }", async () => {
    mockService.listTasks.mockResolvedValue([{ uid: "todo-1", title: "Buy milk" }]);
    const result = await handleTaskTool(
      "list_tasks",
      { task_list: "icloud/Reminders" },
      mockService as any,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tasks[0].uid).toBe("todo-1");
  });

  it("create_task returns { task }", async () => {
    mockService.createTask.mockResolvedValue({ uid: "todo-2", title: "Pay bill" });
    const result = await handleTaskTool(
      "create_task",
      { task_list: "icloud/Reminders", title: "Pay bill" },
      mockService as any,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task.uid).toBe("todo-2");
  });

  it("complete_task marks a task done via updateTask", async () => {
    mockService.getTaskWithMeta.mockResolvedValue({
      task: {
        uid: "todo-3",
        title: "Send report",
        due: null,
        description: null,
        priority: null,
        categories: [],
        alarms: [],
        recurrence_rule: null,
      },
      meta: { url: "/caldav/reminders/todo-3.ics", etag: '"t3"' },
    });
    mockService.updateTask.mockResolvedValue({ uid: "todo-3", status: "completed" });

    const result = await handleTaskTool(
      "complete_task",
      { task_list: "icloud/Reminders", uid: "todo-3" },
      mockService as any,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task.status).toBe("completed");
    expect(mockService.updateTask).toHaveBeenCalled();
  });

  it("delete_task returns { deleted, uid }", async () => {
    mockService.deleteTask.mockResolvedValue(undefined);
    const result = await handleTaskTool(
      "delete_task",
      { task_list: "icloud/Reminders", uid: "todo-4" },
      mockService as any,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.deleted).toBe(true);
    expect(parsed.uid).toBe("todo-4");
  });
});
