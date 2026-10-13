import type { CheckModule } from './context.js';
import { result } from './context.js';
import { dkimSelectors, dmarcRecord, spfRecords } from './mail.js';

export const check: CheckModule = {
  id: 'auth-sender-authenticated',
  run(ctx) {
    const selectors = dkimSelectors(ctx);
    const spf = spfRecords(ctx).length === 1;
    const dmarc = dmarcRecord(ctx) !== null;
    const supabase = ctx.ev.supabase !== null;
    if (selectors.length) {
      const missing = [spf ? null : 'SPF', dmarc ? null : 'DMARC'].filter(Boolean);
      if (missing.length) return result(this.id, 'fail', `sending domain ${ctx.ev.apex} (DKIM ${selectors.join(', ')}) lacks ${missing.join(' and ')}`);
      return result(this.id, 'pass', `sending domain ${ctx.ev.apex} has DKIM (${selectors.join(', ')}), SPF and DMARC`);
    }
    if (supabase) {
      return result(
        this.id,
        'warn',
        `no DKIM at ${ctx.ev.apex}; auth emails fall back to the shared Supabase default sender, which lands in spam for many users. Set a custom SMTP sender on an authenticated domain`,
      );
    }
    if (ctx.ev.platformSuffix) return result(this.id, 'skip', `platform subdomain under ${ctx.ev.platformSuffix}; no sending domain to judge`);
    if (!spf && !dmarc && ctx.ev.dns.mx.length === 0) return result(this.id, 'skip', `no DKIM, SPF, DMARC or MX at ${ctx.ev.apex}; no sending domain could be inferred`);
    return result(this.id, 'warn', `no DKIM selector found at ${ctx.ev.apex} (SPF ${spf ? 'yes' : 'no'}, DMARC ${dmarc ? 'yes' : 'no'}); transactional mail cannot be fully authenticated`);
  },
};
