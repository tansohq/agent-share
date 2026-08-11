import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInCidr, parseRangeDoc, verifyClaim, fetchVendorRanges } from '../src/verify.ts';
import type { VendorRanges } from '../src/verify.ts';

// --- ipInCidr: IPv4 ---

test('ipv4 /32 matches only the exact address', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4/32'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4/32'), false);
});

test('ipv4 bare address (no slash) is treated as /32', () => {
  assert.equal(ipInCidr('1.2.3.4', '1.2.3.4'), true);
  assert.equal(ipInCidr('1.2.3.5', '1.2.3.4'), false);
});

test('ipv4 /24 boundary addresses', () => {
  assert.equal(ipInCidr('10.0.1.0', '10.0.1.0/24'), true);    // first in range
  assert.equal(ipInCidr('10.0.1.255', '10.0.1.0/24'), true);  // last in range
  assert.equal(ipInCidr('10.0.0.255', '10.0.1.0/24'), false); // one below
  assert.equal(ipInCidr('10.0.2.0', '10.0.1.0/24'), false);   // one above
});

test('ipv4 /0 matches everything valid', () => {
  assert.equal(ipInCidr('0.0.0.0', '0.0.0.0/0'), true);
  assert.equal(ipInCidr('255.255.255.255', '0.0.0.0/0'), true);
  assert.equal(ipInCidr('8.8.8.8', '192.168.0.0/0'), true); // range value irrelevant at /0
});

test('ipv4 /0 still rejects an invalid ip', () => {
  assert.equal(ipInCidr('256.1.1.1', '0.0.0.0/0'), false);
});

test('ipv4 invalid address strings are false, not thrown', () => {
  assert.equal(ipInCidr('256.1.1.1', '10.0.0.0/8'), false);  // octet out of range
  assert.equal(ipInCidr('01.2.3.4', '10.0.0.0/8'), false);   // leading zero
  assert.equal(ipInCidr('1.2.3', '10.0.0.0/8'), false);      // three octets
  assert.equal(ipInCidr('a.b.c.d', '10.0.0.0/8'), false);    // not numbers
  assert.equal(ipInCidr('', '10.0.0.0/8'), false);
});

test('ipv4 invalid range side is false', () => {
  assert.equal(ipInCidr('10.0.0.1', '10.0.0/8'), false);      // malformed range
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.0/33'), false);   // prefix too long
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.0/-1'), false);   // negative prefix
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.0/8.5'), false);  // non-integer prefix
});

// BUG (documented, not fixed): a trailing slash with an empty prefix length is
// treated as /0 because Number('') === 0, so any valid IPv4 matches a malformed
// CIDR like '9.9.9.9/'. Failing input: ipInCidr('1.2.3.4', '9.9.9.9/') === true,
// expected false. Same applies to IPv6 ('::1/' matches any valid IPv6).
test.todo("malformed CIDR with empty prefix length ('9.9.9.9/') should be false, currently matches everything");

test('ipv4 zero octets are fine, only multi-digit leading zeros rejected', () => {
  assert.equal(ipInCidr('0.0.0.0', '0.0.0.0/32'), true);
  assert.equal(ipInCidr('10.0.0.1', '10.00.0.0/8'), false); // leading zero in range
});

// --- ipInCidr: IPv6 ---

test('ipv6 :: expansion at tail', () => {
  assert.equal(ipInCidr('2001:db8::', '2001:db8::/32'), true);
  assert.equal(ipInCidr('2001:db8:0:0:0:0:0:0', '2001:db8::/32'), true);
});

test('ipv6 :: expansion at head', () => {
  assert.equal(ipInCidr('::1', '::1/128'), true);
  assert.equal(ipInCidr('::2', '::1/128'), false);
});

test('ipv6 :: expansion in the middle', () => {
  assert.equal(ipInCidr('2001:db8::1', '2001:db8:0:0:0:0:0:1/128'), true);
  assert.equal(ipInCidr('1::8', '1:0:0:0:0:0:0:8/128'), true);
});

test('ipv6 bare :: is all zeros', () => {
  assert.equal(ipInCidr('::', '0:0:0:0:0:0:0:0/128'), true);
});

