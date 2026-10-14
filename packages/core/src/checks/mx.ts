import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';
import { declaresNoSending, hasNullMx, noMailExpected } from './mail.js';

export const check: CheckModule = {
  id: 'mx',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'DNS records on the registered domain');
    if (local) return local;
    const gate = noMailExpected(ctx, this.id);
    if (gate) return gate;
    const mx = ctx.ev.dns.mx;
    // A null MX (RFC 7505) or a "v=spf1 -all" with no MX is a deliberate no-mail domain, not an oversight; replies still bounce, so say so without failing it.
    if (hasNullMx(ctx)) return result(this.id, 'warn', `null MX at ${ctx.ev.apex}: the domain deliberately receives no mail (RFC 7505); any reply-to or support address must live on another domain`);
    if (mx.length === 0 && declaresNoSending(ctx)) return result(this.id, 'warn', `no MX at ${ctx.ev.apex} and SPF is "v=spf1 -all": the domain opts out of mail entirely; fine if no address on it is ever shown to users`);
    if (mx.length === 0) return result(this.id, 'fail', `no MX records at ${ctx.ev.apex}; mail to this domain bounces`);
    return result(this.id, 'pass', `${mx.length} MX record${mx.length === 1 ? '' : 's'}, primary ${mx[0]?.exchange}`);
  },
};
