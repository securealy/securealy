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
    // One cold sample from one vantage point includes DNS, TCP and TLS setup; a mild miss is a note, a clear miss is the finding.
    if (ms < 1600) return result(this.id, 'warn', `${ms} ms to first byte${hops} on a single cold connection (includes DNS, TCP and TLS setup); target under 800 ms, confirm with a second measurement`);
    return result(this.id, 'fail', `${ms} ms to first byte${hops}; the origin is slow or cold-starting`);
  },
};
