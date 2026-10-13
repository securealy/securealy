import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

export const check: CheckModule = {
  id: 'ai-crawler-policy',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.robots;
    if (!r || r.status !== 200 || r.bodyHint === 'html') return result(this.id, 'fail', 'no usable robots.txt, so no stated policy for AI crawlers');
    const body = (r.body ?? '').toLowerCase();
    const named = BOTS.filter((b) => new RegExp(`^user-agent:\\s*${b.toLowerCase()}\\s*$`, 'm').test(body));
    if (named.length === BOTS.length) return result(this.id, 'pass', `robots.txt states a rule for ${named.join(', ')}`);
    if (named.length) return result(this.id, 'warn', `robots.txt names ${named.join(', ')} but not ${BOTS.filter((b) => !named.includes(b)).join(', ')}`);
    return result(this.id, 'fail', `robots.txt names none of ${BOTS.join(', ')}; the AI crawler policy is accidental`);
  },
};
