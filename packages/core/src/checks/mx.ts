import type { CheckModule } from './context.js';
import { result } from './context.js';
import { noMailExpected } from './mail.js';

export const check: CheckModule = {
  id: 'mx',
  run(ctx) {
    const gate = noMailExpected(ctx, this.id);
    if (gate) return gate;
    const mx = ctx.ev.dns.mx;
    if (mx.length === 0) return result(this.id, 'fail', `no MX records at ${ctx.ev.apex}; mail to this domain bounces`);
    if (mx.length === 1 && (mx[0]?.exchange === '' || mx[0]?.exchange === '.')) return result(this.id, 'fail', `null MX at ${ctx.ev.apex}: the domain declares it receives no mail`);
    return result(this.id, 'pass', `${mx.length} MX record${mx.length === 1 ? '' : 's'}, primary ${mx[0]?.exchange}`);
  },
};
