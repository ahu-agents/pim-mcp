#!/usr/bin/env node
import { startServer } from "../main.js";

startServer().catch((error) => {
  console.error("[pim-mcp] Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
