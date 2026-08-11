// Adversarial tests: attack CIDR math, verifyClaim routing, XFF handling,
// and the privacy guarantee (IP never reaches the JSONL file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ipInCidr, verifyClaim, fetchVendorRanges, parseRangeDoc, type VendorRanges } from '../src/verify.ts';
import { classify } from '../src/classify.ts';
import { agentShare } from '../src/index.ts';

// --- 1. IPv4 CIDR math at the shift boundaries ---

test('ipv4 /32 matches only the exact host', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/32'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4/32'), false);
});

test('ipv4 /31 covers exactly the two-address pair', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/31'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4/31'), true);
  assert.equal(ipInCidr('1.2.3.6', '1.2.3.4/31'), false);
});

test('ipv4 /0 matches everything, /33 matches nothing', () => {
  assert.equal(ipInCidr('255.255.255.255', '0.0.0.0/0'), true);
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/33'), false);
});

// A trailing slash with no prefix length is malformed. Number('') === 0, so
// naive parsing turns "1.2.3.4/" into /0 — which matches EVERY IPv4 address
// and would verify any spoofer. Expected: malformed cidr matches nothing.
test('cidr with trailing slash and no bits matches nothing', () => {
  assert.equal(ipInCidr('9.9.9.9', '1.2.3.4/'), false);
  assert.equal(ipInCidr('9.9.9.9', '1.2.3.4/ 0'), false);
});

test('cidr with no slash is an exact-host match', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4'), false);
  assert.equal(ipInCidr('::1', '::1'), true);
  assert.equal(ipInCidr('::2', '::1'), false);
});

// Octets must be plain decimal digits. Number() accepts whitespace, '+',
// exponents, and '' (empty octet -> 0), so "1.2.3." would parse as 1.2.3.0
// and " 1.2.3.4" as 1.2.3.4. Expected: all rejected.
test('malformed ipv4 addresses never match', () => {
  assert.equal(ipInCidr(' 1.2.3.4', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('1.2.3.4 ', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('1.2.3.', '1.2.3.0/32'), false);
  assert.equal(ipInCidr('+1.2.3.4', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('1.1e1.3.4', '1.10.3.4/32'), false);
  assert.equal(ipInCidr('01.2.3.4', '1.2.3.4/32'), false);
  assert.equal(ipInCidr('1.2.3.256', '1.2.3.0/24'), false);
});

// --- 2. IPv6 math and :: expansion ---

test('ipv6 /128 matches only the exact host', () => {
  assert.equal(ipInCidr('::1', '::1/128'), true);
  assert.equal(ipInCidr('::2', '::1/128'), false);
});

test('ipv6 /127 covers exactly the pair', () => {
  assert.equal(ipInCidr('2001:db8::1', '2001:db8::/127'), true);
  assert.equal(ipInCidr('2001:db8::2', '2001:db8::/127'), false);
});

test(':: expansion edge cases', () => {
  assert.equal(ipInCidr('::', '::/128'), true);          // all-zeros
  assert.equal(ipInCidr('1::', '1::/128'), true);        // trailing ::
  assert.equal(ipInCidr('::1', '0:0:0:0:0:0:0:1/128'), true); // :: == full form
  assert.equal(ipInCidr('fe80::1', 'fe80::/10'), true);  // real link-local prefix
  assert.equal(ipInCidr('fec0::1', 'fe80::/10'), false); // just outside /10
  assert.equal(ipInCidr('::', '::/0'), true);
});

test('invalid ipv6 forms never match', () => {
  assert.equal(ipInCidr('1::2::3', '::/0'), false);           // invalid ip fails even at /0
  assert.equal(ipInCidr('1::2::3', '::/64'), false);
  assert.equal(ipInCidr('1:2:3:4:5:6:7:8:9', '::/64'), false);
  assert.equal(ipInCidr('1:2:3:4:5:6:7', '::/64'), false);    // 7 hextets, no ::
  assert.equal(ipInCidr('12345::', '::/64'), false);          // hextet too long
});

test('address-family mismatch never matches', () => {
  assert.equal(ipInCidr('1.2.3.4', '::/0'), false);
  assert.equal(ipInCidr('::1', '0.0.0.0/0'), false);
});

// --- 3. verifyClaim routing ---

const RANGES: VendorRanges[] = [
  { vendor: 'openai-gptbot', uaMarkers: ['gptbot'], cidrs: ['20.0.0.0/24'] },
  { vendor: 'anthropic-claudebot', uaMarkers: ['claudebot', 'claude-user', 'claude-searchbot'], cidrs: ['160.79.104.0/23', '2607:6bc0::/48'] },
];

test('verified when UA marker and IP both match the vendor', () => {
  assert.equal(verifyClaim('Mozilla/5.0 (compatible; ClaudeBot/1.0)', '160.79.104.7', RANGES), 'verified');
  assert.equal(verifyClaim('ClaudeBot/1.0', '2607:6bc0::1', RANGES), 'verified');
  assert.equal(verifyClaim('GPTBot/1.2', '20.0.0.9', RANGES), 'verified');
});

test('spoofed when UA claims a vendor but IP is outside its ranges', () => {
  assert.equal(verifyClaim('ClaudeBot/1.0', '8.8.8.8', RANGES), 'spoofed');
  // IP in ANOTHER vendor's range is still spoofed for this claim.
  assert.equal(verifyClaim('GPTBot/1.2', '160.79.104.7', RANGES), 'spoofed');
});

// "claude" alone (e.g. claude-code, or a random UA containing the word) has no
// published range list — it must stay "claimed", not get routed to the
// anthropic-claudebot vendor and come back "spoofed".
test('UA containing claude but no vendor marker stays claimed', () => {
  assert.equal(verifyClaim('claude-code/1.0', '8.8.8.8', RANGES), 'claimed');
  assert.equal(verifyClaim('MyClaudeFanSite/1.0', '8.8.8.8', RANGES), 'claimed');
});

test('claimed when no IP or no ranges are available', () => {
  assert.equal(verifyClaim('ClaudeBot/1.0', undefined, RANGES), 'claimed');
  assert.equal(verifyClaim('ClaudeBot/1.0', '', RANGES), 'claimed');
  assert.equal(verifyClaim('ClaudeBot/1.0', '8.8.8.8', []), 'claimed');
});

// A vendor entry with an empty cidrs list gives zero evidence either way.
// [].some() is false, so naive code calls that "spoofed" — an accusation with
// no data behind it. Expected: degrade to "claimed".
test('vendor with empty cidrs degrades to claimed, not spoofed', () => {
  const empty: VendorRanges[] = [{ vendor: 'anthropic-claudebot', uaMarkers: ['claudebot'], cidrs: [] }];
  assert.equal(verifyClaim('ClaudeBot/1.0', '8.8.8.8', empty), 'claimed');
});

// Some proxies write ports into x-forwarded-for ("1.2.3.4:5678", "[::1]:443").
// The middleware must strip the port before verification, or a real vendor
// bot behind such a proxy parses as garbage and gets branded a spoofer.
// End-to-end: stub fetch to serve the vendor ranges, wait for the lazy load,
// then confirm port-suffixed XFF values still verify.
test('port-suffixed x-forwarded-for still verifies a real vendor IP', async () => {
  const file = join(tmpdir(), `agent-share-adversarial-xff-${process.pid}.jsonl`);
  rmSync(file, { force: true });
  const doc = { prefixes: [{ ipv4Prefix: '160.79.104.0/23' }, { ipv6Prefix: '2607:6bc0::/48' }] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => doc })) as unknown as typeof fetch;
  try {
    const mw = agentShare({ path: file, verifyRanges: true });
    const claudeReq = (xff: string) => ({
      path: '/docs',
      headers: { 'user-agent': 'ClaudeBot/1.0', 'x-forwarded-for': xff },
    });
    mw(claudeReq('160.79.104.7'), {}, () => {}); // triggers the lazy range load
    await new Promise(r => setTimeout(r, 50));   // let the fetch resolve
    mw(claudeReq('160.79.104.7:5678, 10.0.0.1'), {}, () => {});
    mw(claudeReq('[2607:6bc0::1]:443'), {}, () => {});
    const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows[1].signal, 'verified:claude');
    assert.equal(rows[2].signal, 'verified:claude');
  } finally {
    globalThis.fetch = realFetch;
    rmSync(file, { force: true });
  }
});

