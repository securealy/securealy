import type { CheckModule } from './context.js';
import { describe, needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'favicon',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const f = ctx.ev.favicon;
    if (!f) {
      const inline = ctx.page?.links.find((l) => /(^|\s)icon(\s|$)/.test(l.rel) && /^data:/i.test(l.href.trim()));
      if (inline) return result(this.id, 'pass', `inline data: icon declared in <link rel="icon">`);
      return result(this.id, 'skip', 'favicon was not requested');
    }
    if (f.status === 200) return result(this.id, 'pass', `${pathOf(f.url)} resolves (${(f.headers['content-type'] ?? 'unknown type').split(';')[0]})`);
    return result(this.id, 'fail', `${pathOf(f.url)} answers ${describe(f)}`);
  },
};
