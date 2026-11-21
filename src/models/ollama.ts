import type { ChatMessage, Model, ModelReply, ToolSpec } from "../types.js";

/** Local model through Ollama's /api/chat with native tool calling. */
export class OllamaModel implements Model {
  readonly name: string;
  constructor(
    private model: string,
    private url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  ) {
    this.name = `ollama:${model}`;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply> {
    const res = await fetch(`${this.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        options: { temperature: 0, seed: 7, num_ctx: 8192 },
        tools: tools.map((t) => ({ type: "function", function: t })),
        messages: messages.map((m) =>
          m.role === "tool"
            ? { role: "tool", content: m.content, tool_name: m.toolName }
            : {
                role: m.role,
                content: m.content,
                ...(m.toolCalls?.length
                  ? {
                      tool_calls: m.toolCalls.map((c) => ({
                        function: { name: c.name, arguments: c.arguments },
                      })),
                    }
                  : {}),
              },
        ),
      }),
    });
    if (!res.ok) throw new Error(`OLLAMA_HTTP_${res.status}`);
    const data = (await res.json()) as {
      message: {
        content?: string;
        tool_calls?: {
          function: { name: string; arguments: Record<string, unknown> };
        }[];
      };
    };
    return {
      content: (data.message.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .trim(),
      toolCalls: (data.message.tool_calls ?? []).map((c, i) => ({
        id: `call_${Date.now()}_${i}`,
        name: c.function.name,
        arguments: c.function.arguments ?? {},
      })),
    };
  }
}
