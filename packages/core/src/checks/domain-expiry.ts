import type { CheckModule } from './context.js';
import { result } from './context.js';

export const check: CheckModule = {
  id: 'domain-expiry',
  run(ctx) {
    const r = ctx.ev.rdap;
    if (r.skipped) return result(this.id, 'skip', r.skipped);
    if (r.error === 'domain not found in RDAP') return result(this.id, 'fail', `${ctx.ev.apex} is not registered according to RDAP`);
    if (!r.expires) {
      const unresolved = ctx.ev.dns.ns.length === 0 && ctx.ev.dns.a.apex.length === 0;
      if (unresolved) return result(this.id, 'skip', `${ctx.ev.apex} does not resolve and RDAP gave no answer (${r.error ?? 'no data'})`);
      return result(this.id, 'error', `registration expiry unavailable (${r.error ?? 'no RDAP data'})`);
    }
    const exp = new Date(r.expires);
    if (Number.isNaN(exp.getTime())) return result(this.id, 'error', `RDAP expiry did not parse: ${r.expires}`);
    const now = new Date(ctx.ev.startedAt);
    const days = Math.floor((exp.getTime() - now.getTime()) / 86_400_000);
    const who = r.registrar ? ` at ${r.registrar}` : '';
    if (days < 0) return result(this.id, 'fail', `${ctx.ev.apex} expired ${-days} days ago${who}`);
    if (days <= 30) return result(this.id, 'fail', `${ctx.ev.apex} expires in ${days} days (${r.expires.slice(0, 10)})${who}`);
    return result(this.id, 'pass', `${ctx.ev.apex} expires in ${days} days (${r.expires.slice(0, 10)})${who}`);
  },
};
