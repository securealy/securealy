import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'robots-txt',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.robots;
    if (!r) return result(this.id, 'skip', '/robots.txt was not requested');
    if (r.status !== 200) return result(this.id, 'fail', `/robots.txt answers ${describe(r)}`);
    if (r.bodyHint === 'html') return result(this.id, 'fail', '/robots.txt answers 200 with HTML (soft 404); crawlers cannot parse it');
    const ct = (r.headers['content-type'] ?? '').toLowerCase();
    const body = r.body ?? '';
    const sitemap = /^sitemap:\s*\S+/im.test(body);
    const blocksAll = /^user-agent:\s*\*\s*\r?\n(?:[^\n]*\r?\n)*?disallow:\s*\/\s*$/im.test(body);
    if (blocksAll) return result(this.id, 'fail', 'robots.txt disallows / for every crawler; the site cannot be indexed');
    if (!sitemap) return result(this.id, 'warn', `robots.txt is served${ct && !ct.includes('text/plain') ? ` as ${ct.split(';')[0]}` : ''} but names no Sitemap:`);
    if (ct && !ct.includes('text/plain')) return result(this.id, 'warn', `robots.txt names a sitemap but is served as ${ct.split(';')[0]}, not text/plain`);
    return result(this.id, 'pass', `200 text/plain, names a sitemap`);
  },
};
