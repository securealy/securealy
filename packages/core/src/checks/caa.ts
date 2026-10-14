import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';

export const check: CheckModule = {
  id: 'caa',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'a registered domain');
    if (local) return local;
    if (ctx.ev.platformSuffix) return result(this.id, 'skip', `platform subdomain; CAA belongs to ${ctx.ev.platformSuffix}`);
    if (ctx.ev.dns.ns.length === 0 && ctx.ev.dns.a.apex.length === 0) return result(this.id, 'skip', `${ctx.ev.apex} does not resolve`);
    const caa = ctx.ev.dns.caa;
    if (caa.length === 0) return result(this.id, 'fail', `no CAA record at ${ctx.ev.apex}; any authority may issue certificates for it`);
    return result(this.id, 'pass', caa.slice(0, 3).join('; '));
  },
};
