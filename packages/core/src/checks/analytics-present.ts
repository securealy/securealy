import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { detectStack } from '../stack.js';

export const check: CheckModule = {
  id: 'analytics-present',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const a = detectStack(ctx.ev, ctx.page).analytics ?? [];
    if (a.length) return result(this.id, 'pass', `${a.join(', ')} loaded`);
    return result(this.id, 'fail', 'no GA4, Plausible, PostHog, Fathom, Umami or equivalent on the home page');
  },
};
