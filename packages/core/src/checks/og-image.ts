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
    if (rec.status === 0) return result(this.id, 'error', `og:image did not answer (${rec.error ?? 'unknown'}): ${raw.slice(0, 80)}`);
    // A 401 or 403 to the grader may be a bot gate that share crawlers pass; it is a finding only at low confidence.
    if (rec.status === 401 || rec.status === 403) return result(this.id, 'warn', `og:image answers ${rec.status} to the grader (${raw.slice(0, 80)}); if a bot gate is in front of it, allow share crawlers through`);
    if (rec.status !== 200) return result(this.id, 'fail', `og:image answers ${describe(rec)}: ${raw.slice(0, 80)}`);
    const ct = rec.headers['content-type'] ?? '';
    if (ct && !/^image\//i.test(ct)) return result(this.id, 'fail', `og:image answers 200 but content-type is ${ct.slice(0, 40)}`);
    // Share crawlers (Facebook, X, LinkedIn, Slack) do not render SVG previews.
    if (/svg/i.test(ct)) return result(this.id, 'fail', `og:image answers 200 as ${ct.split(';')[0]}; share crawlers do not render SVG, serve a 1200x630 PNG or JPEG`);
    const dim = (name: string): number | null => {
      const v = meta(page, name);
      if (v === null) return null;
      const m = /^\s*(\d+)\s*(?:px)?\s*$/i.exec(v);
      return m ? Number(m[1]) : null;
    };
    const w = dim('og:image:width');
    const h = dim('og:image:height');
    if (w !== null && h !== null) {
      if (w < 1200 || h < 630) return result(this.id, 'fail', `og:image:width and og:image:height declare ${w}x${h}, under 1200x630`);
      return result(this.id, 'pass', `declared ${w}x${h}, ${ct || 'image'}${rec.contentLength ? `, ${kb(rec.contentLength)}` : ''}`);
    }
    if (rec.contentLength !== null && rec.contentLength < 4_000 && !/svg/i.test(ct)) return result(this.id, 'warn', `og:image resolves but is only ${kb(rec.contentLength)}; unlikely to be 1200x630`);
    return result(this.id, 'pass', `resolves (200, ${ct || 'image'}${rec.contentLength ? `, ${kb(rec.contentLength)}` : ''}); declare og:image:width and og:image:height to confirm 1200x630`);
  },
};
