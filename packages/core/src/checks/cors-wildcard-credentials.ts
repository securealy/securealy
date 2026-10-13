import type { CheckModule } from './context.js';
import { needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'cors-wildcard-credentials',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const responses: { where: string; headers: Record<string, string> }[] = [];
    if (ctx.ev.page) responses.push({ where: 'home page', headers: ctx.ev.page.headers });
    for (const r of ctx.ev.verified?.routes ?? []) responses.push({ where: pathOf(r.url), headers: r.record.headers });
    const bad: string[] = [];
    let anyCors = false;
    for (const r of responses) {
      const acao = r.headers['access-control-allow-origin'];
      const acac = r.headers['access-control-allow-credentials'];
      if (acao) anyCors = true;
      if (acao?.trim() === '*' && /true/i.test(acac ?? '')) bad.push(r.where);
    }
    if (bad.length) return result(this.id, 'fail', `Access-Control-Allow-Origin: * with Allow-Credentials: true on ${bad.slice(0, 3).join(', ')}`);
    // No CORS header anywhere means nothing was judged: the API routes that would carry one are only probed in the verified tier.
    if (!anyCors) return result(this.id, 'skip', `no Access-Control-Allow-Origin on ${responses.length === 1 ? 'the home page' : `${responses.length} responses`}; API routes are inspected in the verified tier`);
    return result(this.id, 'pass', 'CORS headers present without the wildcard-plus-credentials combination');
  },
};
