import type { CheckModule } from './context.js';
import { describe, kb, needPage, result } from './context.js';
import { meta } from '../html.js';

export const check: CheckModule = {
  id: 'og-image',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const raw = meta(page, 'og:image');
    if (!raw) return result(this.id, 'fail', 'no og:image meta tag');
    if (!/^https?:\/\//i.test(raw.trim())) return result(this.id, 'fail', `og:image is not absolute: ${raw.slice(0, 60)}`);
    const rec = ctx.ev.ogImage;
    if (!rec) return result(this.id, 'skip', 'og:image was not fetched (request budget)');
    if (rec.status !== 200) return result(this.id, 'fail', `og:image answers ${describe(rec)}: ${raw.slice(0, 80)}`);
    const ct = rec.headers['content-type'] ?? '';
    if (ct && !/^image\//i.test(ct)) return result(this.id, 'fail', `og:image answers 200 but content-type is ${ct.slice(0, 40)}`);
    const w = Number(meta(page, 'og:image:width') ?? NaN);
    const h = Number(meta(page, 'og:image:height') ?? NaN);
    if (!Number.isNaN(w) && !Number.isNaN(h)) {
      if (w < 1200 || h < 630) return result(this.id, 'fail', `og:image is ${w}x${h}, under 1200x630`);
      return result(this.id, 'pass', `${w}x${h}, ${ct || 'image'}${rec.contentLength ? `, ${kb(rec.contentLength)}` : ''}`);
    }
    if (rec.contentLength !== null && rec.contentLength < 8_000) return result(this.id, 'warn', `og:image resolves but is only ${kb(rec.contentLength)}; unlikely to be 1200x630`);
    return result(this.id, 'pass', `resolves (200, ${ct || 'image'}${rec.contentLength ? `, ${kb(rec.contentLength)}` : ''}); declare og:image:width and height to confirm 1200x630`);
  },
};
