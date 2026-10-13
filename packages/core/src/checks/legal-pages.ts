import type { CheckModule } from './context.js';
import { needPage, pathOf, result } from './context.js';
import { resolveUrl } from '../html.js';

const PRIVACY = /privacy|datenschutz|confidentialit|gdpr|data-protection/i;
const TERMS = /terms|conditions|\btos\b|agb\b|eula/i;
const LEGAL_HUB = /\/legal\/?$|^legal( policies| notices?)?$/i;

export const check: CheckModule = {
  id: 'legal-pages',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const base = ctx.ev.finalUrl;
    // Links: anchors by href, text or rel (privacy-policy, terms-of-service are standard link types), plus <link rel> in the head.
    const candidates = [
      ...page.anchors.map((a) => ({ href: a.href, text: a.text, rel: a.rel })),
      ...page.links.map((l) => ({ href: l.href, text: '', rel: l.rel })),
    ];
    const find = (re: RegExp, rel: string) => candidates.find((c) => c.rel.split(/\s+/).includes(rel) || re.test(c.href) || re.test(c.text));
    const privacy = find(PRIVACY, 'privacy-policy');
    const terms = find(TERMS, 'terms-of-service');
    const hub = candidates.find((c) => LEGAL_HUB.test(c.href) || LEGAL_HUB.test(c.text));
    const missing = [privacy ? null : 'privacy policy', terms ? null : 'terms'].filter(Boolean);
    if (missing.length && page.anchors.length === 0) {
      return result(this.id, 'skip', 'the home page HTML has no links at all (client-rendered shell), so a footer with privacy and terms cannot be judged from it');
    }
    const statusOf = (href: string) => {
      const u = resolveUrl(base, href);
      if (!u) return null;
      const rec = ctx.ev.linkSamples.find((l) => l.url === u);
      if (!rec || (rec.status === 0 && !rec.error)) return null;
      return rec.status;
    };
    if (missing.length && hub) {
      const hs = statusOf(hub.href);
      if (hs !== null && (hs >= 400 || hs === 0)) return result(this.id, 'fail', `only a legal hub link (${pathOf(resolveUrl(base, hub.href) ?? '')}) and it answers ${hs}`);
      return result(this.id, 'warn', `no direct link to ${missing.join(' or ')}; a legal hub link (${pathOf(resolveUrl(base, hub.href) ?? hub.href)}) is present${hs !== null ? ` and answers ${hs}` : ''}, link the two pages directly as well`);
    }
    if (missing.length) return result(this.id, 'fail', `no link to ${missing.join(' or ')} among ${page.anchors.length} links on the home page (looked for href, text or rel naming privacy, terms, conditions, legal)`);
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
