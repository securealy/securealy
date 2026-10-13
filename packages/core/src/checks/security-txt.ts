import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'security-txt',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.securityTxt;
    if (!r) return result(this.id, 'skip', '/.well-known/security.txt was not requested');
    if (r.status !== 200) return result(this.id, 'fail', `/.well-known/security.txt answers ${describe(r)}`);
    if (r.bodyHint === 'html') return result(this.id, 'fail', '/.well-known/security.txt answers 200 with an HTML page (soft 404)');
    const body = r.body ?? '';
    const contact = /^contact:\s*\S+/im.test(body);
    const expires = /^expires:\s*\S+/im.test(body);
    if (!contact) return result(this.id, 'warn', 'security.txt exists but has no Contact: line');
    return result(this.id, 'pass', `Contact present${expires ? ', Expires present' : ', no Expires line'}`);
  },
};
