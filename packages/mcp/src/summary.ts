import { catalogue } from 'securealy-core';
import type { Category, CheckResult, GradeResult } from 'securealy-core';
import { API_BASE } from './api.js';

const CATEGORY_ORDER: Category[] = ['security', 'payments', 'email', 'domain', 'hygiene', 'seo', 'analytics', 'performance'];

/**
 * A compact, plain-text reading of a GradeResult so an agent can act without
 * parsing JSON: the grade line, blockers with evidence, then every fail and
 * warn grouped by category, each with its fix page.
 */
export function summarize(r: GradeResult): string {
  const entries = new Map(catalogue().map((c) => [c.id, c]));
  const s = r.summary;
  const lines: string[] = [];
  lines.push(`Grade ${r.grade} (${r.score}/100), ${r.preLaunch ? 'pre-launch, ' : ''}${r.tier} tier, ${r.input}${r.finalUrl && r.finalUrl !== r.input ? ` -> ${r.finalUrl}` : ''}`);
  if (r.preLaunch) lines.push('pre-launch grade of a local address; checks that need a public domain are skipped');
  lines.push(`${s.blocker} blocker, ${s.fail} fail, ${s.warn} warn, ${s.pass} pass, ${s.skip} skip, ${s.error} error; ${r.requests} requests, ${r.durationMs} ms`);
  if (r.capped) lines.push(`Capped: ${r.capped}`);
  const stackBits = Object.entries(r.stack)
    .filter(([, v]) => v !== undefined && (Array.isArray(v) ? v.length : true))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : String(v)}`);
  if (stackBits.length) lines.push(`Stack: ${stackBits.join(', ')}`);

  const row = (c: CheckResult) => {
    const e = entries.get(c.id);
    return `  ${c.status.toUpperCase()} ${c.id} [${c.severity}] ${c.evidence}\n      ${e?.title ?? ''} -> ${API_BASE}/checks/${c.fixSlug ?? c.id}`;
  };

  const blockers = r.checks.filter((c) => c.status === 'fail' && c.severity === 'blocker');
  lines.push('');
  if (blockers.length) {
    lines.push('BLOCKERS (fix these first; each one caps the grade):');
    for (const c of blockers) lines.push(row(c));
  } else {
    lines.push('No blockers.');
  }

  const sevRank = { blocker: 0, high: 1, medium: 2, low: 3, info: 4 };
  let anyFail = false;
  for (const cat of CATEGORY_ORDER) {
    const inCat = r.checks
      .filter((c) => entries.get(c.id)?.category === cat && !blockers.includes(c))
      .filter((c) => c.status === 'fail' || c.status === 'warn' || c.status === 'error')
      .sort((a, b) => (a.status === b.status ? sevRank[a.severity] - sevRank[b.severity] : a.status === 'fail' ? -1 : 1));
    if (!inCat.length) continue;
    if (!anyFail) {
      lines.push('');
      lines.push('FAILS AND WARNINGS BY CATEGORY:');
      anyFail = true;
    }
    lines.push(`${cat}:`);
    for (const c of inCat) lines.push(row(c));
  }
  if (!anyFail) lines.push('Nothing else failing.');
  return lines.join('\n');
}
