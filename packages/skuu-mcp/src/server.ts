// SPDX-License-Identifier: AGPL-3.0-only

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSkuuTools } from "./register-tools";

export function createSkuuMcpServer(): McpServer {
  const server = new McpServer({
    name: "skuuos-readonly",
    version: "0.1.0"
  });
  registerSkuuTools(server);
  return server;
}
