import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'referrer-policy',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const h = ctx.header('referrer-policy');
    if (h) {
      if (/unsafe-url|^\s*origin-when-cross-origin\s*$|^\s*no-referrer-when-downgrade\s*$/i.test(h)) {
        return result(this.id, 'warn', `Referrer-Policy: ${h.trim()} still sends the full URL to other origins in some cases`);
      }
      return result(this.id, 'pass', `Referrer-Policy: ${h.trim().slice(0, 60)}`);
    }
    const m = ctx.page?.metas.find((x) => x.name === 'referrer');
    if (m) return result(this.id, 'pass', `meta referrer="${m.content.slice(0, 40)}"`);
    return result(this.id, 'fail', 'no Referrer-Policy header or meta referrer');
  },
};
