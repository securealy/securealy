import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'h1',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const n = ctx.page?.h1Count ?? 0;
    if (n === 1) return result(this.id, 'pass', 'exactly one <h1>');
    if (n === 0) return result(this.id, 'fail', 'no <h1> on the home page (client-rendered pages ship an empty shell to crawlers)');
    return result(this.id, 'warn', `${n} <h1> elements; keep one`);
  },
};
