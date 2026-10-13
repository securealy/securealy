import { catalogue } from './catalogue.js';
import { buildContext, result } from './checks/context.js';
import { REMOTE_CHECK_MAP } from './checks/index.js';
import type { Evidence } from './evidence.js';
import { gather } from './fetcher/index.js';
import { gradeId } from './id.js';
import { score } from './score.js';
import { detectStack } from './stack.js';
import type { CheckResult, GradeOptions, GradeResult } from './types.js';

/** Run every passive (and, when present, verified) check against gathered evidence. */
export function evaluate(ev: Evidence): { checks: CheckResult[]; stack: GradeResult['stack'] } {
  const ctx = buildContext(ev);
  const tiers = ev.verified ? ['passive', 'verified'] : ['passive'];
  const checks: CheckResult[] = [];
  for (const entry of catalogue()) {
    if (!tiers.includes(entry.tier)) continue;
    const mod = REMOTE_CHECK_MAP.get(entry.id);
    if (!mod) {
      checks.push(result(entry.id, 'error', 'no module implements this check'));
      continue;
    }
    try {
      checks.push(mod.run(ctx));
    } catch (e) {
      checks.push(result(entry.id, 'error', `check crashed: ${(e as Error).message}`.slice(0, 200)));
    }
  }
  return { checks, stack: detectStack(ev, ctx.page) };
}

export function assemble(ev: Evidence, checks: CheckResult[], stack: GradeResult['stack'], durationMs: number): GradeResult {
  const s = score(checks);
  const out: GradeResult = {
    schema: 1,
    id: gradeId(),
    input: ev.input,
    finalUrl: ev.finalUrl,
    host: ev.host,
    gradedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tier: ev.verified ? 'verified' : 'passive',
    grade: s.grade,
    score: s.score,
    summary: s.summary,
    stack,
    checks,
    requests: ev.requests,
    durationMs,
  };
  if (s.capped) out.capped = s.capped;
  return out;
}

/** Grade a URL: gather evidence once, run the checks, score. */
export async function grade(url: string, opts: GradeOptions = {}): Promise<GradeResult> {
  const started = Date.now();
  const ev = await gather(url, opts);
  const { checks, stack } = evaluate(ev);
  return assemble(ev, checks, stack, Date.now() - started);
}
