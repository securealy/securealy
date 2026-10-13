import type { RdapEvidence } from '../evidence.js';
import type { HttpClient } from './http.js';

interface RdapDoc {
  events?: { eventAction?: string; eventDate?: string }[];
  entities?: { roles?: string[]; vcardArray?: unknown }[];
}

function registrarName(doc: RdapDoc): string | undefined {
  const reg = doc.entities?.find((e) => e.roles?.includes('registrar'));
  const vcard = reg?.vcardArray as [string, [string, unknown, string, string][]] | undefined;
  const fn = vcard?.[1]?.find((row) => row[0] === 'fn');
  return fn ? String(fn[3]) : undefined;
}

export async function gatherRdap(client: HttpClient, apex: string, platformSuffix: string | null): Promise<RdapEvidence> {
  if (platformSuffix) return { expires: null, skipped: `platform subdomain under ${platformSuffix}` };
  const tld = apex.split('.').pop() ?? '';
  const urls = [`https://rdap.org/domain/${apex}`];
  if (tld === 'com' || tld === 'net') urls.push(`https://rdap.verisign.com/${tld}/v1/domain/${apex}`);
  let lastError = 'no RDAP answer';
  for (const url of urls) {
    const rec = await client.request(url, { keepBytes: 200_000, headers: { accept: 'application/rdap+json, application/json' } });
    if (rec.error) {
      lastError = rec.error;
      continue;
    }
    if (rec.status === 404) {
      // rdap.org redirects to the registry when it knows the TLD. A 404 that
      // never left rdap.org means the IANA bootstrap lists no RDAP server for
      // the TLD (.me, .io, .sh among them), which says nothing about the domain.
      const fromRegistry = rec.redirects.length > 0 || !/^https:\/\/rdap\.org\//.test(url);
      if (fromRegistry) return { expires: null, error: 'domain not found in RDAP' };
      lastError = `no RDAP server is listed for .${tld}`;
      continue;
    }
    if (rec.status !== 200 || !rec.body) {
      lastError = `RDAP ${rec.status}`;
      continue;
    }
    try {
      const doc = JSON.parse(rec.body) as RdapDoc;
      const exp = doc.events?.find((e) => e.eventAction === 'expiration')?.eventDate ?? null;
      const out: RdapEvidence = { expires: exp };
      const reg = registrarName(doc);
      if (reg) out.registrar = reg;
      if (!exp) out.error = 'no expiration event in RDAP record';
      return out;
    } catch {
      lastError = 'RDAP body did not parse';
    }
  }
  if (/^no RDAP server/.test(lastError)) return { expires: null, skipped: `${lastError} (tried rdap.org); registration expiry cannot be read` };
  return { expires: null, error: lastError };
}
