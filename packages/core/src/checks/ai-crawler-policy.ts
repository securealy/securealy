import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];

export const check: CheckModule = {
  id: 'ai-crawler-policy',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.robots;
    // No robots.txt is already the robots-txt finding; there is nothing more to judge here.
    if (!r || r.status !== 200 || r.bodyHint === 'html') return result(this.id, 'skip', 'no usable robots.txt (see robots-txt), so no AI crawler policy can be read');
    const body = (r.body ?? '').toLowerCase();
    const named = BOTS.filter((b) => new RegExp(`^user-agent:\\s*${b.toLowerCase()}\\s*$`, 'm').test(body));
    if (named.length === BOTS.length) return result(this.id, 'pass', `robots.txt states a rule for ${named.join(', ')}`);
    if (named.length) return result(this.id, 'warn', `robots.txt names ${named.join(', ')} but not ${BOTS.filter((b) => !named.includes(b)).join(', ')}`);
    return result(this.id, 'warn', `robots.txt names none of ${BOTS.join(', ')}; the default applies to them, state a choice either way`);
  },
};
