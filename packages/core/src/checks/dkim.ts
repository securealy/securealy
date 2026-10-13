import type { CheckModule } from './context.js';
import { result } from './context.js';
import { dkimSelectors, knownSelectorProvider, noMailExpected, noSendingExpected } from './mail.js';
import { DKIM_SELECTORS } from '../fetcher/dns.js';

export const check: CheckModule = {
  id: 'dkim',
  run(ctx) {
    const gate = noMailExpected(ctx, this.id) ?? noSendingExpected(ctx, this.id);
    if (gate) return gate;
    const found = dkimSelectors(ctx);
    if (found.length) return result(this.id, 'pass', `DKIM found for selector${found.length === 1 ? '' : 's'} ${found.join(', ')} at ${ctx.ev.apex}`);
    const queried = Object.keys(ctx.ev.dns.dkim).length || DKIM_SELECTORS.length;
    const provider = knownSelectorProvider(ctx);
    // A miss on a provider with fixed selectors is conclusive; otherwise the selector may simply be one we did not guess (SES and Postmark randomize theirs).
    if (provider) return result(this.id, 'fail', `SPF names ${provider} but its DKIM selector does not resolve at _domainkey.${ctx.ev.apex}; ${queried} common selectors tried`);
    return result(this.id, 'warn', `none of ${queried} common DKIM selectors resolve at _domainkey.${ctx.ev.apex} (${DKIM_SELECTORS.slice(0, 6).join(', ')}, ...); a provider with a custom selector would not be seen, confirm DKIM in its dashboard`);
  },
};
