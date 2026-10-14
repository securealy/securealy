import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';
import { detectDnsProvider } from '../stack.js';

export const check: CheckModule = {
  id: 'nameservers',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'a registered domain');
    if (local) return local;
    const ns = ctx.ev.dns.ns;
    if (ns.length === 0) {
      if (ctx.ev.platformSuffix) return result(this.id, 'skip', `platform subdomain; DNS is managed by ${ctx.ev.platformSuffix}`);
      return result(this.id, 'fail', `no NS records for ${ctx.ev.apex}${ctx.ev.dns.errors['ns'] ? ` (${ctx.ev.dns.errors['ns']})` : ''}`);
    }
    const provider = detectDnsProvider(ns);
    return result(this.id, 'pass', `${ns.length} nameserver${ns.length === 1 ? '' : 's'} (${provider ?? 'unknown'}): ${ns.slice(0, 2).join(', ')}`);
  },
};
