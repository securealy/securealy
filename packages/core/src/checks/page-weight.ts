import type { CheckModule } from './context.js';
import { beforeDeploy, kb, needPage, result } from './context.js';

const LIMIT = 2_000_000;

export const check: CheckModule = {
  id: 'page-weight',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'the production build (a development server serves unminified bundles)');
    if (local) return local;
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const p = ctx.ev.page;
    if (!p) return result(this.id, 'skip', 'no page');
    const html = p.contentLength ?? p.bytes;
    const scripts = ctx.ev.bundles.reduce((n, b) => n + (b.contentLength ?? b.bytes), 0);
    const images = [...ctx.ev.imageSamples, ...(ctx.ev.ogImage ? [ctx.ev.ogImage] : [])].reduce((n, r) => n + (r.status === 200 ? (r.contentLength ?? 0) : 0), 0);
    const total = html + scripts + images;
    const breakdown = `html ${kb(html)} + ${ctx.ev.bundles.length} script${ctx.ev.bundles.length === 1 ? '' : 's'} ${kb(scripts)} + ${ctx.ev.imageSamples.length + (ctx.ev.ogImage ? 1 : 0)} image${images ? ` ${kb(images)}` : 's'} (measured subset)`;
    if (total >= LIMIT) return result(this.id, 'fail', `${kb(total)} measured: ${breakdown}`);
    return result(this.id, 'pass', `${kb(total)} measured: ${breakdown}`);
  },
};
