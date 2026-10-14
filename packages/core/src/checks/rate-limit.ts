import type { CheckModule } from './context.js';
import { pathOf, result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'rate-limit',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    const b = v.burst;
    if (!b) return result(this.id, 'skip', 'no burst was sent');
    const answered = b.statuses.filter((s) => s > 0).length;
    if (answered === 0) return result(this.id, 'error', `none of the ${b.statuses.length} burst requests to ${pathOf(b.url)} answered`);
    const unusable = b.statuses.filter((s) => s === 404 || s === 405 || s === 410 || s === 501).length;
    if (!b.limited && unusable === answered) return result(this.id, 'skip', `no endpoint accepted the probe (${pathOf(b.url)} answered ${[...new Set(b.statuses)].join('/')}); grade with a token from a project that exposes an API to test its limiter`);
    if (b.limited) return result(this.id, 'pass', `${pathOf(b.url)}: ${b.statuses.filter((s) => s === 429).length} of ${b.statuses.length} rapid requests got 429${b.headers.length ? ` (${b.headers.join(', ')})` : ''}`);
    if (b.headers.length) return result(this.id, 'warn', `${pathOf(b.url)} advertises ${b.headers.join(', ')} but ${b.statuses.length} rapid requests all passed`);
    return result(this.id, 'fail', `${b.statuses.length} rapid requests to ${pathOf(b.url)} all answered ${[...new Set(b.statuses)].join('/')}; no 429`);
  },
};
