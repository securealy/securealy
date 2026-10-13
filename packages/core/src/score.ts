import type { CheckResult, Grade, ScoreResult, Severity, Summary } from './types.js';

export const WEIGHTS: Record<Severity, number> = {
  blocker: 10,
  high: 5,
  medium: 3,
  low: 1,
  info: 0,
};

export function letterFor(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

const ORDER: Grade[] = ['F', 'D', 'C', 'B', 'A'];

export function gradeRank(g: Grade): number {
  return ORDER.indexOf(g);
}

function minGrade(a: Grade, b: Grade): Grade {
  return gradeRank(a) <= gradeRank(b) ? a : b;
}

/**
 * Score exactly as SPEC.md: weights by severity, warn counts as half a pass,
 * skip and error are excluded, one failing blocker caps at D, two or more at F.
 */
export function score(checks: CheckResult[]): ScoreResult {
  const summary: Summary = { blocker: 0, fail: 0, warn: 0, pass: 0, skip: 0, error: 0 };
  let numerator = 0;
  let denominator = 0;
  for (const c of checks) {
    const w = WEIGHTS[c.severity] ?? 0;
    switch (c.status) {
      case 'pass':
        summary.pass += 1;
        numerator += w;
        denominator += w;
        break;
      case 'warn':
        summary.warn += 1;
        numerator += w / 2;
        denominator += w;
        break;
      case 'fail':
        if (c.severity === 'blocker') summary.blocker += 1;
        else summary.fail += 1;
        denominator += w;
        break;
      case 'skip':
        summary.skip += 1;
        break;
      case 'error':
        summary.error += 1;
        break;
    }
  }
  const raw = denominator > 0 ? Math.round((100 * numerator) / denominator) : 0;
  let grade = letterFor(raw);
  let capped: string | undefined;
  if (summary.blocker >= 2) {
    grade = 'F';
    capped = `F because of ${summary.blocker} blockers`;
  } else if (summary.blocker === 1) {
    const before = grade;
    grade = minGrade(grade, 'D');
    capped = before === grade ? 'D or lower because of 1 blocker' : `D or lower because of 1 blocker (uncapped ${before})`;
  } else if (denominator === 0) {
    capped = 'no check could run';
  }
  const result: ScoreResult = { grade, score: raw, summary };
  if (capped) result.capped = capped;
  return result;
}
