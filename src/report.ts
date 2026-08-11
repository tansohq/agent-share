import type { Observation } from './store.ts';
import type { Verdict } from './classify.ts';

export interface ShareReport {
  window: { from: string | null; to: string | null };
  requests: {
    total: number;
    agent: number;
    human: number;
    unknown: number;
    agentShare: number;   // agent / total
    unknownShare: number; // the size of the unknown bucket is itself a finding
  };
  revenue: {
    totalCents: number;
    agentCents: number;
    agentShare: number;
  } | null;
  confidence: 'exact' | 'estimated';
  bySignal: Record<string, number>;
}

export function buildReport(rows: Observation[], from?: Date, to?: Date): ShareReport {
  const count: Record<Verdict, number> = { agent: 0, human: 0, unknown: 0 };
  const bySignal: Record<string, number> = {};
  let totalCents = 0;
  let agentCents = 0;
  let sawRevenue = false;
  let allCertain = rows.length > 0;

  for (const r of rows) {
    count[r.verdict]++;
    bySignal[r.signal] = (bySignal[r.signal] ?? 0) + 1;
    if (r.confidence !== 'certain') allCertain = false;
    if (typeof r.revenueCents === 'number') {
      sawRevenue = true;
      totalCents += r.revenueCents;
      if (r.verdict === 'agent') agentCents += r.revenueCents;
    }
  }

  const total = rows.length;
  return {
    window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    requests: {
      total,
      ...count,
      agentShare: total ? count.agent / total : 0,
      unknownShare: total ? count.unknown / total : 0,
    },
    revenue: sawRevenue
      ? { totalCents, agentCents, agentShare: totalCents ? agentCents / totalCents : 0 }
      : null,
    confidence: allCertain ? 'exact' : 'estimated',
    bySignal,
  };
}

const pct = (n: number) => (n * 100).toFixed(1) + '%';

export function renderReport(r: ShareReport): string {
  const w = 34;
  const bar = (share: number, ch: string) => ch.repeat(Math.round(share * w));
  const { requests: q } = r;
  const lines = [
    '',
    '  agent-share report' + (r.confidence === 'exact' ? '  (exact)' : '  (estimated)'),
    '  ' + '─'.repeat(w + 14),
    `  agent    ${bar(q.total ? q.agent / q.total : 0, '█').padEnd(w)} ${pct(q.total ? q.agent / q.total : 0).padStart(6)}  (${q.agent})`,
    `  human    ${bar(q.total ? q.human / q.total : 0, '█').padEnd(w)} ${pct(q.total ? q.human / q.total : 0).padStart(6)}  (${q.human})`,
    `  unknown  ${bar(q.total ? q.unknown / q.total : 0, '░').padEnd(w)} ${pct(q.unknownShare).padStart(6)}  (${q.unknown})`,
    '  ' + '─'.repeat(w + 14),
    `  ${q.total} requests · agent share of traffic ${pct(q.agentShare)}`,
  ];
  if (r.revenue) {
    lines.push(
      `  $${(r.revenue.totalCents / 100).toFixed(2)} revenue · agent share of revenue ${pct(r.revenue.agentShare)}`,
    );
  }
  if (r.confidence === 'estimated') {
    lines.push('', '  estimated: verdicts include inferred signals. Connect tanso-oss');
    lines.push('  (customer-scoped ck_ keys) to make agent attribution exact.');
  }
  lines.push('');
  return lines.join('\n');
}
