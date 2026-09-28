# Agent research receipts (2026-09-28)

An **AgentResearchReceipt** is a small JSON document an autonomous agent can publish after it
researched something on Robinhood Chain. It says one thing: *"I reached this conclusion from these
facts, as of this time."*

It is **neutral and project-agnostic**. It works the same for HoodLock, OrdoFi, Pons, HEY or any
other project — HEY defines the shape and checks that the HEY evidence a receipt cites exists. HEY
does **not** store receipts, count them, rank them, aggregate them into a consensus, or endorse a
conclusion. A receipt is never a HEY signal and never an instruction to anyone else.

- JSON Schema (draft 2020-12): `https://heyresearch.xyz/schemas/agent-research-receipt.v1.json`
- Validator: `POST https://heyresearch.xyz/api/receipts/validate` (`GET` describes it)
- Source of truth in code: `packages/domain/src/receipts/schema.ts` (the Zod schema the validator
  runs and the JSON Schema it publishes, held equal by a test)

## What a receipt carries

| Field | Meaning |
| --- | --- |
| `type`, `version` | `"AgentResearchReceipt"`, `"1.0"` |
| `agentId` | The agent's own identifier — a URL, a DID or a name. HEY does not verify it. |
| `operator`, `mandate` | Optional, self-declared: who runs the agent and what it is for. |
| `subjectType`, `subject` | `project`, `token` or `contract`, with `chainId` and the slug, token contract or contract. |
| `createdAt`, `evidenceCutoff` | When the receipt was written, and the newest evidence that informed it (never later). |
| `thesisSummary` | The concise rationale, at most 600 characters. **Not a reasoning trace.** |
| `claims[]` | Each `FACT` (recorded, cited), `DERIVED` (a rule the agent applied to cited facts) or `JUDGEMENT` (the agent's own view). A FACT or DERIVED claim cites at least one piece of evidence. |
| `risks[]`, `unknowns[]` | What could make the conclusion wrong, and what the agent could not establish. |
| `researchState` | The agent's own state (`value`), with **its own definition** and, optionally, a vocabulary URL. |
| `outcome` | Optional: what the agent decided under its own mandate, `decidedBy: "agent"` always. |
| `confidence` | Optional: the agent's own 0–1, or null. |
| `reviewConditions[]` | What would make the agent look again, and what it watches. |
| `sourceSystems[]` | Where the evidence came from: HEY, another system, or several. |
| `signature` | Optional detached signature by the agent. HEY does not verify it. |

Evidence references are one of five kinds:

- `hey_evidence` — a HEY typed evidence id (`ship:`, `signal:`, `abi:`, `impl:`, `lock:`, `source:`,
  `claim:`, `state:`, `narrative:`, `method:`, `sourcechange:`), resolvable at `/api/evidence/{id}`;
- `hey_change_event` — a ChangeEvent id from `/api/changes`, with the revision read;
- `hey_snapshot` — a project snapshot as read: the slug, its `asOf`, the `scoringVersion`;
- `market_observation` — a market reading: its provider and the time the provider observed it, and
  which figure (`marketCap`, `fdv`, `price`, `liquidity`, `volume24h`) — never a price target;
- `external` — any other public `https://` URL and when the agent read it. HEY never fetches it.

Unknown top-level fields are refused, so there is no place to put a private chain-of-thought.

## The agent's vocabulary, not HEY's

`researchState.value` and `outcome.value` are free strings the agent defines. Common ones:

| Value | A typical definition an agent might give |
| --- | --- |
| `PASS` | Does not meet this agent's mandate; no further work planned. |
| `MONITOR` | Evidence of continued activity; revisit on a named condition. |
| `RESEARCH_MORE` | Evidence mixed or incomplete for this mandate. |
| `HOLD_EXISTING` | An existing position is kept under the agent's own policy. |
| `PROPOSE_ALLOCATION` | The agent proposes, to whoever governs it, an allocation it may not execute itself. |
| `INSUFFICIENT_EVIDENCE` | The evidence does not support any conclusion yet. |

HEY attaches no meaning to these and never turns one into a recommendation. An agent that uses a
state such as `HIGH RESEARCH CONVICTION` defines it in `researchState.definition`.

## Checking a receipt

```bash
curl -s https://heyresearch.xyz/api/receipts/validate \
  -H 'content-type: application/json' --data @receipt.json
```

The answer says whether the shape is valid (`errors` lists what is not, with paths), whether the
subject project is published, and, for each cited HEY id, `exists`, `withdrawn` (with HEY's reason),
`moved`, `not_found`, `invalid_id` or `not_checked` (another chain, a non-HEY reference, or past the
limit of 25 HEY ids per receipt). `heyEvidenceStands` is true when every HEY id checked exists and
stands. The answer always carries `stored: false` and `endorsement: false`.

Limits: 64 KB of JSON per receipt, 30 checks a minute per client. Nothing the receipt names is
fetched, whatever URL it contains.

## Example: a project that is not HEY

The ids are illustrative; a real receipt cites ids it read from HEY. The outcome is the example
agent's own, under its stated mandate.

```json
{
  "type": "AgentResearchReceipt",
  "version": "1.0",
  "agentId": "https://agent.example.org/research-bot",
  "operator": "Example Research Collective",
  "mandate": "Monitor Robinhood Chain infrastructure projects for continued development; no allocation authority.",
  "subjectType": "project",
  "subject": { "chainId": 4663, "projectSlug": "hoodlock" },
  "createdAt": "2026-09-28T12:00:00Z",
  "evidenceCutoff": "2026-09-28T11:45:00Z",
  "thesisSummary": "The project shipped twice in the last 30 days and its lock contract is verified; its token market reading is older than HEY's freshness limit, so market context is set aside.",
  "claims": [
    { "statement": "A release was published on 2026-09-21.", "kind": "FACT", "evidence": [{ "kind": "hey_evidence", "id": "ship:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f" }] },
    { "statement": "HEY lists the activity status as SHIPPING under its published rule.", "kind": "DERIVED", "evidence": [{ "kind": "hey_snapshot", "project": "hoodlock", "asOf": "2026-09-28T11:40:00Z", "scoringVersion": "hbm-v16" }] },
    { "statement": "Development cadence looks steady to this agent.", "kind": "JUDGEMENT", "evidence": [] }
  ],
  "risks": [{ "statement": "The market reading is stale; liquidity today is not known from this evidence.", "evidence": [{ "kind": "market_observation", "source": "geckoterminal", "observedAt": "2026-09-26T08:00:00Z", "field": "liquidity" }] }],
  "unknowns": [{ "statement": "HEY holds no package registry source for this project.", "coverageDimension": "package" }],
  "researchState": { "value": "MONITOR", "definition": "Evidence of continued development; revisit on the next release or a coverage change.", "vocabulary": "https://agent.example.org/vocabulary/v1" },
  "outcome": { "value": "MONITOR", "decidedBy": "agent", "definition": "Keep watching; no action under this mandate." },
  "confidence": 0.6,
  "reviewConditions": [{ "condition": "A new release or a status change for the project.", "watch": "GET /api/changes?project=hoodlock&after=<cursor>" }],
  "sourceSystems": [{ "name": "HEY Research Lab", "url": "https://heyresearch.xyz", "apiVersion": "1" }]
}
```

## Example: HEY itself, written the same way

```json
{
  "type": "AgentResearchReceipt",
  "version": "1.0",
  "agentId": "did:web:agent.example.org",
  "mandate": "Assess research-infrastructure tokens on Robinhood Chain; may propose, never execute, an allocation.",
  "subjectType": "token",
  "subject": { "chainId": 4663, "projectSlug": "hey-research-lab", "tokenContract": "0x0000000000000000000000000000000000000001" },
  "createdAt": "2026-09-28T12:30:00Z",
  "evidenceCutoff": "2026-09-28T12:25:00Z",
  "thesisSummary": "HEY's own project shows recent ships and a hosted MCP in use; of its documented token utilities some are LIVE and others PLANNED per /api/hey/profile, and the valuation reading is an FDV, not a market cap.",
  "claims": [
    { "statement": "The profile lists Request Research as LIVE on this deployment.", "kind": "FACT", "evidence": [{ "kind": "external", "url": "https://heyresearch.xyz/api/hey/profile", "retrievedAt": "2026-09-28T12:25:00Z" }] },
    { "statement": "HEY recorded a release for its own project this week.", "kind": "FACT", "evidence": [{ "kind": "hey_change_event", "id": "ship:0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", "revision": 1 }] },
    { "statement": "Planned utilities are not counted as value by this agent.", "kind": "JUDGEMENT", "evidence": [] }
  ],
  "risks": [
    { "statement": "The valuation HEY holds is FDV; circulating supply differs.", "evidence": [{ "kind": "market_observation", "source": "dexscreener", "observedAt": "2026-09-28T12:00:00Z", "field": "fdv" }] },
    { "statement": "Liquidity depth is modest relative to this agent's minimum." }
  ],
  "unknowns": [{ "statement": "Whether the monthly treasury ledger has been published is not checked by the profile." }],
  "researchState": { "value": "RESEARCH_MORE", "definition": "Evidence is mixed or incomplete for this agent's mandate." },
  "outcome": { "value": "RESEARCH_MORE", "decidedBy": "agent", "definition": "Collect another month of evidence before any proposal." },
  "confidence": null,
  "reviewConditions": [{ "condition": "The first monthly treasury ledger entry, or a utility moving from PLANNED to LIVE.", "watch": "GET /api/hey/profile" }],
  "sourceSystems": [{ "name": "HEY Research Lab", "url": "https://heyresearch.xyz", "apiVersion": "1" }]
}
```

## What was deliberately not built

- **No storage and no aggregate.** A surface that counted receipts or showed "agent research
  states" would only be honest with genuinely independent agents and operators behind it. None
  exist yet, and HEY will not create agent identities, run clones of one strategy, or present
  anything as consensus. If independent agents publish signed receipts later, a neutral aggregate
  (participants, states as each agent defined them, evidence cutoffs) is a founder decision.
- **No execution.** HEY provides research, evidence, receipts and monitoring. Any trade is a
  separately authorised decision of an external agent under its own risk policy; HEY runs no
  execution network and no copy-trade loop.
- **No self-preference.** A receipt about HEY is checked exactly like a receipt about any project,
  and nothing about receipts reaches activity status, Build Momentum, the Discovery Gap or the
  Builder Radar.
