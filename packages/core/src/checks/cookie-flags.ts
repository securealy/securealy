import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const SESSION_LIKE = /sess|auth|token|sid|jwt|^sb-|login|identity|refresh|csrf|xsrf/i;
const CSRF_LIKE = /csrf|xsrf/i;

export const check: CheckModule = {
  id: 'cookie-flags',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const cookies = ctx.ev.page?.setCookie ?? [];
    if (cookies.length === 0) return result(this.id, 'pass', 'no Set-Cookie on the HTML response');
    const fails: string[] = [];
    const warns: string[] = [];
    for (const c of cookies) {
      const name = (c.split(';')[0] ?? '').split('=')[0]?.trim() ?? '?';
      const low = c.toLowerCase();
      const secure = /;\s*secure(\s*;|\s*$)/.test(low);
      const httpOnly = /;\s*httponly(\s*;|\s*$)/.test(low);
      const sameSite = /;\s*samesite=/.test(low);
      const sameSiteNone = /;\s*samesite=none/.test(low);
      const missing: string[] = [];
      if (!secure) missing.push('Secure');
      if (!httpOnly && SESSION_LIKE.test(name) && !CSRF_LIKE.test(name)) missing.push('HttpOnly');
      if (!sameSite) missing.push('SameSite');
      if (sameSiteNone && !secure) missing.push('Secure (required with SameSite=None)');
      if (missing.length) {
        const line = `${name} lacks ${missing.join(', ')}`;
        if (missing.includes('Secure') || missing.includes('HttpOnly')) fails.push(line);
        else warns.push(line);
      }
    }
    if (fails.length) return result(this.id, 'fail', fails.slice(0, 3).join('; '));
    if (warns.length) return result(this.id, 'warn', warns.slice(0, 3).join('; '));
    return result(this.id, 'pass', `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} with Secure, HttpOnly where needed, SameSite`);
  },
};
