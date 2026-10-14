import { redactSecret, redactText, secretValuesFromEnv } from 'securealy-core';

/**
 * Last line of defence for every tool output. Two passes:
 *   1. the engine's pattern redactor (known key shapes become six chars + ellipsis)
 *   2. a literal pass over every secret value this process has seen: env vars
 *      whose names look secret, the password inside any URL-shaped env value
 *      (DATABASE_URL and friends), and tokens passed as tool arguments.
 * Nothing registered here is ever read back; the set only drives replacement.
 */
export class Redactor {
  private readonly known = new Set<string>();

  /** Register env values from secret-looking variable names and the password of any URL-shaped value. */
  learnEnv(env: Record<string, string | undefined>): void {
    for (const value of secretValuesFromEnv(env)) this.learn(value);
  }

  /** Register one literal secret (a token argument, for example). */
  learn(value: string | undefined): void {
    const v = value?.trim();
    if (v && v.length >= 8) this.known.add(v);
  }

  text(input: string): string {
    let out = redactText(input);
    for (const secret of this.known) {
      if (out.includes(secret)) out = out.split(secret).join(redactSecret(secret));
    }
    return out;
  }

  /** Deep-redact any JSON-serialisable value. */
  value<T>(input: T): T {
    const raw = JSON.stringify(input);
    if (raw === undefined) return input;
    return JSON.parse(this.text(raw)) as T;
  }
}
