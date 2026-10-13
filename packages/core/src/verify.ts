import { createHash } from 'node:crypto';

/**
 * Ownership verification never publishes the token itself. The owner publishes
 * a fingerprint derived from it, so a DNS record or a meta tag cannot be
 * replayed as an API credential.
 */
export function verificationFingerprint(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex').slice(0, 32);
}

export const VERIFY_PREFIX = 'securealy-verify=';

export function verificationOptions(domain: string, token?: string): { dns: string; meta: string; wellKnown: string; fingerprint: string } {
  const fp = token ? verificationFingerprint(token) : '<fingerprint>';
  return {
    fingerprint: fp,
    dns: `_securealy.${domain}  TXT  "${VERIFY_PREFIX}${fp}"`,
    meta: `<meta name="securealy-verify" content="${fp}">`,
    wellKnown: `https://${domain}/.well-known/securealy.txt containing: ${VERIFY_PREFIX}${fp}`,
  };
}

export function txtMatchesFingerprint(values: string[], fp: string): boolean {
  return values.some((v) => v.trim().toLowerCase() === `${VERIFY_PREFIX}${fp}`.toLowerCase() || v.trim().toLowerCase() === fp.toLowerCase());
}

export class OptOutError extends Error {
  constructor(
    public readonly host: string,
    public readonly via: 'dns' | 'header',
  ) {
    super(`${host} has opted out of Securealy grading (${via === 'dns' ? 'TXT _securealy=optout' : 'X-Securealy: optout header'})`);
    this.name = 'OptOutError';
  }
}

export class VerificationError extends Error {
  constructor(
    public readonly host: string,
    public readonly tried: string[],
  ) {
    super(`Ownership of ${host} could not be verified (tried ${tried.join(', ')}). Run: securealy verify ${host} --token <sly_...>`);
    this.name = 'VerificationError';
  }
}
