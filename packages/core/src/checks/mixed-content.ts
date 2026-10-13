import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'mixed-content',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    if (!/^https:/i.test(ctx.ev.finalUrl)) return result(this.id, 'skip', 'page is not served over https (see https-redirect)');
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const bad: string[] = [];
    for (const s of page.scripts) if (s.src && /^http:\/\//i.test(s.src)) bad.push(`script ${s.src}`);
    for (const l of page.links) if (/stylesheet|preload|modulepreload|icon/.test(l.rel) && /^http:\/\//i.test(l.href)) bad.push(`${l.rel} ${l.href}`);
    for (const i of page.images) if (/^http:\/\//i.test(i.src)) bad.push(`img ${i.src}`);
    for (const f of page.iframes) if (/^http:\/\//i.test(f)) bad.push(`iframe ${f}`);
    if (bad.length) return result(this.id, 'fail', `${bad.length} http:// asset${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 2).map((b) => b.slice(0, 70)).join(', ')}`);
    return result(this.id, 'pass', 'no http:// scripts, styles, images or frames');
  },
};
