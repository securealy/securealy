import type { CheckModule } from './context.js';
import { result } from './context.js';

export const check: CheckModule = {
  id: 'dnssec',
  run(ctx) {
    if (ctx.ev.platformSuffix) return result(this.id, 'skip', `platform subdomain; the zone belongs to ${ctx.ev.platformSuffix}`);
    if (ctx.ev.dns.ns.length === 0 && ctx.ev.dns.a.apex.length === 0) return result(this.id, 'skip', `${ctx.ev.apex} does not resolve`);
    const d = ctx.ev.dns.dnssec;
    if (d === true) return result(this.id, 'pass', `${ctx.ev.apex} answers with RRSIG records (zone is signed)`);
    if (d === false) return result(this.id, 'fail', `${ctx.ev.apex} is not signed; no RRSIG or DNSKEY in the answer`);
    if (ctx.ev.dns.errors['dnssec']) return result(this.id, 'error', `DNSSEC query could not be made (${ctx.ev.dns.errors['dnssec']})`);
    return result(this.id, 'skip', 'DNSSEC was not queried (no resolver answered with DNSSEC data)');
  },
};
