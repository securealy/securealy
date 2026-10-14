import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { resolveUrl } from '../html.js';
import { isPreLaunchHost } from '../fetcher/safe.js';

function norm(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    x.search = '';
    return `${x.protocol}//${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return u;
  }
}

export const check: CheckModule = {
  id: 'canonical',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const links = (ctx.page?.links ?? []).filter((l) => l.rel.split(/\s+/).includes('canonical'));
    if (links.length === 0) return result(this.id, 'fail', 'no <link rel="canonical">');
    if (links.length > 1) return result(this.id, 'warn', `${links.length} canonical links; crawlers ignore conflicting ones`);
    const href = links[0]?.href ?? '';
    const abs = resolveUrl(ctx.ev.finalUrl, href);
    if (!abs) return result(this.id, 'fail', `canonical href is not a URL: ${href.slice(0, 60)}`);
    if (!/^https?:\/\//i.test(href)) return result(this.id, 'warn', `canonical is relative (${href.slice(0, 60)}); use an absolute URL`);
    if (ctx.ev.preLaunch) {
      // The right canonical for a local build is the public URL it will live at; the local address is the one mistake to catch.
      if (isPreLaunchHost(new URL(abs).hostname)) return result(this.id, 'warn', `canonical names the local address (${abs}); set it to the public URL before deploy`);
      return result(this.id, 'pass', `canonical ${abs} (the public URL; judged against the deployed page after launch)`);
    }
    if (norm(abs) === norm(ctx.ev.finalUrl)) return result(this.id, 'pass', `canonical ${abs}`);
    return result(this.id, 'warn', `canonical points elsewhere: ${abs} (page is ${ctx.ev.finalUrl})`);
  },
};
