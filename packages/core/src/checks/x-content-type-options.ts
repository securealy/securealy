import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'x-content-type-options',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const h = ctx.header('x-content-type-options');
    if (h && /nosniff/i.test(h)) return result(this.id, 'pass', 'X-Content-Type-Options: nosniff');
    if (h) return result(this.id, 'fail', `X-Content-Type-Options is "${h.slice(0, 40)}", not nosniff`);
    return result(this.id, 'fail', 'no X-Content-Type-Options header');
  },
};
