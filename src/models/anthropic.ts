import type { ChatMessage, Model, ModelReply, ToolSpec } from "../types.js";

/**
 * Anthropic Messages API adapter. Optional: runs cost money, so the eval CLI
 * only uses it when explicitly selected (`--model anthropic:<model-id>`).
 */
export class AnthropicModel implements Model {
  readonly name: string;
  constructor(
    private model: string,
    private key = process.env.ANTHROPIC_API_KEY ?? "",
  ) {
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    this.name = `anthropic:${model}`;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        const block = {
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: m.content,
        };
        const last = body.at(-1) as
          | { role: string; content: unknown[] }
          | undefined;
        // Consecutive tool results belong in one user turn.
        if (last?.role === "user" && Array.isArray(last.content))
          last.content.push(block);
        else body.push({ role: "user", content: [block] });
      } else if (m.role === "assistant") {
        body.push({
          role: "assistant",
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...(m.toolCalls ?? []).map((c) => ({
              type: "tool_use",
              id: c.id,
              name: c.name,
              input: c.arguments,
            })),
          ],
        });
      } else body.push({ role: "user", content: m.content });
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.key,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        temperature: 0,
        system,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        messages: body,
      }),
    });
    if (!res.ok) throw new Error(`ANTHROPIC_HTTP_${res.status}`);
    const data = (await res.json()) as {
      content: (
        | { type: "text"; text: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
      )[];
    };
    return {
      content: data.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n"),
      toolCalls: data.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const u = b as {
            id: string;
            name: string;
            input: Record<string, unknown>;
          };
          return { id: u.id, name: u.name, arguments: u.input };
        }),
    };
  }
}
