// Signal-based request classification: agent | human | unknown.
// Signals are ordered strongest-first; the first certain signal wins,
// weaker signals accumulate into a score.

import { verifyClaim, type VendorRanges } from './verify.ts';

export type Verdict = 'agent' | 'human' | 'unknown';

export interface Classification {
  verdict: Verdict;
  confidence: 'certain' | 'strong' | 'moderate' | 'weak';
  signal: string;
}

export interface RequestLike {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

// Optional IP-verification context. When ranges are loaded and the UA claims
// a vendor identity, the claim is checked instead of trusted. The IP is used
// for the in-memory check only — it never appears in the Classification.
export interface ClassifyContext {
  ip?: string;
  ranges?: VendorRanges[];
}

// Known agent user-agent substrings. Maintained list; stale by nature.
const AGENT_UA = [
  'claude', 'gptbot', 'chatgpt', 'oai-searchbot', 'openai', 'anthropic',
  'perplexity', 'google-extended', 'gemini', 'copilot', 'cohere',
  'bytespider', 'ccbot', 'diffbot', 'amazonbot', 'youbot', 'phind',
  'exabot', 'firecrawl', 'browserbase', 'headlesschrome', 'playwright',
  'puppeteer', 'python-requests', 'python-httpx', 'aiohttp', 'go-http-client',
  'curl/', 'wget/', 'node-fetch', 'undici', 'axios',
];

// Browser UA markers. Presence without agent markers leans human.
const BROWSER_UA = ['mozilla/', 'applewebkit', 'gecko/', 'chrome/', 'safari/', 'firefox/', 'edg/'];

// Routes that exist for machines. A hit here is itself a signal.
const MACHINE_ROUTES = [
  /\/llms(-full)?\.txt$/i,
  /\/agents\.md$/i,
  /\/skill\.md$/i,
  /\/pricing\.json$/i,
  /\.md$/i,
  /^\/mcp(\/|$)/i,
  /^\/\.well-known\/ai/i,
];

function header(req: RequestLike, name: string): string {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export function classify(req: RequestLike, ctx?: ClassifyContext): Classification {
  // 1. Customer-scoped agent key (connected mode). Issued through the agent
  //    signup path, so machine-originated by construction.
  const auth = header(req, 'authorization');
  const apiKey = header(req, 'x-api-key');
  if (/\bck_(live|test)_/.test(auth) || /^ck_(live|test)_/.test(apiKey)) {
    return { verdict: 'agent', confidence: 'certain', signal: 'ck-key' };
  }

  // 2. Web Bot Auth signature (cryptographic agent identity).
  if (header(req, 'signature-agent')) {
    return { verdict: 'agent', confidence: 'strong', signal: 'signature-agent' };
  }
  if (header(req, 'signature') && header(req, 'signature-input')) {
    return { verdict: 'agent', confidence: 'strong', signal: 'web-bot-auth' };
  }

  const ua = header(req, 'user-agent').toLowerCase();

  // 3. Known agent user-agent. With vendor ranges loaded, the claim is
  //    checked against the vendor's published IPs: verified upgrades to
  //    strong, spoofed downgrades to unknown (a forged agent UA is not
  //    evidence of a human), claimed keeps the moderate default.
  const uaHit = AGENT_UA.find(m => ua.includes(m));
  if (uaHit) {
    if (ctx?.ranges?.length) {
      const result = verifyClaim(ua, ctx.ip, ctx.ranges);
      if (result === 'verified') {
        return { verdict: 'agent', confidence: 'strong', signal: `verified:${uaHit}` };
      }
      if (result === 'spoofed') {
        return { verdict: 'unknown', confidence: 'strong', signal: `spoofed-ua:${uaHit}` };
      }
    }
    return { verdict: 'agent', confidence: 'moderate', signal: `ua:${uaHit}` };
  }

  // 4. Machine-shaped route.
  const routeHit = MACHINE_ROUTES.find(r => r.test(req.path));
  if (routeHit) {
    return { verdict: 'agent', confidence: 'moderate', signal: `route:${req.path}` };
  }

  // 5. Browser-shaped UA with none of the above leans human.
  if (BROWSER_UA.some(m => ua.includes(m))) {
    // No referer and no accept-language is a weak machine tell even in a browser UA.
    if (!header(req, 'referer') && !header(req, 'accept-language')) {
      return { verdict: 'unknown', confidence: 'weak', signal: 'browser-ua-no-context' };
    }
    return { verdict: 'human', confidence: 'moderate', signal: 'browser-ua' };
  }

  // 6. No UA at all is machine-shaped but unproven.
  if (!ua) {
    return { verdict: 'unknown', confidence: 'weak', signal: 'no-ua' };
  }

  return { verdict: 'unknown', confidence: 'weak', signal: 'unclassified' };
}
