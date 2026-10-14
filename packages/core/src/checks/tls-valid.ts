import type { CheckModule } from './context.js';
import { beforeDeploy, result } from './context.js';

export const check: CheckModule = {
  id: 'tls-valid',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'a TLS certificate on the public hostname');
    if (local) return local;
    const t = ctx.ev.tls;
    if (!t.connected) return result(this.id, 'fail', `no TLS connection to ${ctx.ev.host}:443 (${t.error ?? 'unknown error'})`);
    if (t.authorized && t.hostMatches) {
      return result(this.id, 'pass', `trusted certificate for ${t.subject ?? ctx.ev.host} from ${t.issuer ?? 'unknown issuer'}, ${t.daysRemaining ?? '?'} days left`);
    }
    const reason = !t.hostMatches ? `certificate does not cover ${ctx.ev.host} (SANs: ${t.sans.slice(0, 3).join(', ') || 'none'})` : (t.authorizationError ?? 'not trusted');
    return result(this.id, 'fail', reason);
  },
};
