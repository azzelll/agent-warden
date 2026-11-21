import type { ToolCall } from "../types.js";
import { normalizeRecipient } from "../tools.js";
import { OWNER } from "../world.js";
import { hostAllowed, type Intent } from "./intent.js";

/**
 * Tool-call policy: every side-effecting or sensitive call is checked against
 * the capabilities derived from the trusted user prompt, plus taint rules on
 * what data may leave and where. Technique-agnostic: it does not matter how the
 * model was convinced, only what it tries to do.
 */
export type Verdict = { allow: true } | { allow: false; reason: string };

/** Secret-looking tokens seen in sensitive tool output (e.g. private notes). */
export class Taint {
  private secrets = new Set<string>();
  addSensitive(text: string) {
    for (const m of text.matchAll(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,}){2,}\b/g))
      this.secrets.add(m[0]);
  }
  leaks(text: string): string | undefined {
    for (const s of this.secrets) if (text.includes(s)) return s;
    return undefined;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function urlsIn(text: string): URL[] {
  return [...text.matchAll(/https?:\/\/[^\s)"'<>]+/g)].flatMap((m) => {
    try {
      return [new URL(m[0])];
    } catch {
      return [];
    }
  });
}

export function checkToolCall(
  call: ToolCall,
  intent: Intent,
  taint: Taint,
): Verdict {
  const deny = (reason: string): Verdict => ({ allow: false, reason });
  switch (call.name) {
    case "read_notes":
      return intent.canReadNotes
        ? { allow: true }
        : deny(
            "SENSITIVE_READ_NOT_REQUESTED: the user did not ask about their notes",
          );
    case "forward_email": {
      if (!intent.canForward)
        return deny(
          "FORWARD_NOT_REQUESTED: the user did not ask to forward anything",
        );
      const to = normalizeRecipient(str(call.arguments.to));
      return intent.allowedRecipients.has(to)
        ? { allow: true }
        : deny(`RECIPIENT_NOT_AUTHORIZED: ${to} was not named by the user`);
    }
    case "send_message": {
      if (!intent.canSend)
        return deny(
          "SEND_NOT_REQUESTED: the user did not ask to send a message",
        );
      const to = normalizeRecipient(str(call.arguments.to)),
        text = str(call.arguments.text);
      if (!intent.allowedRecipients.has(to))
        return deny(
          `RECIPIENT_NOT_AUTHORIZED: ${to} was not named by the user`,
        );
      const leaked = taint.leaks(text);
      if (leaked && to !== OWNER)
        return deny(
          "SENSITIVE_DATA_EGRESS: private data may only go to the user",
        );
      const bad = urlsIn(text).find((u) => !hostAllowed(u.hostname, intent));
      if (bad)
        return deny(`UNTRUSTED_LINK: ${bad.hostname} is not a trusted domain`);
      return { allow: true };
    }
    default:
      return { allow: true };
  }
}
