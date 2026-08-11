// IP verification against vendor-published ranges.
//
// A user-agent is a claim. OpenAI and Anthropic publish the IP ranges their
// crawlers actually use, so a claimed GPTBot/ClaudeBot request can be checked:
// UA match + IP in the published range = verified, UA match alone = claimed,
// UA match + IP outside the range = spoofed (counted as unknown, not agent).
//
// Ranges are fetched at startup and refreshed on an interval; vendors move
// ranges, so the lists are treated as a moving control, not a constant.
// The IP is used for the in-memory check only and is never stored.

export interface VendorRanges {
  vendor: string;
  /** UA substrings this vendor's published ranges vouch for. */
  uaMarkers: string[];
  cidrs: string[];
}

export const RANGE_SOURCES: { vendor: string; url: string; uaMarkers: string[] }[] = [
  { vendor: 'openai-gptbot', url: 'https://openai.com/gptbot.json', uaMarkers: ['gptbot'] },
  { vendor: 'openai-chatgpt-user', url: 'https://openai.com/chatgpt-user.json', uaMarkers: ['chatgpt-user'] },
  { vendor: 'openai-searchbot', url: 'https://openai.com/searchbot.json', uaMarkers: ['oai-searchbot'] },
  { vendor: 'anthropic-claudebot', url: 'https://www.anthropic.com/claudebot.json', uaMarkers: ['claudebot', 'claude-user', 'claude-searchbot'] },
];

// --- CIDR matching, IPv4 and IPv6, no dependencies ---

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    // Digits only: Number() also accepts whitespace, '+', exponents, and ''
    // (an empty octet would silently become 0).
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255 || (p.length > 1 && p[0] === '0')) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Expand :: and parse 8 hextets. Rejects embedded-IPv4 forms for simplicity;
  // vendor ranges use plain hextet notation.
  const double = ip.split('::');
  if (double.length > 2) return null;
  const head = double[0] ? double[0].split(':') : [];
  const tail = double.length === 2 && double[1] ? double[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (double.length === 2 && missing < 1) return null;
  if (double.length === 1 && head.length !== 8) return null;
  const parts = [...head, ...Array(double.length === 2 ? missing : 0).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
    n = (n << 16n) | BigInt(parseInt(p, 16));
  }
  return n;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  // Digits only: Number('') is 0, so "1.2.3.4/" would otherwise become a
  // /0 that matches every address.
  if (bitsStr !== undefined && !/^\d+$/.test(bitsStr)) return false;
  const bits = bitsStr === undefined ? (range.includes(':') ? 128 : 32) : Number(bitsStr);

  if (!range.includes(':')) {
    const ipN = ipv4ToInt(ip);
    const rangeN = ipv4ToInt(range);
    if (ipN === null || rangeN === null || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = (~0 << (32 - bits)) >>> 0;
    return ((ipN & mask) >>> 0) === ((rangeN & mask) >>> 0);
  }

  const ipN = ipv6ToBigInt(ip);
  const rangeN = ipv6ToBigInt(range);
  if (ipN === null || rangeN === null || bits < 0 || bits > 128) return false;
  if (bits === 0) return true;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ipN & mask) === (rangeN & mask);
}

// --- Range loading ---

/** Parse a vendor ranges document ({"prefixes":[{"ipv4Prefix":..}|{"ipv6Prefix":..}]} or a flat array). */
export function parseRangeDoc(doc: unknown): string[] {
  if (Array.isArray(doc)) return doc.filter(x => typeof x === 'string');
  if (doc && typeof doc === 'object' && Array.isArray((doc as any).prefixes)) {
    return (doc as any).prefixes
      .map((p: any) => p.ipv4Prefix ?? p.ipv6Prefix ?? p.cidr ?? null)
      .filter((x: unknown) => typeof x === 'string');
  }
  return [];
}

export async function fetchVendorRanges(
  sources = RANGE_SOURCES,
  fetchImpl: typeof fetch = fetch,
): Promise<VendorRanges[]> {
  const out: VendorRanges[] = [];
  for (const s of sources) {
    try {
      const res = await fetchImpl(s.url);
      if (!res.ok) continue;
      const cidrs = parseRangeDoc(await res.json());
      if (cidrs.length) out.push({ vendor: s.vendor, uaMarkers: s.uaMarkers, cidrs });
    } catch {
      // A vendor list being unreachable degrades that vendor to "claimed",
      // it does not break classification. Skipped intentionally, and the
      // caller can see which vendors loaded from the returned array.
    }
  }
  return out;
}

export type VerifyResult = 'verified' | 'claimed' | 'spoofed';

/** Check a UA claim against loaded ranges. `claimed` when no ranges cover this UA or no IP given. */
export function verifyClaim(ua: string, ip: string | undefined, ranges: VendorRanges[]): VerifyResult {
  const lower = ua.toLowerCase();
  const vendor = ranges.find(r => r.uaMarkers.some(m => lower.includes(m)));
  if (!vendor || !ip) return 'claimed';
  // An empty range list gives no evidence either way: degrade to claimed
  // rather than calling the request spoofed with no data behind it.
  if (vendor.cidrs.length === 0) return 'claimed';
  return vendor.cidrs.some(c => ipInCidr(ip, c)) ? 'verified' : 'spoofed';
}
