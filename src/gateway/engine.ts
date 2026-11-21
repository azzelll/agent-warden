import { appendFileSync } from "node:fs";
import { filterOutput, LINK_BLOCKED } from "../firewall/output.js";
import { hostAllowed } from "../firewall/intent.js";
import { DEFAULT_SECRET_PATTERN, Taint, urlsIn } from "../firewall/policy.js";
import { scan } from "../firewall/scanner.js";
import { Spotlight } from "../firewall/spotlight.js";
import type { Access, ResolvedConfig, ToolRule } from "./config.js";

export type GatewayDecision =
  | { action: "allow"; args: Record<string, unknown> }
  | { action: "confirm"; reason: string; args: Record<string, unknown> }
  | { action: "deny"; reason: string };

export type AuditEvent = {
  ts: string;
  layer: "policy" | "scan" | "output" | "confirm";
  tool: string;
  decision?: "allow" | "confirm" | "deny" | "approved" | "declined";
  detail: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Per-session gateway state: one instance per MCP connection.
 *
 * Same four layers as the harness firewall, but every capability comes from
 * the config, not from a user prompt the gateway cannot see. The extra rule
 * is session-level: once untrusted text entered the agent's context, any sink
 * to someone other than the owner needs confirmation (`sinkAfterUntrusted`).
 * That is a coarse but technique-agnostic stand-in for data-flow tracking.
 */
export class GatewayEngine {
  readonly events: AuditEvent[] = [];
  readonly spotlight = new Spotlight();
  private taint: Taint;
  private sawUntrusted = false;

  constructor(readonly config: ResolvedConfig) {
    this.taint = new Taint(
      config.secretPatterns.length
        ? config.secretPatterns.map((s) => new RegExp(s, "g"))
        : [DEFAULT_SECRET_PATTERN],
    );
  }

  rule(tool: string): ToolRule {
    return this.config.tools[tool] ?? {};
  }

  /** Text appended to the server's `instructions` and to untrusted tool descriptions. */
  instructions(): string {
    return this.config.layers.spotlight ? this.spotlight.systemAddendum() : "";
  }

  /** Hide tools whose static rule is `deny` so the model never plans with them. */
  visible(tool: string): boolean {
    return (this.rule(tool).access ?? this.config.defaultAccess) !== "deny";
  }

  private isOwner(r: string) {
    const t = r.trim().toLowerCase();
    return (
      this.config.ownerAliases.includes(t) ||
      (this.config.owner !== undefined && t === this.config.owner)
    );
  }

  private log(e: Omit<AuditEvent, "ts">) {
    const ev = { ts: new Date().toISOString(), ...e };
    this.events.push(ev);
    if (this.config.audit)
      try {
        appendFileSync(this.config.audit, `${JSON.stringify(ev)}\n`);
      } catch {
        // An unwritable audit log must not take the agent down.
      }
  }

  /** Decide whether a tool call may run. May rewrite sink content (output layer). */
  check(tool: string, rawArgs: Record<string, unknown>): GatewayDecision {
    const rule = this.rule(tool);
    const args = { ...rawArgs };
    const { layers } = this.config;
    const decide = (action: Access, reason: string): GatewayDecision => {
      this.log({ layer: "policy", tool, decision: action, detail: reason });
      return action === "allow"
        ? { action, args }
        : action === "deny"
          ? { action, reason }
          : { action, reason, args };
    };

    if (layers.policy) {
      const access = rule.access ?? this.config.defaultAccess;
      if (access !== "allow")
        return decide(access, `STATIC_RULE: ${tool} is set to ${access}`);
    }
    if (!rule.sink) return { action: "allow", args };

    const recipient = rule.sink.recipient ? str(args[rule.sink.recipient]) : "";
    const toOwner = recipient !== "" && this.isOwner(recipient);
    const contentKeys = rule.sink.content ?? [];

    // Output layer: strip untrusted links and markdown images from content.
    if (layers.output)
      for (const k of contentKeys)
        if (typeof args[k] === "string") {
          const clean = filterOutput(args[k], this.config);
          if (clean !== args[k]) {
            this.log({
              layer: "output",
              tool,
              detail: `removed untrusted link from ${k}`,
            });
            args[k] = clean;
          }
        }

    if (!layers.policy) return { action: "allow", args };

    const content = contentKeys.map((k) => str(args[k])).join("\n");
    if (!toOwner) {
      const leaked = this.taint.leaks(content);
      if (leaked)
        return decide(
          "deny",
          "SENSITIVE_DATA_EGRESS: private data may only go to the owner",
        );
    }
    const bad = urlsIn(content).find(
      (u) => !hostAllowed(u.hostname, this.config),
    );
    if (bad)
      return decide(
        "deny",
        `UNTRUSTED_LINK: ${bad.hostname} is not a trusted domain`,
      );
    if (toOwner) return { action: "allow", args };

    const known =
      recipient !== "" &&
      this.config.recipients.includes(recipient.trim().toLowerCase());
    if (!known && this.config.unknownRecipient !== "allow")
      return decide(
        this.config.unknownRecipient,
        `RECIPIENT_NOT_ALLOWLISTED: ${recipient || "(none)"}`,
      );
    if (this.sawUntrusted && this.config.sinkAfterUntrusted !== "allow")
      return decide(
        this.config.sinkAfterUntrusted,
        `SINK_AFTER_UNTRUSTED: ${tool} → ${recipient} after reading third-party content`,
      );
    return { action: "allow", args };
  }

  /** Record the user's answer to a confirmation prompt. */
  confirmed(tool: string, approved: boolean, reason: string) {
    this.log({
      layer: "confirm",
      tool,
      decision: approved ? "approved" : "declined",
      detail: reason,
    });
  }

  /** Base64 blobs that decode to an untrusted link are removed whole. */
  private stripEncodedLinks(text: string): string {
    return text.replace(/[A-Za-z0-9+/]{24,}={0,2}/g, (blob) => {
      const decoded = Buffer.from(blob, "base64").toString("utf8");
      if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) return blob;
      return filterOutput(decoded, this.config) === decoded
        ? blob
        : LINK_BLOCKED;
    });
  }

  /** Process one text block of a tool result before the model sees it. */
  inbound(tool: string, text: string): string {
    const source = this.rule(tool).source ?? "trusted";
    if (source === "sensitive") this.taint.addSensitive(text);
    if (source !== "untrusted") return text;
    this.sawUntrusted = true;
    let out = text;
    if (this.config.layers.scan) {
      const r = scan(out);
      for (const f of r.findings)
        this.log({
          layer: "scan",
          tool,
          detail: `${f.pattern}: ${f.excerpt}`,
        });
      out = r.clean;
    }
    // The gateway never sees the model's answer to the user, so it cannot
    // filter links there. Instead untrusted links are removed before the
    // model reads them: a link the model never saw cannot be relayed.
    if (this.config.layers.output) {
      const clean = filterOutput(this.stripEncodedLinks(out), this.config);
      if (clean !== out)
        this.log({ layer: "output", tool, detail: "removed untrusted link" });
      out = clean;
    }
    if (this.config.layers.spotlight) out = this.spotlight.wrap(tool, out);
    return out;
  }
}
