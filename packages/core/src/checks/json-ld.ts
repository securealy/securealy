import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'json-ld',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const blocks = ctx.page?.jsonLd ?? [];
    if (blocks.length === 0) return result(this.id, 'skip', 'no JSON-LD blocks on the home page');
    const types: string[] = [];
    let broken = 0;
    for (const b of blocks) {
      try {
        const parsed = JSON.parse(b) as { '@type'?: unknown; '@graph'?: { '@type'?: unknown }[] };
        const t = parsed['@type'] ?? parsed['@graph']?.map((g) => g['@type']).join('+');
        if (t) types.push(String(t));
      } catch {
        broken += 1;
      }
    }
    if (broken) return result(this.id, 'fail', `${broken} of ${blocks.length} JSON-LD block${blocks.length === 1 ? '' : 's'} do not parse as JSON`);
    return result(this.id, 'pass', `${blocks.length} block${blocks.length === 1 ? '' : 's'} parse${types.length ? ` (${types.slice(0, 4).join(', ')})` : ''}`);
  },
};
