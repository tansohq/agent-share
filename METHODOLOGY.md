# Methodology

This document explains how agent-share produces its numbers, where they are wrong,
in which direction they are wrong, and what would make you stop trusting them. Read
it before quoting the report.

## 1. Classification model

Every request gets exactly one verdict from the strongest signal present. Signals
are checked in order in `src/classify.ts`; the first hit wins. There is no scoring
blend, no ML, and no per-request ambiguity: a given request always maps to one
signal, one verdict, one confidence.

| Order | Signal | Verdict | Confidence | Why this confidence |
|-------|--------|---------|------------|---------------------|
| 1 | `ck_live_` / `ck_test_` key in `Authorization` or `X-Api-Key` | agent | certain | The key is issued by your own system through the agent signup path. Machine-originated by construction, not inference. |
| 2 | `Signature-Agent` header | agent | strong | Web Bot Auth identity header. Cryptographically verifiable in principle; agent-share does not yet verify the signature, so strong rather than certain. |
| 3 | `Signature` + `Signature-Input` headers together | agent | strong | HTTP Message Signatures pair used by Web Bot Auth. Same caveat as above. |
| 4 | Known agent user-agent substring (GPTBot, ClaudeBot, python-httpx, curl/, ...) | agent | moderate | A user-agent is a string the client chooses. See the verification layer in section 4 for how a subset of these claims gets checked. |
| 5 | Machine-shaped route (`/llms.txt`, `*.md`, `pricing.json`, `/mcp/*`, `/.well-known/ai*`) | agent | moderate | These routes exist for machines; humans rarely type them. But "rarely" is not "never". |
| 6 | Browser UA plus `Referer` or `Accept-Language` | human | moderate | Full browser context. Spoofable, which is why it is not strong. |
| 7 | Browser UA with neither `Referer` nor `Accept-Language` | unknown | weak | Browser-shaped but missing headers real browsers send. A weak machine tell, not proof either way. |
| 8 | No user-agent at all | unknown | weak | Machine-shaped but unproven. |
| 9 | Anything else | unknown | weak | No usable signal. |

The confidence labels are ordinal, not probabilities. `certain` means true by
construction. `strong` means forgery requires deliberate effort against a
cryptographic scheme. `moderate` means the signal is honest by default but trivially
forgeable. `weak` means the signal barely discriminates.

### Verified, claimed, spoofed

Signal 4 verdicts carry a second dimension from `src/verify.ts`:

- **verified**: the UA claims a vendor bot whose published IP ranges we hold, and the
  request IP falls inside those ranges. The claim checks out.
- **claimed**: the UA matches an agent marker but either no vendor publishes ranges
  for it (curl, python-httpx, most agents), the vendor list failed to load, or no IP
  was available. The claim is unchecked, not disproven.
- **spoofed**: the UA claims a vendor bot (say GPTBot) but the IP is outside every
  range that vendor publishes. This is affirmative evidence of lying, and the request
  is counted as `unknown`, not `agent`. A liar's word is not evidence in either
  direction.

Most agent traffic will sit in `claimed`, because most agent user-agents have no
published ranges to check against. That is expected and is why the report label says
`estimated`.

## 2. Error model

Every signal has a known direction of error. They do not cancel neatly, but they do
not need to, because the dominant error runs one way.

