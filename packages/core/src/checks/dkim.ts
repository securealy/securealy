import type { CheckModule } from './context.js';
import { result } from './context.js';
import { dkimSelectors, noMailExpected } from './mail.js';
import { DKIM_SELECTORS } from '../fetcher/dns.js';

export const check: CheckModule = {
  id: 'dkim',
  run(ctx) {
    const gate = noMailExpected(ctx, this.id);
    if (gate) return gate;
    const found = dkimSelectors(ctx);
    if (found.length) return result(this.id, 'pass', `DKIM found for selector${found.length === 1 ? '' : 's'} ${found.join(', ')} at ${ctx.ev.apex}`);
    return result(this.id, 'fail', `no DKIM record for the common selectors (${DKIM_SELECTORS.join(', ')}) at ${ctx.ev.apex}`);
  },
};
