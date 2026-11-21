import { runAgent, type Episode } from "../agent.js";
import {
  attackSucceeded,
  buildAttacks,
  taskDoneUnderAttack,
  type Attack,
} from "../dataset/attacks.js";
import { BENIGN, freshWorld, type BenignTask } from "../dataset/benign.js";
import { DEFENSE_PRESETS, type Model } from "../types.js";

export type Row = {
  model: string;
  defense: string;
  kind: "attack" | "benign";
  id: string;
  goal?: string;
  vector?: string;
  technique?: string;
  /** attack: attacker goal achieved. */
  attackSuccess?: boolean;
  /** benign: task done; attack: user's task still done under attack. */
  utility: boolean;
  blocked: number;
  scanned: number;
  steps: number;
  ms: number;
  truncated?: boolean;
  error?: string;
  /** Short trace for debugging and qualitative examples. */
  final?: string;
  calls?: string[];
};

function trace(ep: Episode) {
  return {
    final: ep.final.slice(0, 600),
    calls: ep.toolCalls.map(
      (c) =>
        `${c.name}${c.arguments.to ? `→${String(c.arguments.to)}` : ""}${c.arguments.id ? `(${String(c.arguments.id)})` : ""}${c.blocked ? ` BLOCKED:${c.blocked.split(":")[0]}` : ""}`,
    ),
  };
}

export async function runAttack(
  model: Model,
  defense: string,
  a: Attack,
): Promise<Row> {
  const world = a.build(),
    t0 = performance.now();
  const ep = await runAgent(model, world, a.task, DEFENSE_PRESETS[defense]!);
  return {
    model: model.name,
    defense,
    kind: "attack",
    id: a.id,
    goal: a.goal,
    vector: a.vector,
    technique: a.technique,
    attackSuccess: attackSucceeded(a.goal, world, ep),
    utility: taskDoneUnderAttack(a.vector, world, ep),
    blocked: ep.events.filter((e) => e.layer === "policy").length,
    scanned: ep.events.filter((e) => e.layer === "scan").length,
    steps: ep.steps,
    ms: Math.round(performance.now() - t0),
    ...(ep.truncated ? { truncated: true } : {}),
    ...(ep.error ? { error: ep.error } : {}),
    ...trace(ep),
  };
}

export async function runBenign(
  model: Model,
  defense: string,
  b: BenignTask,
): Promise<Row> {
  const world = freshWorld(),
    t0 = performance.now();
  const ep = await runAgent(model, world, b.task, DEFENSE_PRESETS[defense]!);
  return {
    model: model.name,
    defense,
    kind: "benign",
    id: b.id,
    utility: b.check(world, ep),
    blocked: ep.events.filter((e) => e.layer === "policy").length,
    scanned: ep.events.filter((e) => e.layer === "scan").length,
    steps: ep.steps,
    ms: Math.round(performance.now() - t0),
    ...(ep.truncated ? { truncated: true } : {}),
    ...(ep.error ? { error: ep.error } : {}),
    ...trace(ep),
  };
}

export const ALL_ATTACKS = buildAttacks();
export { BENIGN };
