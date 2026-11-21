import { readFileSync } from "node:fs";

/**
 * Gateway configuration. The gateway never sees the user's prompt, so the
 * capabilities that Agent Warden derives from the prompt in the harness come from
 * this file instead: which tools read attacker-reachable data, which tools
 * send data out, who may receive it, and which domains are trusted.
 */
export type Access = "allow" | "confirm" | "deny";

export type SinkSpec = {
  /** Argument that names the recipient (email, channel, user id, URL...). */
  recipient?: string;
  /** Arguments whose text leaves the agent (message body, comment, file content). */
  content?: string[];
};

export type ToolRule = {
  /** What the tool's output is. `untrusted` = third parties can write it. */
  source?: "untrusted" | "sensitive" | "trusted";
  /** Present if the tool sends data out of the agent. */
  sink?: SinkSpec;
  /** Static access rule, checked before anything else. Default: config.defaultAccess. */
  access?: Access;
};

export type Layers = {
  spotlight: boolean;
  scan: boolean;
  policy: boolean;
  output: boolean;
};

export type GatewayConfig = {
  /** The user themself. Sends to the owner are never treated as egress. */
  owner?: string;
  /** Aliases that mean the owner, e.g. "me", "owner". */
  ownerAliases?: string[];
  /** Recipients sinks may address without confirmation. The owner is always allowed. */
  recipients?: string[];
  /** What to do with a sink to a recipient not in `recipients`. */
  unknownRecipient?: Access;
  /** What to do with a sink to anyone but the owner after untrusted data entered the session. */
  sinkAfterUntrusted?: Access;
  /** Links in sink content must point to these domains (subdomains included). */
  trustedDomains?: string[];
  /** Regex sources for secrets in sensitive output (default: TOKEN-LIKE-CODES). */
  secretPatterns?: string[];
  /** Rule for tools not listed in `tools`. */
  defaultAccess?: Access;
  tools: Record<string, ToolRule>;
  layers?: Partial<Layers>;
  /** JSONL audit log path. Omit to disable. */
  audit?: string;
};

export type ResolvedConfig = Required<
  Omit<GatewayConfig, "owner" | "audit" | "layers">
> & {
  owner?: string;
  audit?: string;
  layers: Layers;
};

const ACCESS = new Set(["allow", "confirm", "deny"]);

export function resolveConfig(c: GatewayConfig): ResolvedConfig {
  if (!c || typeof c !== "object" || typeof c.tools !== "object")
    throw new Error("gateway config: `tools` object is required");
  for (const k of [
    "unknownRecipient",
    "sinkAfterUntrusted",
    "defaultAccess",
  ] as const)
    if (c[k] !== undefined && !ACCESS.has(c[k]!))
      throw new Error(`gateway config: ${k} must be allow|confirm|deny`);
  for (const [name, r] of Object.entries(c.tools))
    if (r.access !== undefined && !ACCESS.has(r.access))
      throw new Error(`gateway config: tools.${name}.access is invalid`);
  return {
    owner: c.owner?.toLowerCase(),
    ownerAliases: (c.ownerAliases ?? ["owner", "me"]).map((a) =>
      a.toLowerCase(),
    ),
    recipients: (c.recipients ?? []).map((r) => r.toLowerCase()),
    unknownRecipient: c.unknownRecipient ?? "confirm",
    sinkAfterUntrusted: c.sinkAfterUntrusted ?? "confirm",
    trustedDomains: (c.trustedDomains ?? []).map((d) => d.toLowerCase()),
    secretPatterns: c.secretPatterns ?? [],
    defaultAccess: c.defaultAccess ?? "allow",
    tools: c.tools,
    layers: {
      spotlight: true,
      scan: true,
      policy: true,
      output: true,
      ...c.layers,
    },
    audit: c.audit,
  };
}

export function loadConfig(path: string): ResolvedConfig {
  return resolveConfig(JSON.parse(readFileSync(path, "utf8")) as GatewayConfig);
}
