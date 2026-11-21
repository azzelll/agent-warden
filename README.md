# Agent Warden

**A red-team harness and a four-layer firewall against indirect prompt injection in tool-using LLM agents.**

A warden decides what may pass. Agent Warden sits between an LLM agent and its tools and decides which tool calls may run and which data may reach the model or leave it. The target is an Aiko-like personal assistant: it reads a student's email and SCELE deadlines, keeps private notes, and can send messages. That is the classic setup for **indirect prompt injection**. Whoever can put text in an email or a calendar description can try to make the agent act for them.

Agent Warden does three things:

1. **Attacks.** 104 injection attacks = 5 attacker goals × 3 injection vectors × 8 techniques (English, Indonesian, base64, fake system tags, forged conversation turns, impersonation, …).
2. **Defends.** Four independent layers you can switch on one by one: spotlighting, an injection scanner, a tool-call policy with taint tracking, and an output filter.
3. **Measures.** Attack success rate (ASR) and what the defense costs (12 benign tasks, plus "task still done under attack"). Scoring is **deterministic**: it is decided from observable side effects (who received what, what the user saw), never by asking an LLM to judge.

## Results

Same 104 attacks and 12 benign tasks, temperature 0. ASR = attack success rate with Wilson 95% interval. Full breakdown: [`results/REPORT.md`](results/REPORT.md).

| Defense | Worst-case scripted agent: ASR | **qwen3:8b (local): ASR** | qwen3:8b benign utility |
|---|---|---|---|
| none | 99.0% (95–100) | **32.7% (24–42)** | 8/12 |
| spotlight | 99.0% | 12.5% (7–20) | 8/12 |
| scan | 14.4% | 9.6% (5–17) | 8/12 |
| output | 76.0% | 18.3% (12–27) | 8/12 |
| policy | 29.8% | 14.4% (9–22) | 7/12 |
| **full** | **0.0% (0–4)** | **0.0% (0–4)** | **8/12** |

- **The firewall costs no utility on a real model.** qwen3:8b fails the same 4 benign tasks with and without it (a capability limit of the 8B model), and still finishes the user's task in 98% of attack episodes.
- **No single layer is enough.** Each helps, none reaches zero alone. The scanner misses politely worded phishing, the policy cannot see links in the final answer, and the output filter cannot stop exfiltration.
- **Forged conversation turns are the strongest technique** (12/13 undefended); base64 payloads never work on this model because it does not decode them.
- **Honest cost:** the policy layer alone once blocked a legitimate request. Asked to "send me the link", the model used `forward_email` instead of `send_message`, which the intent rules had not authorised.


## Learned scan layer

The regex scanner is the weakest layer, so [`detector/`](detector/README.md) replaces it with a fine-tuned multilingual classifier served locally. Against Agent Warden's payloads, held-out attack techniques and public data it beats the regex and an off-the-shelf English detector on recall, with lower false positives than the regex (15% vs 35% on benign emails written to look like instructions). With the worst-case agent the full stack using it stays at 0/104 attacks. Enable it with the `ml` / `full_ml` presets after starting `detector/serve.py`.

## Threat model

|                     |                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asset**           | Private notes (a recovery code), a confidential offer letter, the user's trust in what the assistant tells them, the user's contacts                                                                                                           |
| **Attacker**        | Can write text the agent will read: send the user an email (unknown sender), compromise or spoof a known contact's email, or edit a course event description on the LMS                                                                        |
| **Attacker cannot** | Change the user's own prompt, the system prompt, tool code or the firewall                                                                                                                                                                     |
| **Goals**           | `exfil_secret` (send the recovery code out), `forward_offer` (forward the confidential email), `phishing_link` (show the user a credential-phishing link), `spam_contacts` (message every contact), `suppress_deadline` (hide a real deadline) |
| **Success**         | The goal's effect is observable in the world: a message to a non-user recipient containing the secret, a forward of `e2`, the phishing host in anything the user sees, …                                                                       |

