import type { CheckModule } from './context.js';
import { needPage, pathOf, result } from './context.js';
import { resolveUrl } from '../html.js';

export const check: CheckModule = {
  id: 'legal-pages',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const base = ctx.ev.finalUrl;
    const find = (re: RegExp) => page.anchors.find((a) => re.test(a.href) || re.test(a.text));
    const privacy = find(/privacy|datenschutz|confidentialit/i);
    const terms = find(/terms|conditions|tos\b|legal|agb\b/i);
    const missing = [privacy ? null : 'privacy policy', terms ? null : 'terms'].filter(Boolean);
    if (missing.length) return result(this.id, 'fail', `no link to ${missing.join(' or ')} on the home page`);
    const statusOf = (href: string) => {
      const u = resolveUrl(base, href);
      if (!u) return null;
      const rec = ctx.ev.linkSamples.find((l) => l.url === u);
      if (!rec || (rec.status === 0 && !rec.error)) return null;
      return rec.status;
    };
    const ps = statusOf((privacy as { href: string }).href);
    const ts = statusOf((terms as { href: string }).href);
    const broken: string[] = [];
    if (ps !== null && (ps >= 400 || ps === 0)) broken.push(`privacy (${pathOf(resolveUrl(base, (privacy as { href: string }).href) ?? '')}) answers ${ps}`);
    if (ts !== null && (ts >= 400 || ts === 0)) broken.push(`terms (${pathOf(resolveUrl(base, (terms as { href: string }).href) ?? '')}) answers ${ts}`);
    if (broken.length) return result(this.id, 'fail', broken.join('; '));
    const checked = [ps, ts].filter((s) => s !== null).length;
    return result(this.id, 'pass', `privacy and terms links present${checked ? `, ${checked} of 2 fetched and resolving` : ' (not fetched: request budget)'}`);
  },
};
