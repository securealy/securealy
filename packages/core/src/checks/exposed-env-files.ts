import type { CheckModule } from './context.js';
import { pathOf, result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'exposed-env-files',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    const served = v.envFiles.filter((r) => r.status === 200 && r.bodyHint !== 'html');
    if (served.length) return result(this.id, 'fail', `${served.map((r) => `${pathOf(r.url)} (200, ${r.bodyHint ?? 'body'})`).slice(0, 3).join(', ')} served to anyone`);
    const soft = v.envFiles.filter((r) => r.status === 200).length;
    const statuses = [...new Set(v.envFiles.map((r) => r.status))].join('/');
    return result(this.id, 'pass', `${v.envFiles.length} env paths answer ${statuses}${soft ? ` (${soft} answer the app shell, not a file)` : ''}`);
  },
};
