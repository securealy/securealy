import { catalogue } from 'securealy-core';
import type { Category, CheckResult, Grade, GradeResult, Status } from 'securealy-core';

export const API_BASE = 'https://securealy.com';

/** Five-row block letters, ASCII only. */
const STAMP: Record<Grade, string[]> = {
  A: ['  ###  ', ' #   # ', ' ##### ', ' #   # ', ' #   # '],
  B: [' ####  ', ' #   # ', ' ####  ', ' #   # ', ' ####  '],
  C: ['  #### ', ' #     ', ' #     ', ' #     ', '  #### '],
  D: [' ####  ', ' #   # ', ' #   # ', ' #   # ', ' ####  '],
  F: [' ##### ', ' #     ', ' ####  ', ' #     ', ' #     '],
};

const CATEGORY_ORDER: Category[] = ['security', 'payments', 'email', 'domain', 'hygiene', 'seo', 'analytics', 'performance'];
const STATUS_LABEL: Record<Status, string> = { pass: 'pass', fail: 'FAIL', warn: 'WARN', skip: 'skip', error: 'ERR ' };

export interface ReportOptions {
  color?: boolean;
  /** hide passing and skipped rows */
  compact?: boolean;
}

function paint(color: boolean, code: string, s: string): string {
  return color ? `\u001b[${code}m${s}\u001b[0m` : s;
}

const STATUS_COLOR: Record<Status, string> = { pass: '32', fail: '31', warn: '33', skip: '90', error: '35' };

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export function renderReport(r: GradeResult, opts: ReportOptions = {}): string {
  const color = opts.color ?? false;
  const entries = new Map(catalogue().map((c) => [c.id, c]));
  const lines: string[] = [];
  const stamp = STAMP[r.grade];
  const stackBits = Object.entries(r.stack)
    .filter(([, v]) => v !== undefined && (Array.isArray(v) ? v.length : true))
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('+') : String(v)}`);
  const s = r.summary;
  const info = [
    `securealy  ${r.input}${r.finalUrl !== r.input ? `  ->  ${r.finalUrl}` : ''}`,
    `Grade ${r.grade}  (${r.score}/100)   ${r.tier} tier   ${r.requests} request${r.requests === 1 ? '' : 's'}   ${fmtDuration(r.durationMs)}`,
    `${s.blocker} blocker${s.blocker === 1 ? '' : 's'} . ${s.fail} fail . ${s.warn} warn . ${s.pass} pass . ${s.skip} skip . ${s.error} error`,
    r.capped ? `capped: ${r.capped}` : '',
    stackBits.length ? `stack: ${stackBits.join(' . ')}` : '',
  ];
  for (let i = 0; i < 5; i++) {
    const left = paint(color, r.grade === 'A' || r.grade === 'B' ? '32' : r.grade === 'C' ? '33' : '31', stamp[i] ?? '');
    lines.push(`${left}   ${info[i] ?? ''}`.replace(/\s+$/, ''));
  }
  lines.push('');

  const idWidth = Math.max(...r.checks.map((c) => c.id.length), 12) + 2;
  const row = (c: CheckResult) => {
    const label = paint(color, STATUS_COLOR[c.status], STATUS_LABEL[c.status]);
    const first = `  ${label}  ${c.id.padEnd(idWidth)}${c.evidence}`;
    if (c.status === 'pass' || c.status === 'skip') return [first];
    const entry = entries.get(c.id);
    const second = `        ${''.padEnd(idWidth)}${paint(color, '90', `${entry?.title ?? ''} (${c.severity}) -> ${API_BASE}/checks/${c.fixSlug ?? c.id}`)}`;
    return [first, second];
  };

  const blockers = r.checks.filter((c) => c.status === 'fail' && c.severity === 'blocker');
  if (blockers.length) {
    lines.push(paint(color, '1;31', 'BLOCKERS'));
    for (const c of blockers) lines.push(...row(c));
    lines.push('');
  }

  const rank: Record<Status, number> = { fail: 0, error: 1, warn: 2, pass: 3, skip: 4 };
  const sevRank = { blocker: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const cat of CATEGORY_ORDER) {
    const inCat = r.checks
      .filter((c) => entries.get(c.id)?.category === cat && !blockers.includes(c))
      .filter((c) => !opts.compact || (c.status !== 'pass' && c.status !== 'skip'))
      .sort((a, b) => rank[a.status] - rank[b.status] || sevRank[a.severity] - sevRank[b.severity]);
    if (!inCat.length) continue;
    lines.push(paint(color, '1', cat.toUpperCase()));
    for (const c of inCat) lines.push(...row(c));
    lines.push('');
  }
  return lines.join('\n');
}

/** A one-line JSON summary, handy for logs and CI output. */
export function summaryLine(r: GradeResult): string {
  return JSON.stringify({ grade: r.grade, score: r.score, capped: r.capped, summary: r.summary, requests: r.requests, durationMs: r.durationMs });
}

export function meetsMinimum(grade: Grade, min: Grade): boolean {
  const order: Grade[] = ['F', 'D', 'C', 'B', 'A'];
  return order.indexOf(grade) >= order.indexOf(min);
}

export function parseGrade(value: string | undefined, fallback: Grade = 'C'): Grade {
  if (!value) return fallback;
  const v = value.trim().toUpperCase();
  if (v === 'A' || v === 'B' || v === 'C' || v === 'D' || v === 'F') return v;
  throw new Error(`--min-grade must be one of A, B, C, D, F (got ${value})`);
}