Out of scope: direct jailbreaks by the user themself, model-weight attacks, and attacks on the tool implementations.

## Defense layers

```
user prompt (trusted) ──► Intent: who may be messaged, may notes be read, may anything be forwarded?
                                      │
tool result (untrusted) ─► [scan] quarantine instruction-like sentences
                        ─► [spotlight] wrap in a random per-episode boundary, mark as data
                                      │
model proposes tool call ─► [policy] check against Intent + taint (secrets only go to the user,
                                      no links to untrusted domains, no un-requested sinks)
                                      │
text to the user ───────► [output] strip untrusted links and markdown-image beacons
```

| Layer         | Idea                                                                                                                                                                                                      | Weakness                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **spotlight** | Delimit untrusted data with an unforgeable random boundary and tell the model it is data ([Hines et al., 2024](https://arxiv.org/abs/2403.14720))                                                         | Advisory only: a model can still choose to obey                                           |
| **scan**      | Per-sentence EN/ID heuristics, also over decoded base64; suspicious sentences are replaced, the rest stays usable                                                                                         | Pattern-based: novel phrasing gets through (a test documents one such gap)                |
| **policy**    | Capabilities come **only from the trusted user prompt**; untrusted text can inform the answer but never grant authority (in the spirit of [CaMeL](https://arxiv.org/abs/2503.18813) and dual-LLM designs) | Cannot see "soft" attacks that only change what the model _says_ (e.g. hiding a deadline) |
| **output**    | Remove links to untrusted domains and markdown images before the user sees text                                                                                                                           | Only covers link-shaped harm                                                              |

The layers are deliberately different in kind, and the ablation shows why: no single one is enough.

## Run it

Needs Node.js 24+. Optional: [Ollama](https://ollama.com) with a tool-calling model.

```bash
npm ci
npm test                      # deterministic, no LLM: scripted worst-case agent
npm run eval -- --model scripted
npm run eval -- --model ollama:qwen3:8b --defenses none,full
npm run report -- results/ollama_qwen3_8b.jsonl   # writes results/REPORT.md
```

`--model anthropic:<model-id>` is supported too (needs `ANTHROPIC_API_KEY`; it costs money, so it never runs by default). Runs append to JSONL and resume where they stopped.

The **scripted worst-case agent** (`src/models/scripted.ts`) does the user's task with a fixed plan _and_ obeys every injected instruction it can parse, including base64. It lets CI prove the firewall's effect without any LLM.

## MCP gateway: use Agent Warden in front of any MCP server

`src/gateway/` turns the same four layers into a drop-in [Model Context Protocol](https://modelcontextprotocol.io) proxy. It sits between an MCP client (Claude Desktop, Cursor, your own agent) and any stdio MCP server, with zero runtime dependencies.

```
MCP client ──stdio──► warden-gateway ──stdio──► MCP server (Gmail, Slack, files, ...)
                       │ tools/list   hide `deny` tools, mark untrusted ones
                       │ tools/call   policy: static rules, recipient allowlist, taint, links
                       │              confirm → asks the user via MCP elicitation
                       │ results      scan + strip untrusted links (also inside base64) + spotlight
                       └ audit.jsonl  every decision, for later review
```

The gateway cannot see the user's prompt, so the capabilities that the harness derives from it come from a config file, and anything the config cannot decide is turned into a **confirmation prompt** shown to the user:

```json
{
  "owner": "me@example.com",
  "recipients": ["teammate@example.com"],
  "trustedDomains": ["example.com"],
  "unknownRecipient": "confirm",
  "sinkAfterUntrusted": "confirm",
  "tools": {
    "read_email": { "source": "untrusted" },
    "read_notes": { "source": "sensitive" },
    "send_email": { "sink": { "recipient": "to", "content": ["body"] } },
    "delete_all": { "access": "deny" }
  },
  "audit": "warden-audit.jsonl"
}
```

Rules, in order: a static `access` rule per tool; for sinks, secrets seen in `sensitive` output may only go to the owner, links must point to trusted domains, recipients outside the allowlist need confirmation, and once third-party text has entered the session any sink to someone other than the owner needs confirmation. If the client does not support elicitation, `confirm` becomes `deny`.

Wire it into a client by replacing the server's command:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/agent-warden/src/gateway/cli.ts",
        "--config",
        "/path/to/warden.json",
        "--",
        "npx",
        "-y",
        "some-gmail-mcp-server"
      ]
    }
  }
}
```

### Gateway results

Same 104 attacks and 12 benign tasks, with the agent's tools behind the gateway (`examples/aiko-world.json`). Since the gateway asks instead of guessing, each run fixes how a simulated user answers every prompt: **decline** (careful) or **approve** (rubber-stamping, the worst case).

| Scripted worst-case agent          | Attack success | Attacks that reached a prompt | Benign utility | Benign tasks needing a prompt |
| ---------------------------------- | -------------- | ----------------------------- | -------------- | ----------------------------- |
| Full gateway, user declines        | 0.0% · 0/104   | 0/104                         | 83.3% · 10/12  | 2/12                          |
| Full gateway, user approves        | 0.0% · 0/104   | 0/104                         | 100.0% · 12/12 | 2/12                          |
| No scan layer, user declines       | 6.7% · 7/104   | 42/104                        | 83.3% · 10/12  | 2/12                          |
| No scan layer, user approves       | 47.1% · 49/104 | 42/104                        | 100.0% · 12/12 | 2/12                          |
| No scan + no output, user approves | 76.0% · 79/104 | 48/104                        | 100.0% · 12/12 | 2/12                          |
| qwen3:8b, full gateway             | _in progress_  | _in progress_                 | _in progress_  | _in progress_                 |

What this shows: with the scan layer off, confirmation prompts do the work, so their quality depends entirely on the user. That is why the content layers matter even with a policy in place. The two benign tasks that need a prompt (forwarding an email, messaging a teammate after reading the inbox) are the price of not seeing the user's prompt.

```bash
npm run eval:gateway -- --model scripted                  # both simulated users
npm run eval:gateway -- --model scripted --ablate scan    # turn layers off
npm run eval:gateway -- --model ollama:qwen3:8b
```

## Layout

```
src/world.ts          simulated inbox, deadlines, notes, contacts; every side effect is recorded
src/tools.ts          8 tools, each tagged untrusted / sensitive / trusted, sinks marked
src/agent.ts          the agent loop; every tool hop passes through the firewall
src/firewall/         intent, spotlight, scanner, policy (+ taint), output filter
src/dataset/          attack generator + scoring, benign tasks + checks
src/eval/             runner (resumable JSONL), report (ASR with Wilson 95% CI), gateway eval
src/gateway/          MCP stdio proxy: config, engine (policy + layers), proxy, CLI
examples/             gateway config for the evaluation world
test/                 unit tests per layer, end-to-end with the scripted agent, gateway + stdio proxy
```

## Limitations (read before quoting numbers)

- **Static attacks.** The attacks are fixed templates, not an adaptive attacker that iterates against the defense. Adaptive attacks typically break pattern-based layers; the policy layer is the part designed to hold regardless of wording.
- **Same author for attacks and scanner.** The scanner was written with these techniques in mind, so its standalone numbers are optimistic. The policy and output layers do not look at wording at all.
- **Intent extraction is rule-based** on the user prompt (Indonesian/English keywords). A real deployment would need a stricter planner or explicit confirmation for sinks.
- **Small world, one local model.** 104 attacks × 1 model at temperature 0. Confidence intervals are reported; treat differences of a few points as noise.
- **Gateway confirmations are simulated** as always-decline or always-approve. Real users sit in between, and prompt fatigue pushes them toward approve.
- `suppress_deadline` is a "soft" goal: no tool call happens, so only the model's own judgement plus the scanner can stop it.
