// @tansohq/agent-share
// One question, two numbers: what share of your traffic — and revenue —
// came from a machine? Local-only; nothing leaves your infrastructure.

import { classify, type RequestLike, type Classification, type ClassifyContext } from './classify.ts';
import { fetchVendorRanges, type VendorRanges } from './verify.ts';
import { Store, type Observation } from './store.ts';
import { buildReport, renderReport, type ShareReport } from './report.ts';

export { classify, buildReport, renderReport, Store };
export type { RequestLike, Classification, Observation, ShareReport };

export interface AgentShareOptions {
  /** Where observations are stored. Default: ./agent-share.jsonl */
  path?: string;
  /** Skip these path prefixes (health checks, static assets). */
  ignore?: string[];
  /**
   * Verify claimed agent UAs against vendor-published IP ranges.
   * Ranges are fetched lazily at first request and refreshed every 12h.
   * The client IP is checked in memory only — never written to disk.
   * Default: false.
   */
  verifyRanges?: boolean;
}

interface Middleware {
  (req: any, res: any, next: any): void;
  /** Record revenue against the current request's classification. */
  revenue(req: any, cents: number): void;
  /** Build the report for a window. */
  report(from?: Date, to?: Date): ShareReport;
  /** Render the report for a terminal. */
  print(from?: Date, to?: Date): string;
}

const CLASSIFICATION = Symbol('agent-share');

const REFRESH_MS = 12 * 60 * 60 * 1000;

// First value of x-forwarded-for, or req.ip when Express populated it.
// Some proxies write ports into x-forwarded-for ("1.2.3.4:5678", "[::1]:443");
// strip them, or a real vendor IP would fail verification as unparseable.
function stripPort(ip: string): string {
  const bracketed = ip.match(/^\[(.+)\](:\d+)?$/);
  if (bracketed) return bracketed[1];
  const v4Port = ip.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  return v4Port ? v4Port[1] : ip;
}

function clientIp(req: any): string | undefined {
  if (typeof req.ip === 'string' && req.ip) return req.ip;
  const xff = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  return first ? stripPort(first.split(',')[0].trim()) : undefined;
}

export function agentShare(opts: AgentShareOptions = {}): Middleware {
  const store = new Store(opts.path ?? './agent-share.jsonl');
  const ignore = opts.ignore ?? ['/health', '/favicon', '/assets/', '/static/'];
  const verifyRanges = opts.verifyRanges ?? false;

  // Vendor IP ranges, loaded lazily on the first request so startup never
  // blocks on the network. Until the fetch resolves, claims stay "claimed".
  let ranges: VendorRanges[] = [];
  let rangesStarted = false;

  const loadRanges = () => {
    fetchVendorRanges().then(r => {
      if (r.length) ranges = r;
    }).catch(err => {
      // fetchVendorRanges swallows per-vendor failures; anything reaching
      // here is unexpected, so log it and keep the previous ranges.
      console.error('[agent-share] vendor range fetch failed:', err);
    });
  };

  const ensureRanges = () => {
    if (rangesStarted) return;
    rangesStarted = true;
    loadRanges();
    const timer = setInterval(loadRanges, REFRESH_MS);
    timer.unref?.();
  };

  // IP is passed to classify in memory only; it is never part of the
  // Classification and never written to the store.
  const context = (req: any): ClassifyContext | undefined => {
    if (!verifyRanges) return undefined;
    ensureRanges();
    return { ip: clientIp(req), ranges };
  };

  const mw = ((req: any, _res: any, next: any) => {
    const path: string = req.path ?? req.url ?? '/';
    if (ignore.some(p => path.startsWith(p))) return next();
    const c = classify({ path, headers: req.headers ?? {} }, context(req));
    req[CLASSIFICATION] = c;
    store.append({ ...c, ts: new Date().toISOString(), path });
    next();
  }) as Middleware;

  mw.revenue = (req: any, cents: number) => {
    const c: Classification = req[CLASSIFICATION]
      ?? classify({ path: req.path ?? '/', headers: req.headers ?? {} }, context(req));
    store.append({ ...c, ts: new Date().toISOString(), path: req.path ?? '/', revenueCents: cents });
  };

  mw.report = (from?: Date, to?: Date) => buildReport(store.read(from, to), from, to);
  mw.print = (from?: Date, to?: Date) => renderReport(mw.report(from, to));

  return mw;
}
