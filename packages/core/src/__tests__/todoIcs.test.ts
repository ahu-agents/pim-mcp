import { describe, expect, it } from "vitest";
import { generateTodoIcs, parseIcsTodos } from "../ics/index.js";

describe("generateTodoIcs", () => {
  it("round-trips a minimal VTODO with due date, alarms, and completion fields", () => {
    const ics = generateTodoIcs({
      uid: "todo-1",
      title: "Pay invoice",
      due: "2026-05-10T08:30:00Z",
      description: "May hosting",
      priority: 3,
      percent_complete: 50,
      categories: ["finance", "ops"],
      alarms: [{ type: "relative", trigger: -900 }],
    });

    const [todo] = parseIcsTodos(ics);
    expect(todo.uid).toBe("todo-1");
    expect(todo.title).toBe("Pay invoice");
    expect(todo.due).toBe("2026-05-10T08:30:00.000Z");
    expect(todo.description).toBe("May hosting");
    expect(todo.priority).toBe(3);
    expect(todo.percent_complete).toBe(50);
    expect(todo.categories).toEqual(["finance", "ops"]);
    expect(todo.alarms).toHaveLength(1);
  });

  it("writes completed status fields when present", () => {
    const ics = generateTodoIcs({
      uid: "todo-2",
      title: "Done task",
      status: "completed",
      completed: "2026-05-08T06:00:00Z",
      percent_complete: 100,
    });

    const [todo] = parseIcsTodos(ics);
    expect(todo.status).toBe("completed");
    expect(todo.completed).toBe("2026-05-08T06:00:00.000Z");
    expect(todo.percent_complete).toBe(100);
  });
});
