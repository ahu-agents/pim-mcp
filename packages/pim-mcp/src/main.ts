import { CalDavService } from "@miguelarios/cal-mcp/services/CalDavService";
import { CALENDAR_TOOLS, handleCalendarTool } from "@miguelarios/cal-mcp/tools";
import { disposeUrlCleaner } from "@miguelarios/email-mcp/htmlToMarkdown";
import { ImapService } from "@miguelarios/email-mcp/services/ImapService";
import { SmtpService } from "@miguelarios/email-mcp/services/SmtpService";
import { EMAIL_TOOLS, handleEmailTool } from "@miguelarios/email-mcp/tools";
import { loadCalDavConfig, loadEmailConfig } from "@miguelarios/pim-core";
import { TaskDavService } from "@miguelarios/tasks-mcp/services/TaskDavService";
import { TASK_TOOLS, handleTaskTool } from "@miguelarios/tasks-mcp/tools";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const PIM_MCP_VERSION = "0.1.0";

export const PIM_TOOLS = [...EMAIL_TOOLS, ...CALENDAR_TOOLS, ...TASK_TOOLS];

function assertUniqueToolNames(): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of PIM_TOOLS) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate PIM MCP tool names: ${Array.from(duplicates).join(", ")}`);
  }
}

export async function createServer(): Promise<Server> {
  assertUniqueToolNames();

  const emailConfig = loadEmailConfig();
  const calDavConfig = loadCalDavConfig();
  const imapService = new ImapService(emailConfig);
  const smtpService = new SmtpService(emailConfig);
  const calDavService = new CalDavService(calDavConfig);
  const taskDavService = new TaskDavService(calDavConfig);

  const emailToolNames = new Set(EMAIL_TOOLS.map((tool) => tool.name));
  const calendarToolNames = new Set(CALENDAR_TOOLS.map((tool) => tool.name));
  const taskToolNames = new Set(TASK_TOOLS.map((tool) => tool.name));

  const server = new Server(
    { name: "pim-mcp", version: PIM_MCP_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: PIM_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = (args ?? {}) as Record<string, unknown>;

    if (emailToolNames.has(name)) {
      return handleEmailTool(name, toolArgs, imapService, smtpService);
    }
    if (calendarToolNames.has(name)) {
      return handleCalendarTool(name, toolArgs, calDavService);
    }
    if (taskToolNames.has(name)) {
      return handleTaskTool(name, toolArgs, taskDavService);
    }
    throw new Error(`Unknown PIM MCP tool: ${name}`);
  });

  const handleShutdown = async () => {
    await disposeUrlCleaner();
    process.exit(0);
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  server.onerror = (error) => {
    console.error("[pim-mcp] Server error:", error.message);
  };

  return server;
}

export async function startServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[pim-mcp] Server started on stdio");
}
