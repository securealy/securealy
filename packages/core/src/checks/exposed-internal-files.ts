import type { CheckModule } from './context.js';
import { pathOf, result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'exposed-internal-files',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    const served = v.internalFiles.filter((r) => r.status === 200 && r.bodyHint !== 'html' && r.bodyHint !== 'empty');
    if (served.length) return result(this.id, 'fail', `${served.map((r) => `${pathOf(r.url)} (${r.bodyHint ?? 'body'})`).slice(0, 4).join(', ')} served`);
    const statuses = [...new Set(v.internalFiles.map((r) => r.status))].join('/');
    return result(this.id, 'pass', `${v.internalFiles.length} internal paths answer ${statuses}`);
  },
};
