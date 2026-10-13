import { describe, it, expect } from 'vitest';
import { score, letterFor } from '../src/index.js';
import type { CheckResult, Severity, Status } from '../src/index.js';

function r(id: string, status: Status, severity: Severity): CheckResult {
  return { id, status, severity, evidence: 'x' };
}

describe('score', () => {
  it('maps thresholds to letters', () => {
    expect(letterFor(90)).toBe('A');
    expect(letterFor(89)).toBe('B');
    expect(letterFor(75)).toBe('B');
    expect(letterFor(74)).toBe('C');
    expect(letterFor(60)).toBe('C');
    expect(letterFor(59)).toBe('D');
    expect(letterFor(40)).toBe('D');
    expect(letterFor(39)).toBe('F');
  });

  it('weights by severity and counts warn as half', () => {
    const s = score([r('a', 'pass', 'high'), r('b', 'warn', 'high'), r('c', 'fail', 'medium'), r('d', 'skip', 'blocker'), r('e', 'error', 'high'), r('f', 'pass', 'info')]);
    // numerator 5 + 2.5 = 7.5, denominator 5 + 5 + 3 = 13 -> 58
    expect(s.score).toBe(58);
    expect(s.grade).toBe('D');
    expect(s.summary).toEqual({ blocker: 0, fail: 1, warn: 1, pass: 2, skip: 1, error: 1 });
    expect(s.capped).toBeUndefined();
  });

  it('caps at D with one failing blocker', () => {
    const checks = [r('b', 'fail', 'blocker'), ...Array.from({ length: 20 }, (_, i) => r(`p${i}`, 'pass', 'high'))];
    const s = score(checks);
    expect(s.score).toBe(91);
    expect(s.grade).toBe('D');
    expect(s.capped).toMatch(/^D or lower because of 1 blocker/);
    expect(s.summary.blocker).toBe(1);
    expect(s.summary.fail).toBe(0);
  });

  it('caps at F with two failing blockers', () => {
    const checks = [r('b1', 'fail', 'blocker'), r('b2', 'fail', 'blocker'), ...Array.from({ length: 30 }, (_, i) => r(`p${i}`, 'pass', 'high'))];
    const s = score(checks);
    expect(s.grade).toBe('F');
    expect(s.capped).toBe('F because of 2 blockers');
  });

  it('does not cap when a blocker merely warns or skips', () => {
    const s = score([r('b', 'warn', 'blocker'), r('c', 'skip', 'blocker'), r('p', 'pass', 'high')]);
    expect(s.capped).toBeUndefined();
    expect(s.score).toBe(67);
  });

  it('handles an empty or all-skipped set', () => {
    const s = score([r('a', 'skip', 'high')]);
    expect(s.score).toBe(0);
    expect(s.grade).toBe('F');
    expect(s.capped).toBe('no check could run');
  });
});
