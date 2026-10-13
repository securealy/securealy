import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'supabase-rest-exposed',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const sb = ctx.ev.supabase;
    if (!sb) return result(this.id, 'skip', 'no Supabase URL in the page or bundles');
    if (!sb.rest) return result(this.id, 'skip', `Supabase URL found (${sb.url}) but no anon key shipped, nothing to test`);
    if (sb.rest.status === 0) return result(this.id, 'error', `REST root did not answer: ${sb.rest.error ?? 'unknown'}`);
    if (sb.rest.status === 200 && sb.tables.length > 0) {
      const names = sb.tables.slice(0, 5).join(', ');
      return result(this.id, 'fail', `REST root lists ${sb.tables.length} table${sb.tables.length === 1 ? '' : 's'} to the anon key: ${names}${sb.tables.length > 5 ? ', ...' : ''}`);
    }
    if (sb.rest.status === 200) return result(this.id, 'pass', 'REST root answers the anon key but lists no tables');
    return result(this.id, 'pass', `REST root answers ${sb.rest.status} to the anon key`);
  },
};
