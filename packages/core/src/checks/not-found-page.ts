import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'not-found-page',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const nf = ctx.ev.notFound;
    if (!nf) return result(this.id, 'skip', 'the random path was not requested');
    const r = nf.record;
    if (r.status === 0) return result(this.id, 'error', `random path did not answer: ${r.error ?? 'unknown'}`);
    if (r.status === 404) {
      if (r.bytes === 0) return result(this.id, 'warn', `${nf.path} answers 404 with an empty body; serve the site's own not-found page`);
      return result(this.id, 'pass', `${nf.path} answers 404 with a ${r.bodyHint ?? 'text'} body`);
    }
    if (r.status === 410) return result(this.id, 'pass', `${nf.path} answers 410`);
    if (r.status >= 300 && r.status < 400) return result(this.id, 'fail', `${nf.path} redirects (${r.status}) instead of answering 404`);
    if (r.status === 200) return result(this.id, 'fail', `${nf.path} answers 200 (soft 404); search engines will index garbage`);
    if (r.status === 403 || r.status === 401) return result(this.id, 'error', `${nf.path} answers ${r.status}; protection in front of the site`);
    return result(this.id, 'fail', `${nf.path} answers ${describe(r)}`);
  },
};
