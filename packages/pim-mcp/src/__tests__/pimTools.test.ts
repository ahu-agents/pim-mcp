import { describe, expect, it } from "vitest";
import { EMAIL_TOOLS } from "@miguelarios/email-mcp/tools";
import { CALENDAR_TOOLS } from "@miguelarios/cal-mcp/tools";
import { TASK_TOOLS } from "@miguelarios/tasks-mcp/tools";
import { PIM_MCP_VERSION, PIM_TOOLS } from "../main.js";

describe("pim-mcp tool registry", () => {
  it("combines mail, calendar, and task tools without duplicate names", () => {
    const names = PIM_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("send_email");
    expect(names).toContain("move_event");
    expect(names).toContain("create_task");
    expect(PIM_TOOLS.length).toBe(EMAIL_TOOLS.length + CALENDAR_TOOLS.length + TASK_TOOLS.length);
  });

  it("uses a simple product name and explicit version", () => {
    expect(PIM_MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
