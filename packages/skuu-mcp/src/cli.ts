// SPDX-License-Identifier: AGPL-3.0-only

import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSkuuMcpServer } from "./server";

const useHttp = process.argv.includes("--http");
const host = process.env.SKUUOS_MCP_HTTP_HOST ?? "127.0.0.1";
const port = Number(process.env.SKUUOS_MCP_HTTP_PORT ?? "3847");
const token = process.env.SKUUOS_MCP_HTTP_TOKEN;

async function main() {
  const server = createSkuuMcpServer();

  if (useHttp) {
    if (!token) {
      // biome-ignore lint/suspicious/noConsole: MCP CLI startup diagnostics on stderr
      console.error("SKUUOS_MCP_HTTP_TOKEN is required for HTTP transport.");
      process.exit(1);
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await server.connect(transport);

    createHttpServer((req, res) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      transport.handleRequest(req, res);
    }).listen(port, host, () => {
      // biome-ignore lint/suspicious/noConsole: MCP CLI startup diagnostics on stderr
      console.error(`SkuuOS MCP (read-only) http://${host}:${port}/mcp`);
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: MCP CLI fatal error on stderr
  console.error(err);
  process.exit(1);
});
