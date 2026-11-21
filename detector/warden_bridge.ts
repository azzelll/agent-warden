/**
 * Bridge between the TypeScript firewall and the Python detector experiments.
 *   npx tsx detector/warden_bridge.ts export        → detector/data/warden.jsonl
 *   npx tsx detector/warden_bridge.ts scan < in.jsonl → {"flag":0|1} per line
 * `export` writes the exact untrusted texts the agent sees in Agent Warden's
 * attack set (label 1) and in its clean world (label 0).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildAttacks } from "../src/dataset/attacks.js";
import { scan } from "../src/firewall/scanner.js";
import { World } from "../src/world.js";

const mode = process.argv[2];
if (mode === "export") {
  const rows: { text: string; label: number; source: string }[] = [];
  for (const a of buildAttacks()) {
    const w = a.build();
    const text =
      a.vector === "deadline"
        ? w.deadlines.find((d) => d.id === "d2")!.description
        : w.emails.find((e) => e.body.includes(a.payload))!.body;
    rows.push({ text, label: 1, source: `warden:${a.technique}` });
  }
  const clean = new World();
  for (const e of clean.emails) rows.push({ text: e.body, label: 0, source: "warden:benign-email" });
  for (const d of clean.deadlines) rows.push({ text: d.description, label: 0, source: "warden:benign-deadline" });
  writeFileSync(
    new URL("./data/warden.jsonl", import.meta.url),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  console.log(`${rows.length} rows`);
} else if (mode === "scan") {
  const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const l of lines) {
    const { text } = JSON.parse(l) as { text: string };
    process.stdout.write(JSON.stringify({ flag: scan(text).findings.length > 0 ? 1 : 0 }) + "\n");
  }
} else {
  console.error("usage: warden_bridge.ts export|scan");
  process.exit(2);
}
