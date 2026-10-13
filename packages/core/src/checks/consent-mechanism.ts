import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { detectStack } from '../stack.js';

const CONSENT_MARKERS = /cookieconsent|cookie-consent|cookie-banner|cookiebanner|cookiebot|onetrust|iubenda|termly|osano|klaro|cookieyes|usercentrics|didomi|axeptio|quantcast|consentmanager|cmp\.js|gtag\(['"]consent['"]/;
const CONSENT_TEXT = /we use cookies|this (web)?site uses cookies|accept all cookies|cookie settings|cookie preferences|manage cookies|reject all/;
const COOKIELESS = ['plausible', 'fathom', 'umami', 'simpleanalytics', 'vercel-analytics'];

export const check: CheckModule = {
  id: 'consent-mechanism',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const analytics = detectStack(ctx.ev, page).analytics ?? [];
    const tracking = analytics.filter((a) => !COOKIELESS.includes(a));
    const hasConsent = CONSENT_MARKERS.test(page.markers) || CONSENT_TEXT.test(page.text);
    if (hasConsent) return result(this.id, 'pass', `consent control present${tracking.length ? ` (${tracking.join(', ')} loaded)` : ''}`);
    if (analytics.length === 0) return result(this.id, 'pass', 'no tracking detected, nothing to consent to');
    if (tracking.length === 0) return result(this.id, 'pass', `only cookieless analytics (${analytics.join(', ')}); no consent banner needed for them`);
    return result(this.id, 'warn', `${tracking.join(', ')} loads with no consent control found; required if EU or UK visitors are in scope`);
  },
};
