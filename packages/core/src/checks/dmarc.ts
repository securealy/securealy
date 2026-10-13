import type { CheckModule } from './context.js';
import { result } from './context.js';
import { dmarcRecord, noMailExpected } from './mail.js';

export const check: CheckModule = {
  id: 'dmarc',
  run(ctx) {
    const gate = noMailExpected(ctx, this.id);
    if (gate) return gate;
    const rec = dmarcRecord(ctx);
    if (!rec) return result(this.id, 'fail', `no v=DMARC1 record at _dmarc.${ctx.ev.apex}`);
    const policy = /\bp=([a-z]+)/i.exec(rec)?.[1]?.toLowerCase() ?? 'none';
    const rua = /\brua=/i.test(rec);
    if (policy === 'none' && !rua) return result(this.id, 'fail', `DMARC p=none with no rua reporting address: ${rec.slice(0, 80)}`);
    if (policy === 'none') return result(this.id, 'warn', `DMARC p=none only monitors; move to quarantine or reject (${rec.slice(0, 60)})`);
    if (!rua) return result(this.id, 'warn', `DMARC p=${policy} but no rua= reporting address`);
    return result(this.id, 'pass', `p=${policy} with reporting (${rec.slice(0, 80)})`);
  },
};
