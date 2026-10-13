import type { CheckModule } from './context.js';
import { kb, needPage, pathOf, result } from './context.js';
import { findSecrets } from '../redact.js';
import type { SecretFinding } from '../redact.js';

export const check: CheckModule = {
  id: 'secrets-in-bundle',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const findings: SecretFinding[] = [];
    let bytes = 0;
    const page = ctx.ev.page;
    if (page?.body) {
      bytes += page.body.length;
      findings.push(...findSecrets(page.body, pathOf(page.url) || '/'));
    }
    for (const b of ctx.ev.bundles) {
      if (!b.body) continue;
      bytes += b.body.length;
      findings.push(...findSecrets(b.body, pathOf(b.url)));
    }
    const high = findings.filter((f) => f.confidence === 'high');
    const low = findings.filter((f) => f.confidence === 'low');
    const fmt = (f: SecretFinding) => `${f.redacted} (${f.kind}) found in ${f.location} (redacted)`;
    if (high.length) {
      const detail = high.length > 1 ? high.slice(0, 10).map(fmt).join('\n') : undefined;
      return result(this.id, 'fail', `${fmt(high[0] as SecretFinding)}${high.length > 1 ? ` and ${high.length - 1} more` : ''}`, detail);
    }
    if (low.length) return result(this.id, 'warn', `${fmt(low[0] as SecretFinding)}; account identifiers are not secrets on their own, confirm no auth token ships with it`);
    return result(this.id, 'pass', `${ctx.ev.bundles.length} bundle${ctx.ev.bundles.length === 1 ? '' : 's'} plus inline scripts scanned (${kb(bytes)}), no secret-shaped strings`);
  },
};
