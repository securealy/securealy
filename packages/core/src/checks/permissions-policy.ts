import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'permissions-policy',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const h = ctx.header('permissions-policy');
    if (h) {
      const n = h.split(',').filter((x) => x.trim()).length;
      return result(this.id, 'pass', `Permissions-Policy with ${n} feature${n === 1 ? '' : 's'}: ${h.slice(0, 80)}`);
    }
    const legacy = ctx.header('feature-policy');
    if (legacy) return result(this.id, 'warn', 'only the legacy Feature-Policy header is set; add Permissions-Policy');
    return result(this.id, 'fail', 'no Permissions-Policy header');
  },
};
