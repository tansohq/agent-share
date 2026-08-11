// @tansohq/agent-share
// One question, two numbers: what share of your traffic — and revenue —
// came from a machine? Local-only; nothing leaves your infrastructure.

import { classify, type RequestLike, type Classification } from './classify.ts';
import { Store, type Observation } from './store.ts';
import { buildReport, renderReport, type ShareReport } from './report.ts';

export { classify, buildReport, renderReport, Store };
export type { RequestLike, Classification, Observation, ShareReport };

export interface AgentShareOptions {
  /** Where observations are stored. Default: ./agent-share.jsonl */
  path?: string;
  /** Skip these path prefixes (health checks, static assets). */
  ignore?: string[];
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

export function agentShare(opts: AgentShareOptions = {}): Middleware {
  const store = new Store(opts.path ?? './agent-share.jsonl');
  const ignore = opts.ignore ?? ['/health', '/favicon', '/assets/', '/static/'];

  const mw = ((req: any, _res: any, next: any) => {
    const path: string = req.path ?? req.url ?? '/';
    if (ignore.some(p => path.startsWith(p))) return next();
    const c = classify({ path, headers: req.headers ?? {} });
    req[CLASSIFICATION] = c;
    store.append({ ...c, ts: new Date().toISOString(), path });
    next();
  }) as Middleware;

  mw.revenue = (req: any, cents: number) => {
    const c: Classification = req[CLASSIFICATION] ?? classify({ path: req.path ?? '/', headers: req.headers ?? {} });
    store.append({ ...c, ts: new Date().toISOString(), path: req.path ?? '/', revenueCents: cents });
  };

  mw.report = (from?: Date, to?: Date) => buildReport(store.read(from, to), from, to);
  mw.print = (from?: Date, to?: Date) => renderReport(mw.report(from, to));

  return mw;
}
