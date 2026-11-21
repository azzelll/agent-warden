import type { ToolSpec } from "./types.js";
import type { World } from "./world.js";

/** How a tool's output should be treated by the firewall. */
export type Trust = "untrusted" | "sensitive" | "trusted";

export type ToolDef = {
  spec: ToolSpec;
  trust: Trust;
  /** Sinks send data out of the agent; they are what the policy guards. */
  sink?: boolean;
  run(world: World, args: Record<string, unknown>): string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const spec = (
  name: string,
  description: string,
  properties: ToolSpec["parameters"]["properties"] = {},
  required: string[] = [],
): ToolSpec => ({
  name,
  description,
  parameters: { type: "object", properties, required },
});

export const TOOLS: Record<string, ToolDef> = {
  list_emails: {
    spec: spec(
      "list_emails",
      "List emails in the inbox (id, sender, subject).",
    ),
    trust: "untrusted",
    run: (w) =>
      w.emails
        .map((e) => `${e.id} | ${e.date} | from ${e.from} | ${e.subject}`)
        .join("\n"),
  },
  read_email: {
    spec: spec(
      "read_email",
      "Read one email in full.",
      { id: { type: "string", description: "Email id, e.g. e1" } },
      ["id"],
    ),
    trust: "untrusted",
    run: (w, a) => {
      const e = w.emails.find((x) => x.id === str(a.id));
      return e
        ? `From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${e.body}`
        : "Email not found.";
    },
  },
  list_deadlines: {
    spec: spec(
      "list_deadlines",
      "List upcoming SCELE deadlines with their descriptions.",
    ),
    trust: "untrusted",
    run: (w) =>
      w.deadlines
        .map(
          (d) =>
            `${d.id} | ${d.due} | ${d.course} | ${d.title}\n  ${d.description}`,
        )
        .join("\n"),
  },
  read_notes: {
    spec: spec("read_notes", "Read the user's private notes."),
    trust: "sensitive",
    run: (w) => w.notes,
  },
  list_contacts: {
    spec: spec("list_contacts", "List the user's contacts."),
    trust: "trusted",
    run: (w) => w.contacts.map((c) => `${c.name} <${c.email}>`).join("\n"),
  },
  send_message: {
    spec: spec(
      "send_message",
      "Send a chat message. Use 'owner' to message the user themself.",
      {
        to: { type: "string", description: "Email address or 'owner'" },
        text: { type: "string", description: "Message text" },
      },
      ["to", "text"],
    ),
    trust: "trusted",
    sink: true,
    run: (w, a) => {
      w.outbox.push({
        tool: "send_message",
        to: normalizeRecipient(str(a.to)),
        text: str(a.text),
      });
      return "Sent.";
    },
  },
  forward_email: {
    spec: spec(
      "forward_email",
      "Forward an email to someone.",
      {
        id: { type: "string", description: "Email id" },
        to: { type: "string", description: "Recipient email address" },
      },
      ["id", "to"],
    ),
    trust: "trusted",
    sink: true,
    run: (w, a) => {
      const e = w.emails.find((x) => x.id === str(a.id));
      if (!e) return "Email not found.";
      w.outbox.push({
        tool: "forward_email",
        to: normalizeRecipient(str(a.to)),
        text: `${e.subject}\n${e.body}`,
        emailId: e.id,
      });
      return "Forwarded.";
    },
  },
  create_reminder: {
    spec: spec(
      "create_reminder",
      "Create a reminder for the user.",
      {
        title: { type: "string", description: "Reminder title" },
        when: { type: "string", description: "Date/time" },
      },
      ["title", "when"],
    ),
    trust: "trusted",
    run: (w, a) => {
      w.reminders.push({ title: str(a.title), when: str(a.when) });
      return "Reminder created.";
    },
  },
};

export function normalizeRecipient(to: string): string {
  const t = to.trim().toLowerCase();
  return t === "owner" || t === "me" || t === "saya" ? "owner@aiko.local" : t;
}

export const TOOL_SPECS = Object.values(TOOLS).map((t) => t.spec);
