import type { CheckModule } from './context.js';
import { describe, needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'sitemap',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const s = ctx.ev.sitemap;
    if (!s) return result(this.id, 'skip', '/sitemap.xml was not requested');
    if (s.status !== 200) {
      const other = /^sitemap:\s*(\S+)/im.exec(ctx.ev.robots?.body ?? '')?.[1];
      if (other && !/\/sitemap\.xml$/i.test(other)) return result(this.id, 'warn', `/sitemap.xml answers ${describe(s)}; robots.txt names ${other} which was not fetched`);
      return result(this.id, 'fail', `/sitemap.xml answers ${describe(s)}`);
    }
    if (s.bodyHint === 'html') return result(this.id, 'fail', '/sitemap.xml answers 200 with HTML (soft 404)');
    const n = ctx.ev.sitemapUrls.length;
    if (n === 0) return result(this.id, 'fail', '/sitemap.xml answers 200 but contains no <loc> entries');
    const bad = ctx.ev.sitemapSamples.filter((r) => r.status === 0 || r.status >= 400);
    if (bad.length) return result(this.id, 'fail', `${bad.length} of ${ctx.ev.sitemapSamples.length} sampled URLs fail: ${bad.map((b) => `${pathOf(b.url)} ${describe(b)}`).slice(0, 2).join(', ')}`);
    const redirected = ctx.ev.sitemapSamples.filter((r) => r.redirects.length > 0).length;
    if (redirected) return result(this.id, 'warn', `${n} URLs; ${redirected} of ${ctx.ev.sitemapSamples.length} sampled redirect (list final URLs)`);
    return result(this.id, 'pass', `${n} URL${n === 1 ? '' : 's'}; ${ctx.ev.sitemapSamples.length} sampled, all 200`);
  },
};
