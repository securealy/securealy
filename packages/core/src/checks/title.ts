import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'title',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const t = (ctx.page?.title ?? '').trim();
    if (!t) return result(this.id, 'fail', 'no <title>');
    const n = t.length;
    if (n < 30) return result(this.id, 'warn', `title is ${n} characters, under 30: "${t.slice(0, 60)}"`);
    if (n > 60) return result(this.id, 'warn', `title is ${n} characters, over 60: "${t.slice(0, 60)}..."`);
    return result(this.id, 'pass', `${n} characters: "${t}"`);
  },
};
