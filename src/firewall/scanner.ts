/**
 * Heuristic prompt-injection scanner for untrusted text (English + Indonesian).
 * Works per sentence: suspicious sentences are quarantined (replaced with a
 * marker) so the rest of the email/deadline stays usable. Base64 blobs are
 * decoded and scanned too. This layer is pattern-based and therefore bypassable
 * by novel phrasings — it is one layer, not the defense.
 */
export const QUARANTINE = "[Tameng: instruksi mencurigakan disembunyikan]";

const PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "override",
    re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|rules?|prompt|task)\b|\babaikan\b.{0,40}\b(instruksi|perintah|aturan|tugas)\b/i,
  },
  {
    name: "role-tag",
    re: /\[(system|admin|inst|assistant)\]|<\|?(system|im_start|im_end)\|?>|^\s*(system|assistant|user)\s*:/im,
  },
  {
    name: "addressed-to-ai",
    re: /\b(to the (ai|assistant)|for the (ai|assistant)|note to (ai|assistant)|asisten ai|kepada asisten|untuk asisten|hi aiko|halo aiko|aiko,)/i,
  },
  {
    name: "new-persona",
    re: /\b(you are now|act as|from now on|kamu sekarang|mulai sekarang|berperan sebagai)\b/i,
  },
  {
    name: "tool-name",
    re: /\b(send_message|forward_email|read_notes|create_reminder|list_contacts)\b|"tool_(call|result)"/i,
  },
  {
    name: "exfil-verb",
    re: /\b(send|forward|email|share|kirim\w*|teruskan|bagikan)\b.{0,80}\b(to|ke|kepada)\b.{0,40}[\w.+-]+@[\w-]+\.[\w.]+/i,
  },
  {
    name: "secret-seeking",
    re: /\b(private notes?|recovery code|password|catatan pribadi|kode pemulihan|kata sandi)\b/i,
  },
  {
    name: "mass-send",
    re: /\b(every|all) (contacts?|friends?)\b|\bsemua kontak\b/i,
  },
  {
    name: "concealment",
    re: /\b(do not|don't|never) (tell|mention|inform|confirm)\b|\bjangan (beritahu|sebut\w*|kasih tahu|konfirmasi)\b|no need to confirm/i,
  },
  {
    name: "fake-turn",
    re: /<\/?(email|data|tool)>|\bassistant:\s*(sure|ok|done)/i,
  },
];

export type Finding = { pattern: string; excerpt: string };

function decodeBase64Blobs(text: string): string[] {
  return [...text.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)].flatMap((m) => {
    try {
      const decoded = Buffer.from(m[0], "base64").toString("utf8");
      return /^[\x09\x0a\x0d\x20-\x7e -￿]+$/.test(decoded) ? [decoded] : [];
    } catch {
      return [];
    }
  });
}

export function scanSentence(sentence: string): Finding | undefined {
  for (const candidate of [sentence, ...decodeBase64Blobs(sentence)])
    for (const p of PATTERNS)
      if (p.re.test(candidate))
        return { pattern: p.name, excerpt: sentence.slice(0, 120) };
  return undefined;
}

export function scan(text: string): { clean: string; findings: Finding[] } {
  const findings: Finding[] = [];
  // Keep line structure; split lines into sentences.
  const clean = text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => {
          const f = scanSentence(sentence);
          if (!f) return sentence;
          findings.push(f);
          return QUARANTINE;
        })
        .join(" "),
    )
    .join("\n");
  return { clean, findings };
}