test('ipv6 /64 boundary addresses', () => {
  assert.equal(ipInCidr('2001:db8:1:2::', '2001:db8:1:2::/64'), true);                       // first
  assert.equal(ipInCidr('2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'), true);     // last
  assert.equal(ipInCidr('2001:db8:1:1:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'), false);    // one below
  assert.equal(ipInCidr('2001:db8:1:3::', '2001:db8:1:2::/64'), false);                      // one above
});

test('ipv6 /0 matches everything valid', () => {
  assert.equal(ipInCidr('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '::/0'), true);
  assert.equal(ipInCidr('::', '::/0'), true);
  assert.equal(ipInCidr('1::2::3', '::/0'), false); // invalid ip still rejected
});

test('ipv6 hextets are case-insensitive', () => {
  assert.equal(ipInCidr('2001:DB8::1', '2001:db8::/64'), true);
  assert.equal(ipInCidr('2001:db8::abcd', '2001:DB8::ABCD/128'), true);
});

test('ipv6 invalid address strings are false, not thrown', () => {
  assert.equal(ipInCidr('1::2::3', '2001:db8::/32'), false);                 // double ::
  assert.equal(ipInCidr('1:2:3:4:5:6:7:8:9', '2001:db8::/32'), false);      // nine hextets
  assert.equal(ipInCidr('1:2:3:4:5:6:7::8', '2001:db8::/32'), false);      // :: with 8 hextets already present
  assert.equal(ipInCidr('1:2:3:4:5:6:7', '2001:db8::/32'), false);          // seven hextets, no ::
  assert.equal(ipInCidr('2001:db8::12345', '2001:db8::/32'), false);        // hextet too long
  assert.equal(ipInCidr('2001:dg8::1', '2001:db8::/32'), false);            // non-hex char
});

test('ipv6 invalid prefix lengths are false', () => {
  assert.equal(ipInCidr('2001:db8::1', '2001:db8::/129'), false);
  assert.equal(ipInCidr('2001:db8::1', '2001:db8::/-1'), false);
});

// --- ipInCidr: mixed families ---

test('ipv4 address against ipv6 cidr is false, never throws', () => {
  assert.equal(ipInCidr('1.2.3.4', '2001:db8::/32'), false);
  assert.equal(ipInCidr('1.2.3.4', '::/0'), false);
});

test('ipv6 address against ipv4 cidr is false, never throws', () => {
  assert.equal(ipInCidr('2001:db8::1', '10.0.0.0/8'), false);
  assert.equal(ipInCidr('::1', '0.0.0.0/0'), false);
});

// --- parseRangeDoc ---

test('parseRangeDoc handles Google-style prefixes with mixed families', () => {
  const doc = {
    prefixes: [
      { ipv4Prefix: '20.0.0.0/24' },
      { ipv6Prefix: '2001:db8::/32' },
      { cidr: '30.0.0.0/16' },
    ],
  };
  assert.deepEqual(parseRangeDoc(doc), ['20.0.0.0/24', '2001:db8::/32', '30.0.0.0/16']);
});

test('parseRangeDoc handles a flat string array and drops non-strings', () => {
  assert.deepEqual(parseRangeDoc(['1.2.3.0/24', 42, null, '2001:db8::/32']), ['1.2.3.0/24', '2001:db8::/32']);
});

test('parseRangeDoc returns [] for garbage input', () => {
  assert.deepEqual(parseRangeDoc(null), []);
  assert.deepEqual(parseRangeDoc(undefined), []);
  assert.deepEqual(parseRangeDoc(42), []);
  assert.deepEqual(parseRangeDoc('1.2.3.0/24'), []);
  assert.deepEqual(parseRangeDoc({ prefixes: 'not-an-array' }), []);
  assert.deepEqual(parseRangeDoc({ other: [] }), []);
});

test('parseRangeDoc drops prefix entries without a known key', () => {
  assert.deepEqual(parseRangeDoc({ prefixes: [{ foo: 'bar' }, { ipv4Prefix: 9 }] }), []);
});

// BUG (documented, not fixed): a null or non-object entry inside prefixes throws
// instead of being filtered. Failing input: parseRangeDoc({prefixes: [null]})
// throws TypeError "Cannot read properties of null (reading 'ipv4Prefix')",
// expected []. Same for {prefixes: [undefined]}. A vendor doc with one null
// entry would take down the whole fetch for that vendor (caught upstream by
// fetchVendorRanges' catch, so it degrades to skipped, but the parse should
// not throw).
test.todo('parseRangeDoc({prefixes: [null]}) should return [], currently throws TypeError');

// --- verifyClaim ---

const ranges: VendorRanges[] = [
  { vendor: 'openai-gptbot', uaMarkers: ['gptbot'], cidrs: ['20.0.0.0/24', '2001:db8::/64'] },
  { vendor: 'anthropic-claudebot', uaMarkers: ['claudebot', 'claude-user'], cidrs: ['40.0.0.0/24'] },
];

test('verifyClaim verified when UA matches and IP is in range', () => {
  assert.equal(verifyClaim('Mozilla/5.0 GPTBot/1.2', '20.0.0.7', ranges), 'verified');
  assert.equal(verifyClaim('GPTBot/1.2', '2001:db8::5', ranges), 'verified'); // ipv6 range
  assert.equal(verifyClaim('Claude-User/1.0', '40.0.0.1', ranges), 'verified'); // second marker
});

test('verifyClaim UA matching is case-insensitive', () => {
  assert.equal(verifyClaim('CLAUDEBOT', '40.0.0.1', ranges), 'verified');
});

test('verifyClaim spoofed when UA matches but IP is outside every range', () => {
  assert.equal(verifyClaim('GPTBot/1.2', '99.99.99.99', ranges), 'spoofed');
  assert.equal(verifyClaim('ClaudeBot/1.0', '20.0.0.7', ranges), 'spoofed'); // right IP, wrong vendor
});

test('verifyClaim spoofed on an unparseable IP with a matched vendor', () => {
  assert.equal(verifyClaim('GPTBot/1.2', 'not-an-ip', ranges), 'spoofed');
});

test('verifyClaim claimed when no IP is given', () => {
  assert.equal(verifyClaim('GPTBot/1.2', undefined, ranges), 'claimed');
  assert.equal(verifyClaim('GPTBot/1.2', '', ranges), 'claimed'); // empty string is falsy
});

test('verifyClaim claimed for a UA no loaded range vouches for', () => {
  assert.equal(verifyClaim('SomeOtherBot/1.0', '20.0.0.7', ranges), 'claimed');
  assert.equal(verifyClaim('Mozilla/5.0 Chrome/126.0', '20.0.0.7', ranges), 'claimed');
});

test('verifyClaim claimed when no ranges loaded at all', () => {
  assert.equal(verifyClaim('GPTBot/1.2', '20.0.0.7', []), 'claimed');
});

// --- fetchVendorRanges ---

const sources = [
  { vendor: 'good', url: 'https://x/good.json', uaMarkers: ['good'] },
  { vendor: 'bad-status', url: 'https://x/404.json', uaMarkers: ['bad'] },
  { vendor: 'network-error', url: 'https://x/boom.json', uaMarkers: ['boom'] },
  { vendor: 'empty', url: 'https://x/empty.json', uaMarkers: ['empty'] },
];

const fakeFetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.endsWith('good.json')) {
    return { ok: true, json: async () => ({ prefixes: [{ ipv4Prefix: '20.0.0.0/24' }] }) };
  }
  if (u.endsWith('404.json')) {
    return { ok: false, json: async () => ({ prefixes: [{ ipv4Prefix: '30.0.0.0/24' }] }) };
  }
  if (u.endsWith('boom.json')) {
    throw new Error('network down');
  }
  // empty.json: reachable but no usable prefixes
  return { ok: true, json: async () => ({ prefixes: [] }) };
}) as typeof fetch;

test('fetchVendorRanges keeps ok vendors and skips non-ok, throwing, and empty ones', async () => {
  const out = await fetchVendorRanges(sources, fakeFetch);
  assert.equal(out.length, 1);
  assert.equal(out[0].vendor, 'good');
  assert.deepEqual(out[0].uaMarkers, ['good']);
  assert.deepEqual(out[0].cidrs, ['20.0.0.0/24']);
});

test('fetchVendorRanges returns [] when every source fails', async () => {
  const alwaysThrow = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.deepEqual(await fetchVendorRanges(sources, alwaysThrow), []);
});

test('fetchVendorRanges accepts a flat-array document', async () => {
  const flat = (async () => ({ ok: true, json: async () => ['50.0.0.0/16'] })) as unknown as typeof fetch;
  const out = await fetchVendorRanges([sources[0]], flat);
  assert.deepEqual(out[0].cidrs, ['50.0.0.0/16']);
});
