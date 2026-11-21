import type { Defenses, ToolCall } from "../types.js";
import type { Trust } from "../tools.js";
import { deriveIntent, type Intent } from "./intent.js";
import { Spotlight } from "./spotlight.js";
import { scan } from "./scanner.js";
import { mlScan } from "./mlscan.js";
import { checkToolCall, Taint, type Verdict } from "./policy.js";
import { filterOutput } from "./output.js";

export type FirewallEvent = {
  layer: "spotlight" | "scan" | "policy" | "output";
  detail: string;
};

/** Composes the four layers; each can be switched on or off for ablation. */
export class Firewall {
  readonly intent: Intent;
  readonly events: FirewallEvent[] = [];
  private spotlight = new Spotlight();
  private taint = new Taint();

  constructor(
    private defenses: Defenses,
    userPrompt: string,
  ) {
    this.intent = deriveIntent(userPrompt);
  }

  systemAddendum(): string {
    return this.defenses.spotlight ? this.spotlight.systemAddendum() : "";
  }

  /** Process a tool result before the model sees it. */
  async inbound(tool: string, trust: Trust, text: string): Promise<string> {
    // Taint tracking is bookkeeping for the policy layer; it never changes text.
    if (trust === "sensitive") this.taint.addSensitive(text);
    if (trust !== "untrusted") return text;
    let out = text;
    if (this.defenses.scan) {
      const r = scan(out);
      for (const f of r.findings)
        this.events.push({
          layer: "scan",
          detail: `${f.pattern}: ${f.excerpt}`,
        });
      out = r.clean;
    }
    if (this.defenses.ml) {
      const r = await mlScan(out);
      for (const f of r.findings)
        this.events.push({
          layer: "scan",
          detail: `${f.pattern}: ${f.excerpt}`,
        });
      out = r.clean;
    }
    if (this.defenses.spotlight) out = this.spotlight.wrap(tool, out);
    return out;
  }

  /** Decide whether a tool call may run. */
  check(call: ToolCall): Verdict {
    if (!this.defenses.policy) return { allow: true };
    const v = checkToolCall(call, this.intent, this.taint);
    if (!v.allow)
      this.events.push({
        layer: "policy",
        detail: `${call.name}: ${v.reason}`,
      });
    return v;
  }

  /** Filter text that will reach the user (final answer, message bodies). */
  outbound(text: string): string {
    if (!this.defenses.output) return text;
    const out = filterOutput(text, this.intent);
    if (out !== text)
      this.events.push({ layer: "output", detail: "removed untrusted link" });
    return out;
  }
}
