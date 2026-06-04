import { randomUUID } from "node:crypto";
import { getTimezone, toPimError } from "@miguelarios/pim-core";
import { generateTodoIcs } from "@miguelarios/pim-core/ics";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { TaskDavService, TaskFull, TaskSummary } from "../services/TaskDavService.js";

async function fetchTasks(
  service: TaskDavService,
  taskListId: string | undefined,
  detailLevel: string,
  includeCompleted: boolean,
): Promise<TaskSummary[] | TaskFull[]> {
  const full = detailLevel === "full";
  if (taskListId) {
    const tasks = await service.listTasks(taskListId, { includeCompleted });
    return full
      ? await Promise.all(tasks.map((task) => service.getTask(taskListId, task.uid)))
      : tasks;
  }
  const lists = await service.listTaskLists();
  const tasks = await Promise.all(
    lists.map(async (list) => {
      const entries = await service.listTasks(list.task_list_id, { includeCompleted });
      return full
        ? await Promise.all(entries.map((task) => service.getTask(list.task_list_id, task.uid)))
        : entries;
    }),
  );
  return tasks.flat();
}

export const TASK_TOOLS: Tool[] = [
  {
    name: "list_task_lists",
    description: "List all CalDAV task lists that support VTODO across all configured providers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List tasks from one task list or all configured task lists.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: {
          type: "string",
          description:
            "Provider-prefixed task list ID (e.g., icloud/Reminders). If omitted, queries all task lists.",
        },
        detail_level: {
          type: "string",
          enum: ["summary", "full"],
          description: "Response verbosity (default: summary)",
        },
        include_completed: {
          type: "boolean",
          description: "Include completed tasks. Defaults to false.",
        },
      },
    },
  },
  {
    name: "get_task",
    description: "Get full details of a single task by task list and UID.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: { type: "string", description: "Provider-prefixed task list ID" },
        uid: { type: "string", description: "Task UID" },
      },
      required: ["task_list", "uid"],
    },
  },
  {
    name: "create_task",
    description: "Create a new CalDAV VTODO task.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: { type: "string", description: "Provider-prefixed task list ID" },
        title: { type: "string", description: "Task title" },
        due: { type: "string", description: "Due date/time (ISO 8601)" },
        description: { type: "string", description: "Task description" },
        status: {
          type: "string",
          enum: ["needs-action", "in-process", "completed", "cancelled"],
          description: "Initial task status",
        },
        percent_complete: { type: "number", description: "Completion percent (0-100)" },
        priority: { type: "number", description: "Priority (1-9)" },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Task categories/tags",
        },
        alarms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["relative", "absolute"] },
              trigger: { type: ["string", "number"] },
            },
            required: ["type", "trigger"],
          },
        },
        recurrence_rule: {
          type: "string",
          description: "RFC 5545 RRULE string for recurring tasks.",
        },
      },
      required: ["task_list", "title"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: { type: "string", description: "Provider-prefixed task list ID" },
        uid: { type: "string", description: "Task UID" },
        title: { type: "string", description: "Task title" },
        due: { type: "string", description: "Due date/time (ISO 8601)" },
        description: { type: "string", description: "Task description" },
        status: {
          type: "string",
          enum: ["needs-action", "in-process", "completed", "cancelled"],
          description: "Task status",
        },
        completed: {
          type: "string",
          description: "Completion timestamp (ISO 8601). Usually used with status=completed.",
        },
        percent_complete: { type: "number", description: "Completion percent (0-100)" },
        priority: { type: "number", description: "Priority (1-9)" },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Task categories/tags",
        },
        alarms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["relative", "absolute"] },
              trigger: { type: ["string", "number"] },
            },
            required: ["type", "trigger"],
          },
        },
        recurrence_rule: {
          type: "string",
          description: "RFC 5545 RRULE string for recurring tasks.",
        },
      },
      required: ["task_list", "uid"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task complete by setting STATUS=COMPLETED and PERCENT-COMPLETE=100.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: { type: "string", description: "Provider-prefixed task list ID" },
        uid: { type: "string", description: "Task UID" },
      },
      required: ["task_list", "uid"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task by UID.",
    inputSchema: {
      type: "object",
      properties: {
        task_list: { type: "string", description: "Provider-prefixed task list ID" },
        uid: { type: "string", description: "Task UID" },
      },
      required: ["task_list", "uid"],
    },
  },
];

