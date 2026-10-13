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
    if (measured.length === 0) {
      if (imgCount === 0 && !ctx.ev.ogImage) return result(this.id, 'pass', 'no images on the home page');
      return result(this.id, 'skip', `${imgCount} image${imgCount === 1 ? '' : 's'} on the page but none could be measured (request budget or no content-length)`);
    }
    const largest = measured.reduce((a, b) => ((b.contentLength ?? 0) > (a.contentLength ?? 0) ? b : a));
    const size = largest.contentLength ?? 0;
    if (size > LIMIT) return result(this.id, 'fail', `${pathOf(largest.url).slice(0, 60)} is ${kb(size)} (${measured.length} measured)`);
    return result(this.id, 'pass', `largest of ${measured.length} measured is ${kb(size)} (${pathOf(largest.url).slice(0, 50)})`);
  },
};
