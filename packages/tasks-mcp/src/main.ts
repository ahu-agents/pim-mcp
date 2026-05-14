import { loadCalDavConfig } from "@miguelarios/pim-core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TaskDavService } from "./services/TaskDavService.js";
import { TASK_TOOLS, handleTaskTool } from "./tools/taskTools.js";

export async function createServer(): Promise<Server> {
  const config = loadCalDavConfig();
  const service = new TaskDavService(config);

  const server = new Server(
    { name: "@miguelarios/tasks-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TASK_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTaskTool(name, (args ?? {}) as Record<string, unknown>, service);
  });

  const handleShutdown = async () => {
    process.exit(0);
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  server.onerror = (error) => {
    console.error("[tasks-mcp] Server error:", error.message);
  };

  return server;
}

export async function startServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[tasks-mcp] Server started on stdio");
}
