import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';
import { noMailExpected, spfRecords } from './mail.js';

export const check: CheckModule = {
  id: 'spf',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'DNS records on the registered domain');
    if (local) return local;
    const gate = noMailExpected(ctx, this.id);
    if (gate) return gate;
    const spf = spfRecords(ctx);
    if (spf.length === 0) return result(this.id, 'fail', `no v=spf1 TXT record at ${ctx.ev.apex}`);
    if (spf.length > 1) return result(this.id, 'fail', `${spf.length} SPF records at ${ctx.ev.apex}; receivers treat that as none`);
    const rec = spf[0] ?? '';
    if (/\s\+all\b/.test(rec)) return result(this.id, 'warn', `SPF ends in +all, which authorizes every sender: ${rec.slice(0, 80)}`);
    const lookups = (rec.match(/\b(include|a|mx|ptr|exists|redirect)[:=\s]/gi) ?? []).length;
    if (lookups > 10) return result(this.id, 'warn', `SPF has ${lookups} lookup mechanisms (limit 10): ${rec.slice(0, 80)}`);
    return result(this.id, 'pass', rec.slice(0, 100));
  },
};
