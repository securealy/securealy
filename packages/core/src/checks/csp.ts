import type { CheckContext, CheckModule } from './context.js';
import { needPage, result } from './context.js';

/** The CSP in force, from the header or a meta http-equiv. */
export function effectiveCsp(ctx: CheckContext): { value: string; source: 'header' | 'meta' | 'report-only' } | null {
  const h = ctx.header('content-security-policy');
  if (h) return { value: h, source: 'header' };
  const m = ctx.page?.metas.find((x) => x.name === 'content-security-policy');
  if (m) return { value: m.content, source: 'meta' };
  const ro = ctx.header('content-security-policy-report-only');
  if (ro) return { value: ro, source: 'report-only' };
  return null;
}

export const check: CheckModule = {
  id: 'csp',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const csp = effectiveCsp(ctx);
    if (!csp) return result(this.id, 'fail', 'no Content-Security-Policy header on the HTML response');
    const directives = csp.value.split(';').map((d) => d.trim()).filter(Boolean).length;
    if (csp.source === 'report-only') return result(this.id, 'warn', `only Content-Security-Policy-Report-Only is set (${directives} directives); it reports but blocks nothing`);
    if (csp.source === 'meta') return result(this.id, 'pass', `CSP set via meta tag (${directives} directives); a header also covers frame-ancestors`);
    return result(this.id, 'pass', `CSP header with ${directives} directives`);
  },
};
