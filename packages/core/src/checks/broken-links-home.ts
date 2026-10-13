import type { CheckModule } from './context.js';
import { describe, needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'broken-links-home',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const samples = ctx.ev.linkSamples;
    if (samples.length === 0) return result(this.id, 'skip', 'no internal links were sampled (none on the page, or request budget spent)');
    const bad = samples.filter((r) => r.status === 0 || (r.status >= 400 && r.status !== 405 && r.status !== 403));
    if (bad.length) return result(this.id, 'fail', `${bad.length} of ${samples.length} sampled links fail: ${bad.map((b) => `${pathOf(b.url)} ${describe(b)}`).slice(0, 2).join(', ')}`);
    return result(this.id, 'pass', `${samples.length} internal link${samples.length === 1 ? '' : 's'} sampled, all resolve`);
  },
};
