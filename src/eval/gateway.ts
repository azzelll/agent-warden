/**
 * Evaluate the MCP gateway (src/gateway) on the same 104 attacks and 12 benign
 * tasks as the harness firewall. The gateway cannot see the user's prompt, so
 * where the harness derives intent, the gateway asks the user to confirm.
 * Each run fixes how that simulated user answers:
 *   --confirm decline   the user declines every prompt (careful user)
 *   --confirm approve   the user approves every prompt (rubber-stamping, worst case)
 *
 *   npm run eval:gateway -- --model scripted --confirm decline,approve
 *   npm run eval:gateway -- --model ollama:qwen3:8b
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runAgent, type Episode, type Guard } from "../agent.js";
import {
  attackSucceeded,
  taskDoneUnderAttack,
  type Attack,
} from "../dataset/attacks.js";
import { freshWorld, type BenignTask } from "../dataset/benign.js";
import type { FirewallEvent } from "../firewall/index.js";
import { loadConfig, type ResolvedConfig } from "../gateway/config.js";
import { GatewayEngine } from "../gateway/engine.js";
import { AnthropicModel } from "../models/anthropic.js";
import { OllamaModel } from "../models/ollama.js";
import { NaiveScriptedModel } from "../models/scripted.js";
import type { Model, ToolCall } from "../types.js";
import { ALL_ATTACKS, BENIGN } from "./harness.js";

export type ConfirmMode = "decline" | "approve";

/** Runs the gateway engine in-process, exactly as the stdio proxy would call it. */
export class GatewayGuard implements Guard {
  readonly events: FirewallEvent[] = [];
  readonly engine: GatewayEngine;
  confirms = 0;

  constructor(
    config: ResolvedConfig,
    private mode: ConfirmMode,
  ) {
    this.engine = new GatewayEngine({ ...config, audit: undefined });
  }

  systemAddendum() {
    return this.engine.instructions();
  }

  inbound(tool: string, _trust: unknown, text: string) {
    const before = this.engine.events.length;
    const out = this.engine.inbound(tool, text);
    for (const e of this.engine.events.slice(before))
      this.events.push({ layer: "scan", detail: e.detail });
    return out;
  }

  check(call: ToolCall) {
    const d = this.engine.check(call.name, call.arguments);
    if (d.action === "allow") return { allow: true as const, args: d.args };
    if (d.action === "confirm") {
      this.confirms++;
      const ok = this.mode === "approve";
      this.engine.confirmed(call.name, ok, d.reason);
      if (ok) return { allow: true as const, args: d.args };
    }
    this.events.push({ layer: "policy", detail: `${call.name}: ${d.reason}` });
    return { allow: false as const, reason: d.reason };
  }

  /** The final answer goes from the model to the client, never through an MCP server. */
  outbound(text: string) {
    return text;
  }
}

export type GatewayRow = {
  model: string;
  confirm: ConfirmMode;
  kind: "attack" | "benign";
  id: string;
  goal?: string;
  technique?: string;
  vector?: string;
  attackSuccess?: boolean;
  utility: boolean;
  confirms: number;
  blocked: number;
  error?: string;
};

function row(
  model: Model,
  mode: ConfirmMode,
  g: GatewayGuard,
  ep: Episode,
  base: Pick<GatewayRow, "kind" | "id" | "utility"> & Partial<GatewayRow>,
): GatewayRow {
  return {
    model: model.name,
    confirm: mode,
    confirms: g.confirms,
    blocked: g.events.filter((e) => e.layer === "policy").length,
    ...(ep.error ? { error: ep.error } : {}),
    ...base,
  };
}

export async function gatewayAttack(
  model: Model,
  config: ResolvedConfig,
  mode: ConfirmMode,
  a: Attack,
): Promise<GatewayRow> {
  const world = a.build(),
    g = new GatewayGuard(config, mode);
  const ep = await runAgent(model, world, a.task, g);
  return row(model, mode, g, ep, {
    kind: "attack",
    id: a.id,
    goal: a.goal,
    technique: a.technique,
    vector: a.vector,
    attackSuccess: attackSucceeded(a.goal, world, ep),
    utility: taskDoneUnderAttack(a.vector, world, ep),
  });
}

