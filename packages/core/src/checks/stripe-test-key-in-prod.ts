import type { CheckModule } from './context.js';
import { beforeDeploy, needPage, pathOf, result } from './context.js';

export const check: CheckModule = {
  id: 'stripe-test-key-in-prod',
  run(ctx) {
    const local = beforeDeploy(ctx, this.id, 'the publishable key in the deployed bundle (a test key is expected locally)');
    if (local) return local;
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const sources: { where: string; text: string }[] = [];
    if (ctx.ev.page?.body) sources.push({ where: pathOf(ctx.ev.page.url) || '/', text: ctx.ev.page.body });
    for (const b of ctx.ev.bundles) if (b.body) sources.push({ where: pathOf(b.url), text: b.body });
    let live: string | null = null;
    let test: string | null = null;
    for (const s of sources) {
      if (!live && /\bpk_live_[0-9A-Za-z]{8,}/.test(s.text)) live = s.where;
      if (!test && /\bpk_test_[0-9A-Za-z]{8,}/.test(s.text)) test = s.where;
    }
    if (!live && !test) return result(this.id, 'skip', 'no Stripe publishable key in the page or bundles');
    if (test && !live) {
      if (ctx.ev.platformSuffix) return result(this.id, 'warn', `pk_test_ key in ${test}; fine for a preview on ${ctx.ev.platformSuffix}, not for production`);
      return result(this.id, 'fail', `pk_test_ key shipped in ${test}; customers cannot pay on a test key`);
    }
    if (test && live) return result(this.id, 'warn', `both pk_live_ and pk_test_ keys shipped (${live}, ${test}); make sure the live one is selected in production`);
    return result(this.id, 'pass', `pk_live_ key in ${live}`);
  },
};
