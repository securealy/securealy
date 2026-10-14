import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const SESSION_LIKE = /sess|auth|token|sid|jwt|^sb-|login|identity|refresh|csrf|xsrf/i;
const CSRF_LIKE = /csrf|xsrf/i;
/** Cookies that client-side analytics and support scripts read on purpose; HttpOnly would break them and they carry no session. */
const JS_READ_BY_DESIGN = /^(ajs_|_ga|_gid|_gat|_gcl|_fbp|_fbc|ph_|mp_|amp_|amplitude|_hj|hubspotutk|__hs|intercom-|_clck|_clsk|_pk_|optimizely|_uetsid|_uetvid|ab\.storage)/i;

export const check: CheckModule = {
  id: 'cookie-flags',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const cookies = ctx.ev.page?.setCookie ?? [];
    if (cookies.length === 0) return result(this.id, 'pass', 'no Set-Cookie on the HTML response');
    // A local server speaks plain http, where browsers refuse a Secure cookie; that flag is judged on the deployed site.
    const preLaunch = ctx.ev.preLaunch === true;
    const fails: string[] = [];
    const warns: string[] = [];
    for (const c of cookies) {
      const name = (c.split(';')[0] ?? '').split('=')[0]?.trim() ?? '?';
      const low = c.toLowerCase();
      const secure = /;\s*secure(\s*;|\s*$)/.test(low);
      const httpOnly = /;\s*httponly(\s*;|\s*$)/.test(low);
      const sameSite = /;\s*samesite=/.test(low);
      const sameSiteNone = /;\s*samesite=none/.test(low);
      const sessionLike = SESSION_LIKE.test(name) && !CSRF_LIKE.test(name) && !JS_READ_BY_DESIGN.test(name);
      const missing: string[] = [];
      if (!secure && !preLaunch) missing.push('Secure');
      if (!httpOnly && sessionLike) missing.push('HttpOnly');
      if (!sameSite) missing.push('SameSite');
      if (sameSiteNone && !secure && !preLaunch) missing.push('Secure (required with SameSite=None)');
      if (missing.length) {
        const line = `${name} lacks ${missing.join(', ')}${sessionLike ? ' (session-like name)' : ''}`;
        // A session cookie without Secure or HttpOnly is the finding; a preference or analytics cookie without Secure is a note.
        if (sessionLike && (missing.includes('Secure') || missing.includes('HttpOnly'))) fails.push(line);
        else warns.push(line);
      }
    }
    if (fails.length) return result(this.id, 'fail', fails.slice(0, 3).join('; '));
    if (warns.length) return result(this.id, 'warn', `${warns.slice(0, 3).join('; ')}; no session cookie affected`);
    if (preLaunch) return result(this.id, 'pass', `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} with HttpOnly where needed and SameSite; Secure is judged on the deployed site`);
    return result(this.id, 'pass', `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} with Secure, HttpOnly where needed, SameSite`);
  },
};