**Agents pretending to be browsers: undercount, and a large one.** An agent that
sends a stock Chrome UA with plausible headers lands in signal 6 and is counted
human. This is not a corner case. Quantum Metric's 2026 research found roughly 80%
of AI agents do not identify themselves as automated traffic
(https://www.quantummetric.com/blog/agentic-commerce-research). A UC Davis study
from May 2026 tested seven AI browsing agents against a commercial bot-detection
provider: the provider caught 1 of 7, while behavioral classifiers built for the
study caught 7 of 7 (https://arxiv.org/abs/2505.21808). agent-share is header-based,
not behavioral, so it sits closer to the commercial provider's side of that result
for browser-disguised agents. Assume this bucket leaks heavily into `human`.

**curl and python UAs: overcount.** Signal 4 counts `curl/`, `python-requests`,
`python-httpx`, and similar as agents. Some of that traffic is a human developer
poking your API from a terminal. There is no header-level way to separate a person
running curl from a script running curl. Direction of error: inflates `agent`.

**Machine-shaped routes: overcount.** Signal 5 counts a fetch of `/llms.txt` or
`pricing.json` as an agent. A curious human who read about llms.txt can type the
URL into a browser. In practice signal 5 only fires when no browser UA matched
signal 4 first, which filters most curious humans into signal 6 before the route
check runs, but hand-rolled requests with odd UAs still slip through. Direction of
error: inflates `agent`, mildly.

**Net direction: the agent share is a floor.** The overcounts are bounded and small:
they require a human to behave in machine-shaped ways (terminal tools, typing
machine routes), which is a minority behavior of a minority of visitors. The
undercount is unbounded and large: it covers every agent that ships a browser UA,
which the citations above suggest is the majority of agent traffic. When a bounded
small overcount competes with an unbounded large undercount, the net error runs
negative. Read the reported agent share as "at least this much" and never as a
point estimate.

## 3. The unknown bucket

`unknown` is reported as a first-class number rather than folded into `human` (the
common silent default) or `agent` (the flattering one). Two reasons.

First, honesty about the floor argument. The floor claim in section 2 only holds if
ambiguous traffic is not being quietly assigned. The moment `unknown` gets folded
into either bucket, the direction-of-error reasoning breaks.

Second, the size of the bucket is itself a health metric for the classifier. A small
unknown share means the signal ladder is covering your traffic. A growing one means
your traffic is shifting toward shapes the ladder cannot read.

**Threshold: above 20% unknown, do not quote the headline share.** The reasoning:
the headline number implicitly asserts that the classified portion represents the
whole. Unknown traffic is not a random sample of all traffic; it is selected for
having stripped or odd headers, which correlates with being machine traffic (signals
7 and 8 are both machine tells too weak to act on). At 20% unknown, resolving the
bucket entirely one way would move a 50% agent share by 20 points, taking it
anywhere from 40% to 60% of the classified-plus-unknown total. A number with a
20-point swing from a single unresolved bucket is not a number, it is a range, and
should be reported as one. Below 20% the swing stays inside the error band the
signal ladder already implies. The threshold is a judgment call, not a derivation;
the point of stating it is that a threshold exists at all and is stated before the
data comes in, not after.

## 4. Verification

Signature-based classification is a claim pipeline. The verification layer checks
claims where checking is possible.

**Vendor-published IP ranges.** OpenAI and Anthropic publish the IP ranges their
crawlers use: https://openai.com/gptbot.json, https://openai.com/chatgpt-user.json,
https://openai.com/searchbot.json, and https://www.anthropic.com/claudebot.json. A
request claiming one of these UAs is checked against the matching ranges (CIDR
matching in `src/verify.ts`, IPv4 and IPv6, no dependencies). Cloudflare Radar's
verified-bots directory (https://radar.cloudflare.com/traffic/verified-bots) serves
as a cross-check when a vendor's own list looks stale or a new bot appears without
published ranges.

**Ranges are moving controls, not constants.** Vendors add and rotate ranges.
agent-share fetches at startup and refreshes on an interval. A fetch failure
degrades that vendor's claims to `claimed` rather than breaking classification; a
stale cached list can misclassify a genuinely new vendor IP as `spoofed`, which is
the conservative failure (the request drops to `unknown`, not to `human`). Never
hardcode ranges into config.

**Web Bot Auth is the endgame.** IP range checking is a stopgap that only works for
vendors big enough to publish ranges. Web Bot Auth
(https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/) puts a
cryptographic signature on the request itself, which verifies any agent that adopts
it regardless of where it runs. When signature verification lands in agent-share,
signals 2 and 3 move from `strong` to `certain` for requests whose signatures
validate, and the estimated/exact boundary in the report moves with them.

## 5. Precision measurement

The error model in section 2 is an argument. Measurement replaces argument.

**Protocol.** `scripts/label.ts` draws a uniform random sample of stored
observations (the JSONL rows: timestamp, path, verdict, signal) and presents them
for hand labeling. The labeler assigns ground truth per row using evidence outside
the classifier's inputs where available: session context, whether the path sequence
resembles human navigation, whether the request pattern matches a known deploy or
cron, and account data in connected mode. Rows the labeler cannot decide are marked
undecidable and excluded from precision math but reported as a count, for the same
reason unknown is reported in section 3.

**What gets published with every report.** Per-verdict precision (of requests we
called agent, how many were agents) and recall (of true agents in the sample, how
many we caught), the sample size, the sampling window, and the undecidable count.
Recall against browser-disguised agents is the number the UC Davis result says to
watch, and it is the one a header-based classifier will score worst on. Publishing
a bad recall number is the point; a methodology that only publishes flattering
metrics is marketing.

Minimum sample size is 100 labeled rows per published report. Below that the
per-verdict metrics have confidence intervals too wide to mean anything.

## 6. What is never collected

- **IP addresses are checked in memory and never stored.** The CIDR check in
  `src/verify.ts` runs against the live request; the observation row written to
  disk contains no IP.
- **No request or response bodies.** Ever.
- **No stored headers.** The classifier reads headers in memory and stores only its
  output: verdict, confidence, signal name, path, timestamp, and revenue cents when
  the application reports it.
- **No phone-home.** Observations append to a local JSONL file on your
  infrastructure. No data leaves your machine.

The stored signal name can embed a UA substring match (for example `ua:gptbot`) or
a path (`route:/llms.txt`). Paths can contain identifiers if your URL scheme puts
identifiers in paths; that is a property of your routes, not of agent-share, but
worth knowing before you share a raw JSONL file.
