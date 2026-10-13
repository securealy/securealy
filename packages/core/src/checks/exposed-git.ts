import type { CheckModule } from './context.js';
import { pathOf, result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'exposed-git',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    const served = v.git.filter((r) => r.status === 200 && (r.bodyHint === 'git' || r.bodyHint === 'text' || r.bodyHint === 'env'));
    if (served.length) return result(this.id, 'fail', `${served.map((r) => pathOf(r.url)).join(', ')} served (200); the whole repository can be downloaded`);
    const statuses = [...new Set(v.git.map((r) => r.status))].join('/');
    return result(this.id, 'pass', `/.git/config and /.git/HEAD answer ${statuses}`);
  },
};
