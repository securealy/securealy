import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

/** The page says "not found" to a human even though the status says 200 to a crawler. */
function clientRendered404(body: string | undefined): boolean {
  if (!body) return false;
  const head = body.slice(0, 64_000);
  const title = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(head)?.[1] ?? '';
  return /\b404\b|not found|page doesn.?t exist|page not found/i.test(title) || /<h[12][^>]*>[^<]{0,40}(404|not found|page not found)[^<]{0,40}<\/h[12]>/i.test(head);
}

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
    if (r.status === 200) {
      if (clientRendered404(r.body)) return result(this.id, 'fail', `${nf.path} answers 200 with a page that says not found; the status is what crawlers read, so it is still a soft 404 (return 404 from the server or the framework's notFound())`);
      return result(this.id, 'fail', `${nf.path} answers 200 with the ${r.bodyHint === 'html' ? 'home or catch-all page' : r.bodyHint ?? 'same'} (soft 404); search engines will index garbage`);
    }
    if (r.status === 403 || r.status === 401) return result(this.id, 'error', `${nf.path} answers ${r.status}; protection in front of the site`);
    return result(this.id, 'fail', `${nf.path} answers ${describe(r)}`);
  },
};
