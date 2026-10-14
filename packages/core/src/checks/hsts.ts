import type { CheckModule } from './context.js';
import { beforeDeploy, needPage, result } from './context.js';

const SIX_MONTHS = 15_552_000;

export const check: CheckModule = {
  id: 'hsts',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'https on the public hostname');
    if (local) return local;
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const h = ctx.header('strict-transport-security');
    if (!h) return result(this.id, 'fail', 'no Strict-Transport-Security header on the HTML response');
    const m = /max-age\s*=\s*(\d+)/i.exec(h);
    const maxAge = m ? Number(m[1]) : 0;
    if (maxAge >= SIX_MONTHS) {
      return result(this.id, 'pass', `max-age=${maxAge}${/includesubdomains/i.test(h) ? ', includeSubDomains' : ''}${/preload/i.test(h) ? ', preload' : ''}`);
    }
    if (maxAge === 0) return result(this.id, 'fail', `HSTS present but max-age=0 disables it (${h.slice(0, 60)})`);
    return result(this.id, 'warn', `max-age=${maxAge} is under 6 months (${SIX_MONTHS})`);
  },
};
