/**
 * Aggregate JSONL results into results/REPORT.md.
 *   npm run report -- results/ollama_qwen3_8b.jsonl [more.jsonl ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Row } from "./harness.js";

export function summarize(rows: Row[]): string {
  const valid = rows.filter((r) => !r.error);
  const pct = (n: number, d: number) =>
    d ? `${((100 * n) / d).toFixed(1)}%` : "–";
  const ci = (n: number, d: number) => {
    // Wilson 95% interval: honest error bars for small samples.
    if (!d) return "";
    const z = 1.96,
      p = n / d,
      den = 1 + (z * z) / d,
      c = (p + (z * z) / (2 * d)) / den,
      h = (z * Math.sqrt((p * (1 - p)) / d + (z * z) / (4 * d * d))) / den;
    return ` (${(100 * Math.max(0, c - h)).toFixed(0)}–${(100 * Math.min(1, c + h)).toFixed(0)})`;
  };
  const models = [...new Set(valid.map((r) => r.model))];
  const order = ["none", "spotlight", "scan", "output", "policy", "full"];
  const lines: string[] = ["# Agent Warden results", ""];
  for (const model of models) {
    const mr = valid.filter((r) => r.model === model);
    const defenses = order.filter((d) => mr.some((r) => r.defense === d));
    lines.push(`## ${model}`, "");
    lines.push(
      "| Defense | Attack success rate (95% CI) | Task done under attack | Benign utility | Policy blocks / ep | Median ms |",
      "|---|---|---|---|---|---|",
    );
    for (const d of defenses) {
      const att = mr.filter((r) => r.defense === d && r.kind === "attack"),
        ben = mr.filter((r) => r.defense === d && r.kind === "benign");
      const succ = att.filter((r) => r.attackSuccess).length;
      const ms = [...mr.filter((r) => r.defense === d).map((r) => r.ms)].sort(
        (a, b) => a - b,
      );
      lines.push(
        `| ${d} | ${pct(succ, att.length)}${ci(succ, att.length)} · ${succ}/${att.length} | ${pct(att.filter((r) => r.utility).length, att.length)} | ${pct(ben.filter((r) => r.utility).length, ben.length)} · ${ben.filter((r) => r.utility).length}/${ben.length} | ${att.length ? (att.reduce((s, r) => s + r.blocked, 0) / att.length).toFixed(2) : "–"} | ${ms.length ? ms[Math.floor(ms.length / 2)] : "–"} |`,
      );
    }
    lines.push("");
    for (const key of ["goal", "technique", "vector"] as const) {
      const values = [
        ...new Set(mr.filter((r) => r.kind === "attack").map((r) => r[key]!)),
      ];
      lines.push(
        `### Attack success by ${key}`,
        "",
        `| ${key} | ${defenses.join(" | ")} |`,
        `|---|${defenses.map(() => "---").join("|")}|`,
      );
      for (const v of values)
        lines.push(
          `| ${v} | ${defenses
            .map((d) => {
              const a = mr.filter(
                (r) => r.kind === "attack" && r.defense === d && r[key] === v,
              );
              return a.length
                ? `${a.filter((r) => r.attackSuccess).length}/${a.length}`
                : "–";
            })
            .join(" | ")} |`,
        );
      lines.push("");
    }
    const failedBenign = mr.filter((r) => r.kind === "benign" && !r.utility);
    if (failedBenign.length)
      lines.push(
        "### Failed benign tasks",
        "",
        ...failedBenign.map(
          (r) =>
            `- \`${r.defense}\` ${r.id}${r.blocked ? ` (policy blocked ${r.blocked})` : ""}`,
        ),
        "",
      );
  }
  const errors = rows.filter((r) => r.error).length;
  if (errors)
    lines.push(
      `_${errors} episodes ended with an error and are excluded._`,
      "",
    );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("usage: report <results.jsonl...>");
  const rows = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row),
  );
  const md = summarize(rows);
  writeFileSync("results/REPORT.md", md);
  console.log(md);
}
