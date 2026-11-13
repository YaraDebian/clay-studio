#!/usr/bin/env node
// Clay Studio local MCP server. The tools live in tools.mjs and are re-imported whenever that file changes,
// so edits take effect without restarting the Claude app.
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_FILE = join(dirname(fileURLToPath(import.meta.url)), "tools.mjs");
let cached = null, cachedAt = 0;
async function load() {
  const m = (await stat(TOOLS_FILE)).mtimeMs;
  if (!cached || m !== cachedAt) { cached = await import(pathToFileURL(TOOLS_FILE).href + "?v=" + m); cachedAt = m; }
  return cached;
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

createInterface({ input: process.stdin }).on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (id === undefined) return;
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "clay-studio", version: "1.0.0" },
      } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    const { TOOLS, HANDLERS } = await load();
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      const fn = HANDLERS[params?.name];
      if (!fn) throw new Error(`Unknown tool ${params?.name}`);
      const data = await fn(params.arguments || {});
      return send({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      } });
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e.message || e) }] } });
  }
});
