import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'render-blocking',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const scripts = page.scripts.filter((s) => s.inHead && s.src && !s.async && !s.defer && !s.module).length;
    const styles = page.links.filter((l) => l.inHead && l.rel.split(/\s+/).includes('stylesheet') && !(l.media && /print/i.test(l.media))).length;
    const total = scripts + styles;
    const text = `${scripts} blocking script${scripts === 1 ? '' : 's'} and ${styles} stylesheet${styles === 1 ? '' : 's'} in <head>`;
    if (total >= 4) return result(this.id, 'fail', `${text}; add defer or async, inline critical CSS`);
    return result(this.id, 'pass', text);
  },
};
