import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { meta } from '../html.js';

export const check: CheckModule = {
  id: 'lang-viewport',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const lang = (page.lang ?? '').trim();
    const viewport = meta(page, 'viewport');
    const missing = [lang ? null : '<html lang>', viewport ? null : 'viewport meta'].filter(Boolean);
    if (missing.length) return result(this.id, 'fail', `missing ${missing.join(' and ')}`);
    return result(this.id, 'pass', `lang="${lang}", viewport="${(viewport ?? '').slice(0, 50)}"`);
  },
};
