import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.ts';
import { buildReport } from '../src/report.ts';
import type { Observation } from '../src/store.ts';

const req = (path: string, headers: Record<string, string> = {}) => ({ path, headers });

test('ck_ key is certain agent regardless of everything else', () => {
  const c = classify(req('/api/v1/enrich', {
    authorization: 'Bearer ck_live_abc123',
    'user-agent': 'Mozilla/5.0 Chrome/126.0',
    referer: 'https://example.com',
  }));
  assert.equal(c.verdict, 'agent');
  assert.equal(c.confidence, 'certain');
  assert.equal(c.signal, 'ck-key');
});

test('x-api-key ck_ form is also certain', () => {
  const c = classify(req('/api', { 'x-api-key': 'ck_test_xyz' }));
  assert.equal(c.confidence, 'certain');
});

test('web bot auth signature pair is strong agent', () => {
  const c = classify(req('/api', { signature: 'sig1=:abc:', 'signature-input': 'sig1=()' }));
  assert.equal(c.verdict, 'agent');
  assert.equal(c.confidence, 'strong');
});

test('known agent UA is moderate agent', () => {
  assert.equal(classify(req('/docs', { 'user-agent': 'GPTBot/1.2' })).verdict, 'agent');
  assert.equal(classify(req('/docs', { 'user-agent': 'Claude-User/1.0' })).verdict, 'agent');
  assert.equal(classify(req('/docs', { 'user-agent': 'python-httpx/0.27' })).verdict, 'agent');
});

test('machine routes classify as agent even with a plain UA', () => {
  assert.equal(classify(req('/llms.txt', { 'user-agent': 'node' })).verdict, 'agent');
  assert.equal(classify(req('/docs/page.md', { 'user-agent': 'node' })).verdict, 'agent');
  assert.equal(classify(req('/public/v1/catalog/x/pricing.json', { 'user-agent': 'node' })).verdict, 'agent');
});

test('full browser context is human', () => {
  const c = classify(req('/pricing', {
    'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    referer: 'https://www.google.com/',
    'accept-language': 'en-US',
  }));
  assert.equal(c.verdict, 'human');
});

test('browser UA with no referer and no accept-language is unknown, not human', () => {
  const c = classify(req('/pricing', { 'user-agent': 'Mozilla/5.0 Chrome/126.0' }));
  assert.equal(c.verdict, 'unknown');
});

test('missing UA is unknown, never human', () => {
  assert.equal(classify(req('/api', {})).verdict, 'unknown');
});

test('report splits revenue by verdict and stays estimated with mixed confidence', () => {
  const rows: Observation[] = [
    { verdict: 'agent', confidence: 'certain', signal: 'ck-key', ts: '2026-08-11T00:00:00Z', path: '/topup', revenueCents: 1000 },
    { verdict: 'human', confidence: 'moderate', signal: 'browser-ua', ts: '2026-08-11T00:00:01Z', path: '/checkout', revenueCents: 3000 },
    { verdict: 'agent', confidence: 'moderate', signal: 'ua:gptbot', ts: '2026-08-11T00:00:02Z', path: '/docs' },
  ];
  const r = buildReport(rows);
  assert.equal(r.requests.total, 3);
  assert.equal(r.revenue?.totalCents, 4000);
  assert.equal(r.revenue?.agentCents, 1000);
  assert.equal(r.confidence, 'estimated');
});

test('report is exact when every verdict is certain', () => {
  const rows: Observation[] = [
    { verdict: 'agent', confidence: 'certain', signal: 'ck-key', ts: '2026-08-11T00:00:00Z', path: '/a' },
    { verdict: 'agent', confidence: 'certain', signal: 'ck-key', ts: '2026-08-11T00:00:01Z', path: '/b' },
  ];
  assert.equal(buildReport(rows).confidence, 'exact');
});

test('empty report does not divide by zero', () => {
  const r = buildReport([]);
  assert.equal(r.requests.agentShare, 0);
  assert.equal(r.revenue, null);
});
