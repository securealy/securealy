import type { CheckModule } from './context.js';
import { result } from './context.js';

export const check: CheckModule = {
  id: 'https-redirect',
  run(ctx) {
    const p = ctx.ev.httpProbe;
    if (!p) return result(this.id, 'skip', 'plain http was not probed');
    if (p.status === 0) {
      if (/ECONNREFUSED/.test(p.error ?? '')) return result(this.id, 'warn', 'port 80 refuses connections; browsers typing the bare domain get an error instead of a redirect');
      return result(this.id, 'skip', `plain http did not answer (${p.error ?? 'unknown'})`);
    }
    const loc = p.headers['location'] ?? '';
    if (p.status >= 300 && p.status < 400) {
      if (/^https:\/\//i.test(loc)) {
        if (p.status === 301 || p.status === 308) return result(this.id, 'pass', `http:// answers ${p.status} to ${loc}`);
        return result(this.id, 'warn', `http:// answers ${p.status} (temporary) to ${loc}; use 301 or 308`);
      }
      return result(this.id, 'fail', `http:// redirects to a non-https location: ${loc || '(empty)'}`);
    }
    if (p.status >= 200 && p.status < 300) return result(this.id, 'fail', `http:// serves the site (${p.status}) without redirecting to https`);
    return result(this.id, 'warn', `http:// answers ${p.status} with no redirect`);
  },
};