function ok(payload: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function error(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}

export async function handleTaskTool(
  name: string,
  args: Record<string, unknown>,
  service: TaskDavService,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "list_task_lists": {
        const task_lists = await service.listTaskLists();
        return ok({ task_lists });
      }

      case "list_tasks": {
        const tasks = await fetchTasks(
          service,
          args.task_list as string | undefined,
          (args.detail_level as string) ?? "summary",
          (args.include_completed as boolean) ?? false,
        );
        return ok({ tasks });
      }

      case "get_task": {
        const task = await service.getTask(args.task_list as string, args.uid as string);
        return ok({ task });
      }

      case "create_task": {
        try {
          const icsString = generateTodoIcs({
            uid: randomUUID(),
            title: args.title as string,
            due: args.due as string | undefined,
            description: args.description as string | undefined,
            status: args.status as
              | "needs-action"
              | "in-process"
              | "completed"
              | "cancelled"
              | undefined,
            percent_complete: args.percent_complete as number | undefined,
            priority: args.priority as number | undefined,
            categories: args.categories as string[] | undefined,
            alarms: args.alarms as
              | Array<{ type: "relative" | "absolute"; trigger: number | string }>
              | undefined,
            recurrence_rule: args.recurrence_rule as string | undefined,
            timezone: getTimezone(),
          });
          const uidMatch = icsString.match(/UID:(.+)/);
          const uid = uidMatch ? uidMatch[1].trim() : randomUUID();
          const task = await service.createTask(args.task_list as string, icsString, uid);
          return ok({ task });
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Invalid recurrence_rule:")) {
            return error("validation_error", err.message);
          }
          throw err;
        }
      }

      case "update_task": {
        const { task: existing, meta } = await service.getTaskWithMeta(
          args.task_list as string,
          args.uid as string,
        );
        const nextStatus =
          (args.status as "needs-action" | "in-process" | "completed" | "cancelled" | undefined) ??
          (existing.status as "needs-action" | "in-process" | "completed" | "cancelled" | null) ??
          "needs-action";
        const nextPercent =
          (args.percent_complete as number | undefined) ?? existing.percent_complete ?? undefined;
        const completed =
          args.completed !== undefined
            ? (args.completed as string)
            : nextStatus === "completed"
              ? (existing.completed ?? new Date().toISOString())
              : undefined;
        try {
          const icsString = generateTodoIcs({
            uid: args.uid as string,
            title: (args.title as string | undefined) ?? existing.title,
            due: (args.due as string | undefined) ?? existing.due ?? undefined,
            description:
              (args.description as string | undefined) ?? existing.description ?? undefined,
            status: nextStatus,
            completed,
            percent_complete: nextPercent,
            priority: (args.priority as number | undefined) ?? existing.priority ?? undefined,
            categories: (args.categories as string[] | undefined) ?? existing.categories,
            alarms:
              (args.alarms as
                | Array<{ type: "relative" | "absolute"; trigger: number | string }>
                | undefined) ??
              existing.alarms.map((alarm) => ({ type: alarm.type, trigger: alarm.trigger })),
            recurrence_rule:
              (args.recurrence_rule as string | undefined) ?? existing.recurrence_rule ?? undefined,
            timezone: getTimezone(),
          });
          const task = await service.updateTask(
            args.task_list as string,
            args.uid as string,
            icsString,
            meta,
          );
          return ok({ task });
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Invalid recurrence_rule:")) {
            return error("validation_error", err.message);
          }
          throw err;
        }
      }

      case "complete_task": {
        const { task: existing, meta } = await service.getTaskWithMeta(
          args.task_list as string,
          args.uid as string,
        );
        const icsString = generateTodoIcs({
          uid: existing.uid,
          title: existing.title,
          due: existing.due ?? undefined,
          description: existing.description ?? undefined,
          status: "completed",
          completed: new Date().toISOString(),
          percent_complete: 100,
          priority: existing.priority ?? undefined,
          categories: existing.categories,
          alarms: existing.alarms.map((alarm) => ({ type: alarm.type, trigger: alarm.trigger })),
          recurrence_rule: existing.recurrence_rule ?? undefined,
          timezone: getTimezone(),
        });
        const task = await service.updateTask(
          args.task_list as string,
          args.uid as string,
          icsString,
          meta,
        );
        return ok({ task });
      }

      case "delete_task": {
        await service.deleteTask(args.task_list as string, args.uid as string);
        return ok({ deleted: true, uid: args.uid });
      }

      default:
        return error("validation_error", `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const taskErr = err as any;
      if (taskErr.code === "CALENDAR_NOT_FOUND" || taskErr.code === "EVENT_NOT_FOUND") {
        return error("not_found", taskErr.message);
      }
    }
    const pimError = toPimError(err instanceof Error ? err : new Error(String(err)));
    return error("backend_error", pimError.message);
  }
}
