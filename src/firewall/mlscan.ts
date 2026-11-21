import { QUARANTINE, type Finding } from "./scanner.js";

/**
 * Learned scan layer backed by the local detector service (detector/serve.py,
 * a fine-tuned multilingual classifier).
 *
 * Two stages, with one line as the unit of context: an email body is one
 * line, a listing has one item per line. Each line is classified whole first,
 * because the model was trained on whole emails and fragments out of context
 * are easy to misread (a teammate's "kamu bagian deployment ya" scores 0.98
 * alone, 0.0003 in its email). Classifying a whole multi-item listing at once
 * is the opposite mistake: one injected item gets diluted by the others. Only
 * flagged lines are split into sentences, and the flagged sentences are
 * quarantined; if none is, the whole line is.
 *
 * If the service is unreachable the whole text is quarantined: failing open
 * would silently turn the layer off.
 */
export const DETECTOR_URL =
  process.env.WARDEN_DETECTOR_URL ?? "http://127.0.0.1:8765";
export const DETECTOR_THRESHOLD = Number(
  process.env.WARDEN_DETECTOR_THRESHOLD ?? 0.5,
);

function sentences(text: string): string[][] {
  return text.split("\n").map((line) => line.split(/(?<=[.!?])\s+/));
}

export async function mlScan(
  text: string,
  url = DETECTOR_URL,
  threshold = DETECTOR_THRESHOLD,
): Promise<{ clean: string; findings: Finding[] }> {
  const lines = sentences(text);
  const units = lines.map((l) => l.join(" ")).filter((l) => l.trim());
  const flat = lines.flat().filter((s) => s.trim());
  if (!units.length) return { clean: text, findings: [] };
  let scores: number[];
  try {
    const res = await fetch(`${url}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: [...units, ...flat] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`DETECTOR_HTTP_${res.status}`);
    scores = ((await res.json()) as { scores: number[] }).scores;
    if (scores.length !== units.length + flat.length)
      throw new Error("DETECTOR_BAD_RESPONSE");
  } catch {
    return {
      clean: QUARANTINE,
      findings: [
        {
          pattern: "ml-unavailable",
          excerpt: "detector unreachable; text withheld",
        },
      ],
    };
  }
  const lineFlag = new Map(units.map((u, i) => [u, scores[i]! >= threshold]));
  const sentFlag = new Map(
    flat.map((s, i) => [s, scores[units.length + i]! >= threshold]),
  );
  const findings: Finding[] = [];
  const clean = lines
    .map((line) => {
      const unit = line.join(" ");
      if (!lineFlag.get(unit)) return unit;
      if (!line.some((s) => sentFlag.get(s))) {
        findings.push({ pattern: "ml", excerpt: unit.slice(0, 120) });
        return QUARANTINE;
      }
      return line
        .map((s) => {
          if (!sentFlag.get(s)) return s;
          findings.push({ pattern: "ml", excerpt: s.slice(0, 120) });
          return QUARANTINE;
        })
        .join(" ");
    })
    .join("\n");
  return { clean, findings };
}
