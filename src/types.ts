export type Role = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolName?: string;
  toolCallId?: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

export type ModelReply = { content: string; toolCalls: ToolCall[] };

export interface Model {
  readonly name: string;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply>;
}

/** Which firewall layers are on. */
export type Defenses = {
  spotlight: boolean;
  scan: boolean;
  policy: boolean;
  output: boolean;
};

export const DEFENSE_PRESETS: Record<string, Defenses> = {
  none: { spotlight: false, scan: false, policy: false, output: false },
  spotlight: { spotlight: true, scan: false, policy: false, output: false },
  scan: { spotlight: false, scan: true, policy: false, output: false },
  policy: { spotlight: false, scan: false, policy: true, output: false },
  output: { spotlight: false, scan: false, policy: false, output: true },
  full: { spotlight: true, scan: true, policy: true, output: true },
};
