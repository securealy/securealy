import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';

export const check: CheckModule = {
  id: 'tls-expiry',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'a TLS certificate on the public hostname');
    if (local) return local;
    const t = ctx.ev.tls;
    if (!t.connected || t.daysRemaining === undefined) return result(this.id, 'skip', 'no certificate to inspect');
    if (t.daysRemaining < 0) return result(this.id, 'fail', `certificate expired ${-t.daysRemaining} days ago (${t.validTo})`);
    if (t.daysRemaining <= 14) return result(this.id, 'fail', `${t.daysRemaining} days left (${t.validTo}); renew now`);
    return result(this.id, 'pass', `${t.daysRemaining} days left (expires ${t.validTo?.slice(0, 10)})`);
  },
};
