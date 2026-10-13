import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'llms-txt',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.llmsTxt;
    if (!r) return result(this.id, 'skip', '/llms.txt was not requested');
    if (r.status === 200 && r.bodyHint !== 'html') return result(this.id, 'pass', `/llms.txt present (${r.bytes} bytes)`);
    if (r.status === 200) return result(this.id, 'fail', '/llms.txt answers 200 with HTML (soft 404)');
    return result(this.id, 'fail', `/llms.txt answers ${describe(r)}`);
  },
};
