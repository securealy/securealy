import type { CheckModule } from './context.js';
import { result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'supabase-anon-row-read',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    if (!ctx.ev.supabase) return result(this.id, 'skip', 'no Supabase URL in the page');
    if (v.tableReads.length === 0) return result(this.id, 'skip', ctx.ev.supabase.tables.length ? 'no table reads were made' : 'the REST root lists no tables, nothing to read');
    const leaking = v.tableReads.filter((t) => t.rows === true);
    if (leaking.length) {
      const list = leaking.map((t) => `${t.table}${t.count !== null ? ` (${t.count} rows)` : ''}`).slice(0, 4).join(', ');
      return result(this.id, 'fail', `${leaking.length} of ${v.tableReads.length} tables return rows to the anon key: ${list}`);
    }
    const unknown = v.tableReads.filter((t) => t.rows === null);
    if (unknown.length === v.tableReads.length) return result(this.id, 'error', `${unknown.length} table reads gave no usable answer (${unknown[0]?.error ?? `status ${unknown[0]?.status}`})`);
    return result(this.id, 'pass', `${v.tableReads.length} table${v.tableReads.length === 1 ? '' : 's'} return zero rows to an anonymous select`);
  },
};
