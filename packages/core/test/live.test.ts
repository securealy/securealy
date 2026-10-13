import { describe, it, expect } from 'vitest';
import { grade } from '../src/index.js';

// Integration test against the real network. Run with LIVE=1 npm test.
describe.skipIf(!process.env.LIVE)('live grade', () => {
  it('grades https://example.com', async () => {
    const r = await grade('https://example.com');
    expect(r.host).toBe('example.com');
    expect(r.checks).toHaveLength(51);
    expect(r.requests).toBeLessThanOrEqual(25);
    expect(r.checks.find((c) => c.id === 'tls-valid')?.status).toBe('pass');
    expect(r.summary.error).toBe(0);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(r.grade);
  }, 60_000);
});
