import { catalogue } from '../catalogue.js';
import { result } from '../checks/context.js';
import { gradeId } from '../id.js';
import { score } from '../score.js';
import type { CheckResult, GradeResult, LocalOptions } from '../types.js';
import { createLocalContext, hostFromUrl } from './context.js';
import type { LocalCheckModule } from './context.js';
import { check as repoSecrets } from './repo-secrets.js';
import { check as gitignoreEnvCoverage } from './gitignore-env-coverage.js';
import { check as envExampleParity } from './env-example-parity.js';
import { check as supabaseAuthConfig } from './supabase-auth-config.js';
import { check as rlsPolicies } from './rls-policies.js';
import { check as stripeWebhookWiring } from './stripe-webhook-wiring.js';
import { check as vercelEnvHygiene } from './vercel-env-hygiene.js';
import { PRODUCTION_URL_VARS } from './stripe-webhook-wiring.js';

export const LOCAL_CHECKS: LocalCheckModule[] = [repoSecrets, gitignoreEnvCoverage, envExampleParity, supabaseAuthConfig, rlsPolicies, stripeWebhookWiring, vercelEnvHygiene];

const LOCAL_MAP = new Map(LOCAL_CHECKS.map((c) => [c.id, c]));

/** Run the local-tier checks with the owner's own credentials. Nothing leaves the machine. */
export async function runLocal(opts: LocalOptions): Promise<GradeResult> {
  const started = Date.now();
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const ctx = createLocalContext(opts.cwd, env, opts.fetch ?? globalThis.fetch, opts.log ?? (() => {}));
  const wanted = opts.checks?.length ? new Set(opts.checks) : null;
  const checks: CheckResult[] = [];
  for (const entry of catalogue()) {
    if (entry.tier !== 'local') continue;
    if (wanted && !wanted.has(entry.id)) continue;
    const mod = LOCAL_MAP.get(entry.id);
    if (!mod) {
      checks.push(result(entry.id, 'error', 'no module implements this check'));
      continue;
    }
    try {
      checks.push(await mod.run(ctx));
    } catch (e) {
      checks.push(result(entry.id, 'error', `check crashed: ${(e as Error).message}`.slice(0, 200)));
    }
  }
  const s = score(checks);
  const prodHost = hostFromUrl(ctx.envAny(...PRODUCTION_URL_VARS)) ?? 'local';
  const out: GradeResult = {
    schema: 1,
    id: gradeId(),
    input: opts.cwd,
    finalUrl: opts.cwd,
    host: prodHost,
    gradedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tier: 'local',
    grade: s.grade,
    score: s.score,
    summary: s.summary,
    stack: {},
    checks,
    requests: ctx.requests.count,
    durationMs: Date.now() - started,
  };
  if (s.capped) out.capped = s.capped;
  return out;
}
