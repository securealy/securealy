import type { CheckModule } from './context.js';
import { needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'source-maps',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const referenced = ctx.ev.bundles.filter((b) => b.body && /\/\/[#@]\s*sourceMappingURL=/.test(b.body.slice(-600)));
    const reachable = ctx.ev.sourceMaps.filter((m) => m.status === 200);
    if (reachable.length) return result(this.id, 'fail', `${reachable.length} source map${reachable.length === 1 ? '' : 's'} served: ${reachable.map((m) => pathOf(m.url)).slice(0, 2).join(', ')}`);
    if (referenced.length) return result(this.id, 'pass', `${referenced.length} bundle${referenced.length === 1 ? '' : 's'} reference a .map that does not resolve (${ctx.ev.sourceMaps.map((m) => m.status).join(', ') || 'not fetched'})`);
    if (ctx.ev.bundles.length === 0) return result(this.id, 'pass', 'no first-party bundles on the home page');
    return result(this.id, 'pass', `${ctx.ev.bundles.length} bundle${ctx.ev.bundles.length === 1 ? '' : 's'} checked, no sourceMappingURL`);
  },
};
