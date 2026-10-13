import type { CheckContext } from './context.js';
import { result } from './context.js';
import type { CheckResult } from '../types.js';
import type { VerifiedEvidence } from '../evidence.js';

/** Verified checks only run when ownership was proven and the probes were made. */
export function needVerified(ctx: CheckContext, id: string): { gate: CheckResult | null; v: VerifiedEvidence | null } {
  const v = ctx.ev.verified;
  if (!v) return { gate: result(id, 'skip', 'verified tier only; prove ownership with securealy verify to run it'), v: null };
  return { gate: null, v };
}
