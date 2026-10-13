import { result } from '../checks/context.js';
import type { LocalCheckModule } from './context.js';
import { hostFromUrl } from './context.js';

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
  livemode?: boolean;
}

const CHECKOUT_EVENTS = ['checkout.session.completed'];
const PAYMENT_EVENTS = ['payment_intent.succeeded', 'invoice.paid', 'invoice.payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];

export const PRODUCTION_URL_VARS = ['SECUREALY_PRODUCTION_URL', 'PRODUCTION_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_URL', 'PUBLIC_SITE_URL', 'SITE_URL', 'APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];

export const check: LocalCheckModule = {
  id: 'stripe-webhook-wiring',
  async run(ctx) {
    const key = ctx.env('STRIPE_SECRET_KEY');
    if (!key) return result(this.id, 'skip', 'STRIPE_SECRET_KEY not set');
    if (!/^(sk|rk)_(live|test)_/.test(key)) return result(this.id, 'error', 'STRIPE_SECRET_KEY does not look like a Stripe secret key');
    const testMode = /^(sk|rk)_test_/.test(key);
    const prodHost = hostFromUrl(ctx.envAny(...PRODUCTION_URL_VARS));
    let res: Response;
    try {
      res = await ctx.fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', { headers: { authorization: `Bearer ${key}` } });
    } catch (e) {
      return result(this.id, 'error', `Stripe API unreachable: ${(e as Error).message}`.slice(0, 160));
    }
    if (res.status === 401) return result(this.id, 'error', 'Stripe rejected the key (401); check for a trailing newline or a revoked key');
    if (!res.ok) return result(this.id, 'error', `Stripe API answered ${res.status}`);
    const body = (await res.json()) as { data?: WebhookEndpoint[] };
    const endpoints = body.data ?? [];
    const mode = testMode ? 'test mode' : 'live mode';
    if (endpoints.length === 0) return result(this.id, 'fail', `no webhook endpoints in ${mode}; payments succeed and nothing is delivered`);
    const enabled = endpoints.filter((e) => e.status === 'enabled');
    const handles = (e: WebhookEndpoint, events: string[]) => e.enabled_events.includes('*') || events.some((ev) => e.enabled_events.includes(ev));
    const describe = (e: WebhookEndpoint) => `${hostFromUrl(e.url) ?? e.url} (${e.enabled_events.includes('*') ? 'all events' : `${e.enabled_events.length} events`})`;
    if (!prodHost) {
      const good = enabled.filter((e) => handles(e, CHECKOUT_EVENTS));
      if (good.length) return result(this.id, 'warn', `${good.length} enabled endpoint${good.length === 1 ? '' : 's'} subscribe to checkout.session.completed (${good.map(describe).slice(0, 2).join(', ')}) but no production URL is configured to compare; set SECUREALY_PRODUCTION_URL`);
      return result(this.id, 'fail', `${enabled.length} enabled endpoint${enabled.length === 1 ? '' : 's'} in ${mode}, none subscribes to checkout.session.completed`);
    }
    const forHost = endpoints.filter((e) => hostFromUrl(e.url) === prodHost);
    if (forHost.length === 0) return result(this.id, 'fail', `no webhook endpoint for ${prodHost} in ${mode}; existing: ${endpoints.map((e) => hostFromUrl(e.url) ?? '?').slice(0, 3).join(', ')}`);
    const live = forHost.filter((e) => e.status === 'enabled');
    if (live.length === 0) return result(this.id, 'fail', `the endpoint for ${prodHost} is ${forHost[0]?.status ?? 'disabled'}`);
    const withCheckout = live.filter((e) => handles(e, CHECKOUT_EVENTS));
    if (withCheckout.length === 0) return result(this.id, 'fail', `endpoint for ${prodHost} is enabled but does not subscribe to checkout.session.completed (${live[0]?.enabled_events.slice(0, 3).join(', ') || 'no events'})`);
    const withPayments = withCheckout.some((e) => handles(e, PAYMENT_EVENTS));
    const note = testMode ? '; key is test mode, so these are test endpoints' : '';
    if (!withPayments) return result(this.id, 'warn', `endpoint for ${prodHost} handles checkout.session.completed but no payment or subscription events${note}`);
    return result(this.id, 'pass', `enabled endpoint for ${prodHost} subscribes to checkout and payment events${note}`);
  },
};
