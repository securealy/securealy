import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

export const check: CheckModule = {
  id: 'firebase-config',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const fb = ctx.ev.firebase;
    if (!fb) return result(this.id, 'pass', 'no Firebase web config in the page or bundles');
    const bits = [fb.projectId ? `project ${fb.projectId}` : null, fb.storageBucket ? `bucket ${fb.storageBucket}` : null].filter(Boolean);
    return result(this.id, 'warn', `Firebase config present (${bits.join(', ') || 'apiKey only'}); Firestore and Storage rules cannot be judged passively`);
  },
};
