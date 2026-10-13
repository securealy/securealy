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
    // Optional hygiene, so its absence is a note rather than a failure.
    if (r.status === 200) return result(this.id, 'warn', '/llms.txt answers 200 with HTML (the catch-all page), so there is no llms.txt; optional, add one if AI answer engines matter to you');
    return result(this.id, 'warn', `/llms.txt answers ${describe(r)}; optional, add one if AI answer engines matter to you`);
  },
};
