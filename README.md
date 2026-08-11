# agent-share

**What share of your traffic — and your revenue — came from a machine?**

Nobody publishes this number. AI agents are already the majority of documentation
traffic for API companies, but no operator can say what share of their own signups,
API calls, or dollars are machine-originated. `agent-share` is an Express middleware
that answers that question, locally, with honest confidence levels.

```
  agent-share report  (estimated)
  ────────────────────────────────────────────────
  agent    ███████████████████████             66.2%  (192)
  human    █████████                           27.9%  (81)
  unknown  ░░                                   5.9%  (17)
  ────────────────────────────────────────────────
  290 requests · agent share of traffic 66.2%
  $194.00 revenue · agent share of revenue 10.3%
```

## Install

```bash
npm install @tansohq/agent-share
```

```js
import express from 'express';
import { agentShare } from '@tansohq/agent-share';

const app = express();
const share = agentShare({ path: './agent-share.jsonl' });
app.use(share);

// Optional: attribute revenue to the request that produced it.
app.post('/checkout/complete', (req, res) => {
  share.revenue(req, 2900); // cents
  res.sendStatus(200);
});

// Print the report anywhere (or call share.report() for JSON).
console.log(share.print());
```

## How classification works

Each request gets a verdict — `agent`, `human`, or `unknown` — from the strongest
available signal:

| # | Signal | Verdict | Confidence |
|---|--------|---------|------------|
| 1 | Customer-scoped `ck_` key ([tanso-oss](https://github.com/katrinalaszlo) agent signup) | agent | **certain** |
| 2 | Web Bot Auth signature / `Signature-Agent` header | agent | strong |
| 3 | Known agent user-agent (GPTBot, Claude, python-httpx, …) | agent | moderate |
| 4 | Machine-shaped route (`llms.txt`, `*.md`, `pricing.json`, `/mcp`) | agent | moderate |
| 5 | Full browser context (UA + referer + accept-language) | human | moderate |
| 6 | Everything else | unknown | weak |

Two properties are deliberate:

- **`unknown` is reported, not hidden.** A browser UA with no referer and no
  accept-language is not proof of a human, and the size of the unknown bucket is
  itself a finding.
- **The report says `estimated` unless every verdict is certain.** Signature-based
  detection is inference. If your product issues customer-scoped agent keys
  (tanso-oss `ck_` keys), attribution stops being an estimate — a request carrying
  one is machine-originated by construction.

## Privacy

Local only. Observations are appended to a JSONL file on your infrastructure. No
phone-home, no account, no data leaves your machine. Observed fields: timestamp,
path, verdict, signal, optional revenue cents. No IPs, no bodies, no headers stored.

## What it is not

- **Not a bot blocker.** It observes and reports; it never rejects a request.
- **Not analytics.** One question, two numbers.
- **Not reconciliation.** Revenue means dollars you report to it, not a tie-out
  against your billing system.

## Demo

```bash
npm run demo   # replays a synthetic day of traffic and prints the report
npm test       # 11 tests
```

## License

MIT
