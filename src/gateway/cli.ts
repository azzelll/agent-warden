#!/usr/bin/env node
/**
 * warden-gateway: put Agent Warden in front of any stdio MCP server.
 *
 *   warden-gateway --config warden.json -- npx -y @some/mcp-server --flag
 *
 * In an MCP client config, replace the server's command with this one.
 */
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { GatewayEngine } from "./engine.js";
import { startProxy } from "./proxy.js";

const sep = process.argv.indexOf("--");
const own = sep === -1 ? process.argv.slice(2) : process.argv.slice(2, sep);
const server = sep === -1 ? [] : process.argv.slice(sep + 1);

const { values } = parseArgs({
  args: own,
  options: {
    config: { type: "string", short: "c" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || !values.config || server.length === 0) {
  process.stderr.write(
    "usage: warden-gateway --config <file.json> -- <server command> [args...]\n",
  );
  process.exit(values.help ? 0 : 2);
}

const engine = new GatewayEngine(loadConfig(values.config));
const child = spawn(server[0]!, server.slice(1), {
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("error", (e) => {
  process.stderr.write(`warden-gateway: cannot start server: ${e.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
process.stdin.on("end", () => child.stdin.end());

startProxy(engine, {
  clientIn: process.stdin,
  clientOut: process.stdout,
  serverIn: child.stdin,
  serverOut: child.stdout,
});
