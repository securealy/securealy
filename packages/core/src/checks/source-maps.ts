import type { CheckModule } from './context.js';
import { needPage, pathOf, result } from './context.js';

/** A map answered with HTML is the SPA fallback page, not a map. */
function looksLikeMap(m: { status: number; headers: Record<string, string>; bodyHint?: string }): boolean {
  if (m.status !== 200) return false;
  const ct = (m.headers['content-type'] ?? '').toLowerCase();
  if (/text\/html/.test(ct) || m.bodyHint === 'html') return false;
  return true;
}

export const check: CheckModule = {
  id: 'source-maps',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const referenced = ctx.ev.bundles.filter((b) => b.body && /\/\/[#@]\s*sourceMappingURL=/.test(b.body.slice(-600)));
    const reachable = ctx.ev.sourceMaps.filter(looksLikeMap);
    const softMaps = ctx.ev.sourceMaps.filter((m) => m.status === 200 && !looksLikeMap(m));
    if (reachable.length) return result(this.id, 'fail', `${reachable.length} source map${reachable.length === 1 ? '' : 's'} served (sourceMappingURL in the bundle resolves with ${reachable.map((m) => (m.headers['content-type'] ?? 'no content-type').split(';')[0]).slice(0, 2).join(', ')}): ${reachable.map((m) => pathOf(m.url)).slice(0, 2).join(', ')}`);
    if (referenced.length) {
      const note = softMaps.length ? `answers 200 with HTML, the SPA fallback, not a map` : `does not resolve (${ctx.ev.sourceMaps.map((m) => m.status).join(', ') || 'not fetched'})`;
      return result(this.id, 'pass', `${referenced.length} bundle${referenced.length === 1 ? '' : 's'} reference a .map that ${note}; drop the sourceMappingURL comment too`);
    }
    if (ctx.ev.bundles.length === 0) return result(this.id, 'pass', 'no first-party bundles on the home page');
    return result(this.id, 'pass', `${ctx.ev.bundles.length} bundle${ctx.ev.bundles.length === 1 ? '' : 's'} checked, no sourceMappingURL comment at the end of any`);
  },
};
