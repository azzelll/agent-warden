import { hostAllowed, type Intent } from "./intent.js";
import { urlsIn } from "./policy.js";

export const LINK_BLOCKED = "[tautan diblokir Warden]";

/**
 * Output filter for text shown to the user: removes links to untrusted
 * domains (phishing relay) and markdown images (a classic zero-click
 * exfiltration channel). Applied to the final answer and outgoing messages.
 */
export function filterOutput(
  text: string,
  intent: Pick<Intent, "trustedDomains">,
): string {
  let out = text.replace(/!\[[^\]]*\]\([^)]*\)/g, LINK_BLOCKED);
  for (const u of urlsIn(out))
    if (!hostAllowed(u.hostname, intent))
      out = out.replaceAll(u.href, LINK_BLOCKED);
  // Bare lookalike domains without a scheme, e.g. "scele-cs-ui.ac-id.info/verify".
  out = out.replace(
    /\b(?:[a-z0-9-]+\.)+(?:info|xyz|top|click|link|ru|tk|ly)(?:\/[^\s)]*)?/gi,
    (m) => (hostAllowed(m.split("/")[0]!, intent) ? m : LINK_BLOCKED),
  );
  return out;
}
