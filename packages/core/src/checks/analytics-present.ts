import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { detectStack } from '../stack.js';

/** A preconnect or dns-prefetch to a tag host says the tag loads later (after consent, or from a client component). */
const TAG_HOSTS = /googletagmanager\.com|google-analytics\.com|plausible\.io|posthog\.com|usefathom\.com|umami\.is|mixpanel\.com|segment\.(?:com|io)|hotjar\.com|clarity\.ms|simpleanalyticscdn\.com/i;

export const check: CheckModule = {
  id: 'analytics-present',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const a = detectStack(ctx.ev, ctx.page).analytics ?? [];
    if (a.length) return result(this.id, 'pass', `${a.join(', ')} loaded (tag script or bootstrap found in the HTML or first-party bundles)`);
    const hint = ctx.page?.links.find((l) => /(^|\s)(preconnect|dns-prefetch)(\s|$)/.test(l.rel) && TAG_HOSTS.test(l.href));
    if (hint) {
      const host = (() => { try { return new URL(hint.href).hostname; } catch { return hint.href.slice(0, 40); } })();
      return result(this.id, 'warn', `${hint.rel} to ${host} but no tag script in the HTML or ${ctx.ev.bundles.length} sampled bundle${ctx.ev.bundles.length === 1 ? '' : 's'}; expected if analytics loads after consent, otherwise the tag is missing`);
    }
    return result(this.id, 'fail', `no GA4, GTM, Plausible, PostHog, Fathom, Umami or equivalent script host in the HTML or ${ctx.ev.bundles.length} sampled bundle${ctx.ev.bundles.length === 1 ? '' : 's'}`);
  },
};
