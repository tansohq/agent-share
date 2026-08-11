// Local JSONL storage. One line per observed request. No phone-home:
// nothing leaves the operator's machine.

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Classification } from './classify.ts';

export interface Observation extends Classification {
  ts: string;
  path: string;
  revenueCents?: number;
}

export class Store {
  private file: string;

  constructor(file: string) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
  }

  append(obs: Observation): void {
    appendFileSync(this.file, JSON.stringify(obs) + '\n');
  }

  read(from?: Date, to?: Date): Observation[] {
    if (!existsSync(this.file)) return [];
    const rows = readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as Observation);
    return rows.filter(r => {
      const t = new Date(r.ts);
      return (!from || t >= from) && (!to || t <= to);
    });
  }
}
