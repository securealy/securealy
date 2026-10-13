import type { CheckModule } from './context.js';
import { result } from './context.js';
import { needVerified } from './verified.js';

export const check: CheckModule = {
  id: 'storage-bucket-listing',
  run(ctx) {
    const { gate, v } = needVerified(ctx, this.id);
    if (gate || !v) return gate as ReturnType<CheckModule['run']>;
    if (!v.storage || !v.storageKind) return result(this.id, 'skip', 'no Supabase or Firebase storage to probe');
    const s = v.storage;
    if (s.status === 0) return result(this.id, 'error', `storage endpoint did not answer: ${s.error ?? 'unknown'}`);
    const label = v.storageKind === 'supabase' ? 'Supabase bucket list' : 'Firebase storage listing';
    if (s.status === 200 && s.bodyHint === 'json' && s.bytes > 2) return result(this.id, 'fail', `${label} answers 200 with data to an anonymous caller`);
    if (s.status === 200) return result(this.id, 'pass', `${label} answers 200 but empty`);
    return result(this.id, 'pass', `${label} answers ${s.status} to an anonymous caller`);
  },
};
