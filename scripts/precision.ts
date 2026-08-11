// Precision report over human-labeled observations. Reads the labels JSONL
// produced by scripts/label.ts and prints a confusion matrix (classifier
// verdict x human label), per-verdict precision/recall, and overall accuracy.
// 'dont-know' labels are shown in the matrix but excluded from the metrics.
//
// Usage: node scripts/precision.ts <labels.jsonl>

import { readFileSync, existsSync } from 'node:fs';
import type { LabeledRow, HumanLabel } from './label.ts';
import type { Verdict } from '../src/classify.ts';

const labelsPath = process.argv[2];
if (!labelsPath) {
  console.error('usage: node scripts/precision.ts <labels.jsonl>');
  process.exit(1);
}
if (!existsSync(labelsPath)) {
  console.error(`no such file: ${labelsPath}`);
  process.exit(1);
}

const rows = readFileSync(labelsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l) as LabeledRow);

const VERDICTS: Verdict[] = ['agent', 'human', 'unknown'];
const LABELS: HumanLabel[] = ['agent', 'human', 'dont-know'];

// matrix[verdict][label] = count
const matrix: Record<Verdict, Record<HumanLabel, number>> = {
  agent: { agent: 0, human: 0, 'dont-know': 0 },
  human: { agent: 0, human: 0, 'dont-know': 0 },
  unknown: { agent: 0, human: 0, 'dont-know': 0 },
};
for (const r of rows) {
  matrix[r.obs.verdict][r.label]++;
}

const pct = (n: number) => (n * 100).toFixed(1) + '%';
// Ratio that reads as '—' when the denominator is zero, instead of NaN.
const ratio = (num: number, den: number) => (den ? pct(num / den) : '     —');

// Known-label counts (dont-know excluded from all metrics).
const knownByVerdict = (v: Verdict) => matrix[v].agent + matrix[v].human;
const knownByLabel = (l: HumanLabel) => VERDICTS.reduce((s, v) => s + matrix[v][l], 0);
const knownTotal = knownByVerdict('agent') + knownByVerdict('human') + knownByVerdict('unknown');
const correct = matrix.agent.agent + matrix.human.human; // 'unknown' never matches a label

const w = 34;
const bar = (share: number, ch: string) => ch.repeat(Math.round(share * w));

const lines: string[] = [
  '',
  `  agent-share precision  (${rows.length} labeled)`,
  '  ' + '─'.repeat(w + 14),
  '',
  '  confusion matrix (classifier verdict × human label)',
  '',
  '             ' + LABELS.map(l => l.padStart(10)).join(''),
];
for (const v of VERDICTS) {
  lines.push(
    `  ${v.padEnd(9)}  ` + LABELS.map(l => String(matrix[v][l]).padStart(10)).join(''),
  );
}
lines.push('', '  ' + '─'.repeat(w + 14), '');

// Precision: of rows the classifier called v, how many did the human agree with.
// Recall: of rows the human called v, how many the classifier caught.
// Only agent/human have matching labels; 'unknown' is abstention, shown for size only.
for (const v of ['agent', 'human'] as const) {
  const p = knownByVerdict(v) ? matrix[v][v] / knownByVerdict(v) : 0;
  lines.push(
    `  ${v.padEnd(9)}${bar(p, '█').padEnd(w)} precision ${ratio(matrix[v][v], knownByVerdict(v)).padStart(6)}  recall ${ratio(matrix[v][v], knownByLabel(v)).padStart(6)}`,
  );
}
const abstain = knownByVerdict('unknown');
lines.push(
  `  ${'unknown'.padEnd(9)}${bar(knownTotal ? abstain / knownTotal : 0, '░').padEnd(w)} abstained ${ratio(abstain, knownTotal).padStart(6)}  (${abstain})`,
);
lines.push('', '  ' + '─'.repeat(w + 14));
lines.push(
  `  overall accuracy ${ratio(correct, knownTotal)}  (${correct}/${knownTotal}, dont-know excluded)`,
);
if (knownTotal === 0) {
  lines.push('  no usable labels yet — run npm run label first');
}
lines.push('');

console.log(lines.join('\n'));
