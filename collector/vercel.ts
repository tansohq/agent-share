// Collect agent-share observations from Vercel runtime logs.
//
//   vercel logs <deployment-or-domain> --json --follow | node collector/vercel.ts data/tansohq.jsonl
//
// Reads log lines on stdin, extracts the `agent-share {...}` payloads the
// middleware prints, appends them to a local JSONL file, and prints a running
// report every 25 observations. Ctrl-C prints the final report.

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { buildReport, renderReport } from '../src/report.ts';
import type { Observation } from '../src/store.ts';

const out = process.argv[2] ?? './data/observations.jsonl';
mkdirSync(dirname(out), { recursive: true });

const MARK = 'agent-share ';

function extract(line: string): Observation | null {
  const i = line.indexOf(MARK);
  if (i === -1) return null;
  const start = line.indexOf('{', i);
  if (start === -1) return null;
  // Payload is a single flat JSON object; find its closing brace.
  const end = line.indexOf('}', start);
  if (end === -1) return null;
  try {
    const o = JSON.parse(line.slice(start, end + 1));
    if (!o.ts || !o.verdict) return null;
    return { confidence: 'moderate', signal: 'unknown', path: '/', ...o };
  } catch {
    return null;
  }
}

function readAll(): Observation[] {
  if (!existsSync(out)) return [];
  return readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

let seen = 0;
const printReport = () => console.log(renderReport(buildReport(readAll())));

const rl = createInterface({ input: process.stdin });
rl.on('line', (line: string) => {
  // --json mode wraps the text in a JSON envelope; plain mode is raw text.
  let text = line;
  try {
    const env = JSON.parse(line);
    text = env.message ?? env.text ?? line;
  } catch { /* plain text line */ }
  const obs = extract(text);
  if (!obs) return;
  appendFileSync(out, JSON.stringify(obs) + '\n');
  seen++;
  process.stdout.write(`\r${seen} observations collected`);
  if (seen % 25 === 0) printReport();
});

process.on('SIGINT', () => { console.log(); printReport(); process.exit(0); });
rl.on('close', () => { console.log(); printReport(); });