export async function gatewayBenign(
  model: Model,
  config: ResolvedConfig,
  mode: ConfirmMode,
  b: BenignTask,
): Promise<GatewayRow> {
  const world = freshWorld(),
    g = new GatewayGuard(config, mode);
  const ep = await runAgent(model, world, b.task, g);
  return row(model, mode, g, ep, {
    kind: "benign",
    id: b.id,
    utility: b.check(world, ep),
  });
}

export function summarizeGateway(rows: GatewayRow[]): string {
  const valid = rows.filter((r) => !r.error);
  const pct = (n: number, d: number) =>
    d ? `${((100 * n) / d).toFixed(1)}% · ${n}/${d}` : "–";
  const lines = ["# Tameng MCP gateway results", ""];
  for (const model of new Set(valid.map((r) => r.model))) {
    lines.push(
      `## ${model}`,
      "",
      "| Simulated user | Attack success | Attacks that hit a confirm prompt | Benign utility | Benign tasks needing a confirm |",
      "|---|---|---|---|---|",
    );
    for (const mode of ["decline", "approve"] as const) {
      const mr = valid.filter((r) => r.model === model && r.confirm === mode);
      if (!mr.length) continue;
      const at = mr.filter((r) => r.kind === "attack"),
        bn = mr.filter((r) => r.kind === "benign");
      lines.push(
        `| ${mode} | ${pct(at.filter((r) => r.attackSuccess).length, at.length)} | ${pct(at.filter((r) => r.confirms > 0).length, at.length)} | ${pct(bn.filter((r) => r.utility).length, bn.length)} | ${pct(bn.filter((r) => r.confirms > 0).length, bn.length)} |`,
      );
    }
    lines.push("");
    const decl = valid.filter(
      (r) =>
        r.model === model && r.confirm === "decline" && r.kind === "attack",
    );
    if (decl.length) {
      lines.push(
        "### Attack success by goal (user declines)",
        "",
        "| goal | success |",
        "|---|---|",
      );
      for (const goal of new Set(decl.map((r) => r.goal!)))
        lines.push(
          `| ${goal} | ${pct(
            decl.filter((r) => r.goal === goal && r.attackSuccess).length,
            decl.filter((r) => r.goal === goal).length,
          )} |`,
        );
      lines.push("");
    }
  }
  return lines.join("\n");
}

function makeModel(spec: string): Model {
  if (spec === "scripted") return new NaiveScriptedModel();
  const [provider, ...rest] = spec.split(":");
  const id = rest.join(":");
  if (provider === "ollama") return new OllamaModel(id);
  if (provider === "anthropic") return new AnthropicModel(id);
  throw new Error(`Unknown model ${spec}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "scripted" },
      config: { type: "string", default: "examples/aiko-world.json" },
      confirm: { type: "string", default: "decline,approve" },
      limit: { type: "string" },
      /** Turn layers off for ablation, e.g. --ablate scan,output */
      ablate: { type: "string", default: "" },
    },
  });
  const model = makeModel(values.model!);
  const config = loadConfig(values.config!);
  const ablated = values.ablate!.split(",").filter(Boolean);
  for (const l of ablated) {
    if (!(l in config.layers)) throw new Error(`Unknown layer ${l}`);
    config.layers[l as keyof typeof config.layers] = false;
  }
  const modes = values.confirm!.split(",") as ConfirmMode[];
  const limit = values.limit ? Number(values.limit) : Infinity;
  const slug =
    model.name.replace(/[^\w.-]+/g, "_") +
    (ablated.length ? `_no-${ablated.join("-")}` : "");
  const out = `results/gateway_${slug}.jsonl`;
  mkdirSync("results", { recursive: true });
  writeFileSync(out, "");
  const rows: GatewayRow[] = [];
  for (const mode of modes) {
    for (const a of ALL_ATTACKS.slice(0, limit)) {
      const r = await gatewayAttack(model, config, mode, a);
      rows.push(r);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
    }
    for (const b of BENIGN) {
      const r = await gatewayBenign(model, config, mode, b);
      rows.push(r);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
    }
  }
  const md = summarizeGateway(rows);
  writeFileSync(`results/GATEWAY_${slug}.md`, md);
  process.stdout.write(`${md}\n`);
}
