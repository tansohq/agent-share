# agent-share

**What share of your traffic and your revenue came from a machine?**

Nobody publishes this number. AI agents are already the majority of documentation
traffic for API companies, yet no operator can say what share of their own signups,
API calls, or dollars are machine-originated. `agent-share` is an Express middleware
that answers that question locally, with honest confidence levels.

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

// Print the report anywhere, or call share.report() for JSON.
console.log(share.print());
```

## How classification works

Each request gets a verdict of `agent`, `human`, or `unknown` from the strongest
available signal:

| # | Signal | Verdict | Confidence |
|---|--------|---------|------------|
| 1 | Customer-scoped `ck_` key ([tanso-oss](https://github.com/katrinalaszlo) agent signup) | agent | **certain** |
| 2 | Web Bot Auth signature or `Signature-Agent` header | agent | strong |
| 3 | Known agent user-agent (GPTBot, Claude, python-httpx, …) | agent | moderate |
| 4 | Machine-shaped route (`llms.txt`, `*.md`, `pricing.json`, `/mcp`) | agent | moderate |
| 5 | Full browser context (UA + referer + accept-language) | human | moderate |
| 6 | Everything else | unknown | weak |

Two properties are deliberate.

First, `unknown` is reported rather than hidden. A browser UA with no referer and no
accept-language is not proof of a human, and the size of the unknown bucket is itself
a finding.

Second, the report says `estimated` unless every verdict is certain, because
signature-based detection is inference. If your product issues customer-scoped agent
keys (tanso-oss `ck_` keys), attribution stops being an estimate. A request carrying
one is machine-originated by construction.

## Can't a request just lie?

Yes. A user-agent is a string the client chooses, so signature-based verdicts are
claims rather than proof. Two consequences are built in.

The error runs one way. Agents pretending to be browsers make the count miss agents,
while there is little reason to falsely claim being GPTBot. Read the estimated agent
share as a floor.

And two signals can't lie. A Web Bot Auth signature is cryptographic, and a
customer-scoped `ck_` key is machine-originated by construction because your own
system issued it through the agent signup path. Inference is scaffolding; identity
you issue is the real answer. That is why the report distinguishes `estimated` from
`exact` instead of pretending one number.

## Verification

A subset of user-agent claims can be checked. OpenAI and Anthropic publish the IP
ranges their crawlers use, so a request claiming to be GPTBot or ClaudeBot can be
compared against them. A UA match with an IP inside the published range is
`verified`. A UA match with no IP to check, or a UA no published range vouches for,
stays `claimed`. A UA match with an IP outside every published range is `spoofed`
and counted as unknown rather than agent, since a request lying about its identity
has forfeited the benefit of the doubt.

Turn it on with the `verifyRanges` option:

```js
const share = agentShare({ path: './agent-share.jsonl', verifyRanges: true });
```

Ranges are fetched at startup and refreshed on an interval. The IP is used for the
in-memory check only and is never stored. The full model, including where it is
wrong and in which direction, is in [METHODOLOGY.md](METHODOLOGY.md).

## Collecting from Vercel

The middleware pattern also works as an edge function that logs one line per request.
Pipe your runtime logs through the collector to build the report from production
traffic:

```bash
vercel logs your-domain.com --json --follow | node collector/vercel.ts data/observations.jsonl
```

## Privacy

Local only. Observations are appended to a JSONL file on your infrastructure. No
phone-home, no account, and no data leaves your machine. Observed fields are the
timestamp, path, verdict, signal, and optional revenue cents. No IPs, no bodies,
no stored headers.

## What it is not

It is not a bot blocker. It observes and reports and never rejects a request. It is
not analytics either, just one question and two numbers. And revenue means dollars
you report to it, not a reconciliation against your billing system.

## Demo

```bash
npm run demo        # replays a synthetic day of traffic and prints the report
npm test            # full test suite
npm run label       # sample observations and hand-label them against the classifier
npm run precision   # confusion matrix and per-verdict precision from your labels
```

## License

MIT
