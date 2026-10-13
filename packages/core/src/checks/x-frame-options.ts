import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { effectiveCsp } from './csp.js';
import { parseCsp } from './csp-strength.js';

export const check: CheckModule = {
  id: 'x-frame-options',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const xfo = ctx.header('x-frame-options');
    const csp = effectiveCsp(ctx);
    const fa = csp && csp.source !== 'report-only' ? parseCsp(csp.value).get('frame-ancestors') : undefined;
    if (fa) return result(this.id, 'pass', `CSP frame-ancestors ${fa.join(' ')}${xfo ? `; X-Frame-Options ${xfo}` : ''}`);
    if (xfo) {
      if (/^(deny|sameorigin)$/i.test(xfo.trim())) return result(this.id, 'pass', `X-Frame-Options: ${xfo.trim()}`);
      return result(this.id, 'warn', `X-Frame-Options: ${xfo.trim()} (ALLOW-FROM is ignored by modern browsers; use frame-ancestors)`);
    }
    return result(this.id, 'fail', 'neither X-Frame-Options nor CSP frame-ancestors is set');
  },
};
