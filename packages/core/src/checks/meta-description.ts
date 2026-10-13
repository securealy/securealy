import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { meta } from '../html.js';

export const check: CheckModule = {
  id: 'meta-description',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const d = (ctx.page ? meta(ctx.page, 'description') : null)?.trim() ?? '';
    if (!d) return result(this.id, 'fail', 'no meta description');
    const n = d.length;
    if (n < 70) return result(this.id, 'warn', `description is ${n} characters, under 70`);
    if (n > 155) return result(this.id, 'warn', `description is ${n} characters, over 155; it will be cut in results`);
    return result(this.id, 'pass', `${n} characters`);
  },
};
