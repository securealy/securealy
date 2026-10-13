import type { CheckModule } from './context.js';
import { pathOf, result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'open-admin-routes',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    if (v.routes.length === 0) return result(this.id, 'skip', 'no admin or API routes discovered in the sitemap, page or bundles');
    const open = v.routes.filter((r) => r.record.status === 200 && (r.record.bodyHint === 'json' || r.record.bodyHint === 'xml' || r.record.bodyHint === 'text'));
    if (open.length) {
      return result(this.id, 'fail', `${open.length} of ${v.routes.length} route${v.routes.length === 1 ? '' : 's'} return data anonymously: ${open.map((r) => pathOf(r.url)).slice(0, 3).join(', ')}`);
    }
    const shells = v.routes.filter((r) => r.record.status === 200).length;
    const refusing = v.routes.filter((r) => [401, 403, 405].includes(r.record.status)).length;
    const notFound = v.routes.filter((r) => r.record.status === 404).length;
    const summary = `${v.routes.length} probed: ${refusing} refuse, ${notFound} 404${shells ? `, ${shells} answer the HTML shell (authorization must then happen in the API, not the page)` : ''}`;
    if (shells && refusing === 0) return result(this.id, 'warn', summary);
    return result(this.id, 'pass', summary);
  },
};
