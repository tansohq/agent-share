// Demo: replay a synthetic day of traffic through the classifier and print
// the report. No server needed — the middleware is exercised directly.

import { rmSync } from 'node:fs';
import { agentShare } from '../src/index.ts';

rmSync('./demo/agent-share.jsonl', { force: true });
const mw = agentShare({ path: './demo/agent-share.jsonl' });

const next = () => {};
const hit = (path: string, headers: Record<string, string>, revenueCents?: number) => {
  const req: any = { path, headers };
  mw(req, {}, next);
  if (revenueCents) mw.revenue(req, revenueCents);
};

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  referer: 'https://www.google.com/',
  'accept-language': 'en-US,en',
};

// A plausible day for a small API company with public docs.

// Humans browsing the site and docs.
for (let i = 0; i < 38; i++) hit('/docs/quickstart', BROWSER);
for (let i = 0; i < 22; i++) hit('/pricing', BROWSER);
for (let i = 0; i < 9; i++) hit('/signup', BROWSER);

// Human-purchased usage: dashboard-provisioned key, browser session checkout.
for (let i = 0; i < 6; i++) hit('/checkout/complete', BROWSER, 2900);

// Agents reading the machine surface (the Mintlify pattern).
for (let i = 0; i < 41; i++) hit('/llms.txt', { 'user-agent': 'Claude-User/1.0' });
for (let i = 0; i < 33; i++) hit('/docs/quickstart.md', { 'user-agent': 'node' });
for (let i = 0; i < 17; i++) hit('/public/v1/catalog/acme/pricing.json', { 'user-agent': 'python-httpx/0.27' });

// Crawlers.
for (let i = 0; i < 24; i++) hit('/docs/api', { 'user-agent': 'GPTBot/1.2' });
for (let i = 0; i < 11; i++) hit('/', { 'user-agent': 'PerplexityBot/1.0' });

// Agents holding customer-scoped ck_ keys: metered usage and two credit top-ups.
const CK = { authorization: 'Bearer ck_test_51xYzDemo', 'user-agent': 'undici' };
for (let i = 0; i < 55; i++) hit('/api/v1/enrich', CK);
hit('/api/v1/topup', CK, 1000);
hit('/api/v1/topup', CK, 1000);

// A Web Bot Auth signed agent.
for (let i = 0; i < 7; i++)
  hit('/api/v1/enrich', { signature: 'sig1=:MEUCIQ==:', 'signature-input': 'sig1=("@authority")' });

// The murk: browser UA with no context, and no UA at all.
for (let i = 0; i < 12; i++) hit('/docs/quickstart', { 'user-agent': BROWSER['user-agent'] });
for (let i = 0; i < 5; i++) hit('/api/v1/enrich', {});

console.log(mw.print());

const r = mw.report();
console.log('  top signals:');
for (const [sig, n] of Object.entries(r.bySignal).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`    ${String(n).padStart(4)}  ${sig}`);
}
console.log('');
