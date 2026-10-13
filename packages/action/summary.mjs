#!/usr/bin/env node
// Writes the GitHub job summary for a GradeResult and prints step outputs.
// Usage: node summary.mjs <result.json> <min-grade> <cli-exit-code>
import { readFileSync, appendFileSync } from 'node:fs';

const [, , file, minGrade = 'C', exitCode = '0'] = process.argv;
const raw = readFileSync(file, 'utf8');
let r;
try {
  r = JSON.parse(raw);
} catch {
  console.error(`securealy: ${file} is not JSON:\n${raw.slice(0, 500)}`);
  process.exit(2);
}

const STAMP = {
  A: ['  ###  ', ' #   # ', ' ##### ', ' #   # ', ' #   # '],
  B: [' ####  ', ' #   # ', ' ####  ', ' #   # ', ' ####  '],
  C: ['  #### ', ' #     ', ' #     ', ' #     ', '  #### '],
  D: [' ####  ', ' #   # ', ' #   # ', ' #   # ', ' ####  '],
  F: [' ##### ', ' #     ', ' ####  ', ' #     ', ' #     '],
};
const SEV = { blocker: 0, high: 1, medium: 2, low: 3, info: 4 };
const passed = exitCode === '0';
const s = r.summary ?? {};
const esc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const stamp = (STAMP[r.grade] ?? STAMP.F).join('\n');
const lines = [];
lines.push(`## Securealy: Grade ${r.grade} (${r.score}/100) ${passed ? 'meets' : 'is below'} minimum ${minGrade.toUpperCase()}`);
lines.push('');
lines.push('```');
lines.push(stamp);
lines.push('```');
lines.push('');
lines.push(`**${r.input}**${r.finalUrl && r.finalUrl !== r.input ? ` (final ${r.finalUrl})` : ''}, ${r.tier} tier, ${r.requests} requests, ${Math.round((r.durationMs ?? 0) / 100) / 10} s`);
lines.push('');
lines.push(`${s.blocker ?? 0} blocker, ${s.fail ?? 0} fail, ${s.warn ?? 0} warn, ${s.pass ?? 0} pass, ${s.skip ?? 0} skip, ${s.error ?? 0} error${r.capped ? `. Capped: ${r.capped}` : ''}`);
lines.push('');

const failing = (r.checks ?? [])
  .filter((c) => c.status === 'fail' || c.status === 'warn' || c.status === 'error')
  .sort((a, b) => {
    const blockA = a.status === 'fail' && a.severity === 'blocker' ? 0 : 1;
    const blockB = b.status === 'fail' && b.severity === 'blocker' ? 0 : 1;
    return blockA - blockB || (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) || SEV[a.severity] - SEV[b.severity];
  });

if (failing.length) {
  lines.push('| Status | Check | Severity | Evidence | Fix |');
  lines.push('|---|---|---|---|---|');
  for (const c of failing) {
    const slug = c.fixSlug ?? c.id;
    lines.push(`| ${c.status.toUpperCase()} | \`${c.id}\` | ${c.severity} | ${esc(c.evidence)} | [fix](https://securealy.com/checks/${slug}) |`);
  }
} else {
  lines.push('Nothing failing.');
}
lines.push('');
lines.push('Full result: the `GradeResult` JSON is attached as a workflow artifact.');

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
else console.error(lines.join('\n'));

// Step outputs (stdout is appended to $GITHUB_OUTPUT by the action).
console.log(`grade=${r.grade}`);
console.log(`score=${r.score}`);
console.log(`passed=${passed}`);