// --- 4. classify integration with verification context ---

const req = (path: string, headers: Record<string, string> = {}) => ({ path, headers });

test('spoofed vendor UA classifies as unknown, never agent or human', () => {
  const c = classify(req('/docs', { 'user-agent': 'ClaudeBot/1.0' }), { ip: '8.8.8.8', ranges: RANGES });
  assert.equal(c.verdict, 'unknown');
  assert.equal(c.signal, 'spoofed-ua:claude');
});

test('verified vendor UA upgrades to strong agent', () => {
  const c = classify(req('/docs', { 'user-agent': 'ClaudeBot/1.0' }), { ip: '160.79.104.7', ranges: RANGES });
  assert.equal(c.verdict, 'agent');
  assert.equal(c.confidence, 'strong');
});

test('empty ranges (fetch not resolved yet) keeps the moderate ua default', () => {
  const c = classify(req('/docs', { 'user-agent': 'ClaudeBot/1.0' }), { ip: '8.8.8.8', ranges: [] });
  assert.equal(c.verdict, 'agent');
  assert.equal(c.confidence, 'moderate');
});

// --- 5. range fetch resilience ---

test('fetchVendorRanges survives total network failure and skips non-ok responses', async () => {
  const failing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  assert.deepEqual(await fetchVendorRanges(undefined, failing), []);

  const notOk = (async () => ({ ok: false })) as unknown as typeof fetch;
  assert.deepEqual(await fetchVendorRanges(undefined, notOk), []);
});

test('parseRangeDoc handles both documented shapes and garbage', () => {
  assert.deepEqual(parseRangeDoc({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }, { ipv6Prefix: '::/64' }, { junk: 1 }] }), ['1.2.3.0/24', '::/64']);
  assert.deepEqual(parseRangeDoc(['1.2.3.0/24', 42]), ['1.2.3.0/24']);
  assert.deepEqual(parseRangeDoc(null), []);
  assert.deepEqual(parseRangeDoc('nope'), []);
});

// --- 6. privacy: the client IP never reaches the JSONL file ---

test('JSONL rows contain no IP and no headers, even with x-forwarded-for set', () => {
  const file = join(tmpdir(), `agent-share-adversarial-${process.pid}.jsonl`);
  rmSync(file, { force: true });
  const mw = agentShare({ path: file });
  const request = {
    path: '/docs',
    ip: '203.0.113.9',
    headers: { 'user-agent': 'GPTBot/1.2', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
  };
  mw(request, {}, () => {});
  mw.revenue(request, 500);
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  rmSync(file, { force: true });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      row.revenueCents !== undefined
        ? ['confidence', 'path', 'revenueCents', 'signal', 'ts', 'verdict']
        : ['confidence', 'path', 'signal', 'ts', 'verdict'],
    );
    assert.equal(JSON.stringify(row).includes('203.0.113.9'), false);
  }
});
