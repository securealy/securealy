import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { isPreLaunchHost } from '../fetcher/safe.js';

/** An http:// URL that will become mixed content once the site is served over https. On a local server its own address does not count. */
function plainHttp(u: string, preLaunch: boolean): boolean {
  if (!/^http:\/\//i.test(u)) return false;
  if (!preLaunch) return true;
  try {
    return !isPreLaunchHost(new URL(u).hostname);
  } catch {
    return true;
  }
}

export const check: CheckModule = {
  id: 'mixed-content',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const preLaunch = ctx.ev.preLaunch === true;
    if (!preLaunch && !/^https:/i.test(ctx.ev.finalUrl)) return result(this.id, 'skip', 'page is not served over https (see https-redirect)');
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const bad: string[] = [];
    for (const s of page.scripts) if (s.src && plainHttp(s.src, preLaunch)) bad.push(`script ${s.src}`);
    for (const l of page.links) if (/stylesheet|preload|modulepreload|icon/.test(l.rel) && plainHttp(l.href, preLaunch)) bad.push(`${l.rel} ${l.href}`);
    for (const i of page.images) if (plainHttp(i.src, preLaunch)) bad.push(`img ${i.src}`);
    for (const f of page.iframes) if (plainHttp(f, preLaunch)) bad.push(`iframe ${f}`);
    if (bad.length) return result(this.id, 'fail', `${bad.length} http:// asset${bad.length === 1 ? '' : 's'}${preLaunch ? ' (mixed content once served over https)' : ''}: ${bad.slice(0, 2).map((b) => b.slice(0, 70)).join(', ')}`);
    return result(this.id, 'pass', preLaunch ? 'no http:// scripts, styles, images or frames beyond the local server itself' : 'no http:// scripts, styles, images or frames');
  },
};
