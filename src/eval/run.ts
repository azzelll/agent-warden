/**
 * Usage:
 *   npm run eval -- --model ollama:qwen3:8b --defenses none,full [--limit N] [--out results/x.jsonl]
 *   npm run eval -- --model scripted            (deterministic naive model, no LLM)
 * Results are appended as JSONL and the run resumes where it stopped.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  ALL_ATTACKS,
  BENIGN,
  runAttack,
  runBenign,
  type Row,
} from "./harness.js";
import { DEFENSE_PRESETS, type Model } from "../types.js";
import { OllamaModel } from "../models/ollama.js";
import { AnthropicModel } from "../models/anthropic.js";
import { NaiveScriptedModel } from "../models/scripted.js";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "scripted" },
    defenses: {
      type: "string",
      default: "none,spotlight,scan,policy,output,full",
    },
    limit: { type: "string" },
    out: { type: "string" },
    only: { type: "string", default: "attack,benign" },
  },
});

function makeModel(spec: string): Model {
  if (spec === "scripted") return new NaiveScriptedModel();
  const [provider, ...rest] = spec.split(":");
  const id = rest.join(":");
  if (provider === "ollama") return new OllamaModel(id);
  if (provider === "anthropic") return new AnthropicModel(id);
  throw new Error(`Unknown model ${spec}`);
}

const model = makeModel(values.model!);
const defenses = values.defenses!.split(",");
for (const d of defenses)
  if (!DEFENSE_PRESETS[d]) throw new Error(`Unknown defense ${d}`);
const out =
  values.out ?? `results/${model.name.replace(/[^\w.-]+/g, "_")}.jsonl`;
mkdirSync(dirname(out), { recursive: true });

const done = new Set(
  existsSync(out)
    ? readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Row)
        .filter((r) => !r.error)
        .map((r) => `${r.defense}|${r.kind}|${r.id}`)
    : [],
);

const limit = values.limit ? Number(values.limit) : Infinity;
const kinds = values.only!.split(",");
const jobs: {
  defense: string;
  kind: "attack" | "benign";
  id: string;
  run: () => Promise<Row>;
}[] = [];
for (const defense of defenses) {
  if (kinds.includes("benign"))
    for (const b of BENIGN.slice(0, limit))
      jobs.push({
        defense,
        kind: "benign",
        id: b.id,
        run: () => runBenign(model, defense, b),
      });
  if (kinds.includes("attack"))
    for (const a of ALL_ATTACKS.slice(0, limit))
      jobs.push({
        defense,
        kind: "attack",
        id: a.id,
        run: () => runAttack(model, defense, a),
      });
}

const todo = jobs.filter((j) => !done.has(`${j.defense}|${j.kind}|${j.id}`));
console.log(
  `${model.name}: ${todo.length} episodes to run (${jobs.length - todo.length} already done) → ${out}`,
);
let i = 0;
for (const job of todo) {
  const row = await job.run();
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  i++;
  const tag =
    row.kind === "attack"
      ? row.attackSuccess
        ? "PWNED"
        : "safe "
      : row.utility
        ? "ok   "
        : "FAIL ";
  console.log(
    `[${i}/${todo.length}] ${row.defense.padEnd(9)} ${tag} ${row.id} (${row.ms} ms)${row.error ? ` error=${row.error}` : ""}`,
  );
}
