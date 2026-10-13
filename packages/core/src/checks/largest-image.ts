import type { CheckModule } from './context.js';
import { kb, needPage, pathOf, result } from './context.js';

const LIMIT = 300_000;

export const check: CheckModule = {
  id: 'largest-image',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const measured = [...ctx.ev.imageSamples, ...(ctx.ev.ogImage ? [ctx.ev.ogImage] : [])].filter((r) => r.status === 200 && r.contentLength !== null);
    const imgCount = ctx.page?.images.length ?? 0;
    const total = imgCount + (ctx.ev.ogImage ? 1 : 0);
    if (measured.length === 0) {
      if (total === 0) return result(this.id, 'pass', 'no images on the home page');
      const what = imgCount === 0 ? 'only the og:image' : `${imgCount} image${imgCount === 1 ? '' : 's'} on the page${ctx.ev.ogImage ? ' plus the og:image' : ''}`;
      return result(this.id, 'skip', `${what}, none could be measured (request budget, non-200, or no content-length on the HEAD response)`);
    }
    const largest = measured.reduce((a, b) => ((b.contentLength ?? 0) > (a.contentLength ?? 0) ? b : a));
    const size = largest.contentLength ?? 0;
    if (size > LIMIT) return result(this.id, 'fail', `${pathOf(largest.url).slice(0, 60)} is ${kb(size)} (${measured.length} measured)`);
    return result(this.id, 'pass', `largest of ${measured.length} measured is ${kb(size)} (${pathOf(largest.url).slice(0, 50)})`);
  },
};
