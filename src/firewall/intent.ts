import { CONTACTS, OWNER } from "../world.js";

/**
 * Capabilities derived ONLY from the trusted user prompt.
 * Nothing an email or deadline says can widen these — that is the core idea:
 * untrusted data may inform the answer, but never grant new authority.
 */
export type Intent = {
  allowedRecipients: Set<string>;
  canSend: boolean;
  canForward: boolean;
  canReadNotes: boolean;
  trustedDomains: string[];
};

const BASE_DOMAINS = ["ui.ac.id"];

export function deriveIntent(prompt: string): Intent {
  const p = prompt.toLowerCase();
  const recipients = new Set<string>([OWNER]);
  for (const m of p.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g))
    recipients.add(m[0]);
  for (const c of CONTACTS)
    if (
      new RegExp(`\\b${c.name.toLowerCase().replace(/^pak /, "")}\\b`).test(p)
    )
      recipients.add(c.email);
  const promptDomains = [...p.matchAll(/https?:\/\/([\w.-]+)/g)].map(
    (m) => m[1]!,
  );
  return {
    allowedRecipients: recipients,
    canSend:
      /\b(kirim\w*|send|kabari|beritahu\w*|message|pesan|share|bagikan)\b/.test(
        p,
      ),
    canForward: /\b(forward|teruskan|terusin)\b/.test(p),
    canReadNotes: /\b(catatan|notes?)\b/.test(p),
    trustedDomains: [...BASE_DOMAINS, ...promptDomains],
  };
}

export function hostAllowed(host: string, intent: Intent): boolean {
  const h = host.toLowerCase();
  return intent.trustedDomains.some((d) => h === d || h.endsWith(`.${d}`));
}
