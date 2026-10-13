import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'ttfb',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const p = ctx.ev.page;
    if (!p) return result(this.id, 'skip', 'no page');
    const ms = p.ttfbMs;
    const hops = p.redirects.length ? ` after ${p.redirects.length} redirect${p.redirects.length === 1 ? '' : 's'}` : '';
    if (ms < 800) return result(this.id, 'pass', `${ms} ms to first byte${hops}`);
    if (ms < 1600) return result(this.id, 'fail', `${ms} ms to first byte${hops}; target under 800 ms`);
    return result(this.id, 'fail', `${ms} ms to first byte${hops}; the origin is slow or cold-starting`);
  },
};
