import { promises as dnsPromises } from 'node:dns';
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import type { DnsEvidence } from '../evidence.js';
import { emptyDns } from '../evidence.js';
import type { Resolver } from '../types.js';

export const DKIM_SELECTORS = ['resend', 'google', 'default', 'k1', 'selector1', 's1'];
const DNS_TIMEOUT_MS = 5_000;

export function defaultResolver(): Resolver {
  const r = new dnsPromises.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  return {
    resolveNs: (h) => r.resolveNs(h),
    resolve4: (h) => r.resolve4(h),
    resolve6: (h) => r.resolve6(h),
    resolveMx: (h) => r.resolveMx(h),
    resolveTxt: (h) => r.resolveTxt(h),
    resolveCname: (h) => r.resolveCname(h),
    resolveCaa: (h) => r.resolveCaa(h),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ETIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function attempt<T>(label: string, errors: Record<string, string>, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(fn(), DNS_TIMEOUT_MS + 500);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = err.code ?? err.message ?? 'error';
    // ENODATA and ENOTFOUND are normal "no such record" answers, not errors worth surfacing.
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') errors[label] = String(code);
    return fallback;
  }
}

function joinTxt(rows: string[][]): string[] {
  return rows.map((r) => r.join(''));
}

/** Only the opt-out and verification record, so it can be honored before anything else. */
export async function lookupSecurealyTxt(resolver: Resolver, host: string, apex: string): Promise<string[]> {
  const names = host === apex ? [host] : [host, apex];
  const out: string[] = [];
  for (const n of names) {
    try {
      const rows = await withTimeout(resolver.resolveTxt(`_securealy.${n}`), DNS_TIMEOUT_MS);
      out.push(...joinTxt(rows));
    } catch {
      /* no record */
    }
  }
  return out;
}

export async function gatherDns(resolver: Resolver, host: string, apex: string, opts: { skipDnssec?: boolean } = {}): Promise<DnsEvidence> {
  const ev = emptyDns();
  const errors = ev.errors;
  const www = `www.${apex}`;
  const [ns, aApex, aWww, aHost, a6Apex, a6Www, a6Host, cname, mx, txt, dmarc, caa, securealyTxt] = await Promise.all([
    attempt('ns', errors, () => resolver.resolveNs(apex), [] as string[]),
    attempt('a.apex', errors, () => resolver.resolve4(apex), [] as string[]),
    attempt('a.www', errors, () => resolver.resolve4(www), [] as string[]),
    host === apex || host === www ? Promise.resolve([] as string[]) : attempt('a.host', errors, () => resolver.resolve4(host), [] as string[]),
    attempt('aaaa.apex', errors, () => resolver.resolve6(apex), [] as string[]),
    attempt('aaaa.www', errors, () => resolver.resolve6(www), [] as string[]),
    host === apex || host === www ? Promise.resolve([] as string[]) : attempt('aaaa.host', errors, () => resolver.resolve6(host), [] as string[]),
    attempt('cname', errors, () => resolver.resolveCname(host), [] as string[]),
    attempt('mx', errors, () => resolver.resolveMx(apex), [] as { exchange: string; priority: number }[]),
    attempt('txt', errors, async () => joinTxt(await resolver.resolveTxt(apex)), [] as string[]),
    attempt('dmarc', errors, async () => joinTxt(await resolver.resolveTxt(`_dmarc.${apex}`)), [] as string[]),
    attempt(
      'caa',
      errors,
      async () => {
        if (!resolver.resolveCaa) return [] as string[];
        const rows = await resolver.resolveCaa(apex);
        return rows.map((r) => {
          if (r.issue) return `issue "${r.issue}"`;
          if (r.issuewild) return `issuewild "${r.issuewild}"`;
          if (r.iodef) return `iodef "${r.iodef}"`;
          return JSON.stringify(r);
        });
      },
      [] as string[],
    ),
    lookupSecurealyTxt(resolver, host, apex),
  ]);
  ev.ns = ns.map((n) => n.toLowerCase().replace(/\.$/, ''));
  ev.a = { apex: aApex, www: aWww, host: host === apex ? aApex : host === www ? aWww : aHost };
  ev.aaaa = { apex: a6Apex, www: a6Www, host: host === apex ? a6Apex : host === www ? a6Www : a6Host };
  ev.cname = cname.map((c) => c.toLowerCase());
  ev.mx = mx.map((m) => ({ exchange: m.exchange.toLowerCase(), priority: m.priority })).sort((x, y) => x.priority - y.priority);
  ev.txt = txt;
  ev.dmarc = dmarc;
  ev.caa = caa;
  ev.securealyTxt = securealyTxt;
  const dkimEntries = await Promise.all(
    DKIM_SELECTORS.map(async (sel) => {
      const name = `${sel}._domainkey.${apex}`;
      const rows = await attempt(`dkim.${sel}`, errors, async () => joinTxt(await resolver.resolveTxt(name)), [] as string[]);
      // An empty p= is a revocation record, not a usable key.
      const rec = rows.find((r) => /\bp=[A-Za-z0-9+/=]{20,}/.test(r.replace(/\s+/g, ''))) ?? null;
      return [sel, rec] as const;
    }),
  );
  for (const [sel, rec] of dkimEntries) ev.dkim[sel] = rec;
  if (!opts.skipDnssec) {
    try {
      ev.dnssec = await withTimeout(queryDnssec(apex), DNS_TIMEOUT_MS + 500);
    } catch (e) {
      ev.dnssec = null;
      errors['dnssec'] = String((e as Error).message ?? e);
    }
  }
  return ev;
}

/* ---------------- raw DNS query with the DO flag, for DNSSEC ---------------- */

function encodeName(name: string): Buffer {
  const parts = name.replace(/\.$/, '').split('.');
  const bufs: Buffer[] = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'ascii');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function buildQuery(name: string, qtype: number): { id: number; packet: Buffer } {
  const id = randomBytes(2).readUInt16BE(0);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10); // ARCOUNT (OPT)
  const q = Buffer.concat([encodeName(name), Buffer.from([0, qtype, 0, 1])]);
  // OPT RR: root name, type 41, udp payload 1232, extended rcode 0, version 0, flags DO (0x8000), rdlen 0
  const opt = Buffer.from([0, 0, 41, 0x04, 0xd0, 0, 0, 0x80, 0, 0, 0]);
  return { id, packet: Buffer.concat([header, q, opt]) };
}

function skipName(buf: Buffer, offset: number): number {
  let o = offset;
  for (;;) {
    if (o >= buf.length) return buf.length;
    const len = buf[o] ?? 0;
    if (len === 0) return o + 1;
    if ((len & 0xc0) === 0xc0) return o + 2;
    o += len + 1;
  }
}

/** Returns true when the answer carries RRSIG records or the AD bit. */
function parseSigned(buf: Buffer, id: number): boolean | null {
  if (buf.length < 12 || buf.readUInt16BE(0) !== id) return null;
  const flags = buf.readUInt16BE(2);
  const ad = (flags & 0x0020) !== 0;
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  const nsc = buf.readUInt16BE(8);
  const ar = buf.readUInt16BE(10);
  let o = 12;
  for (let i = 0; i < qd; i++) {
    o = skipName(buf, o) + 4;
  }
  let rrsig = false;
  const total = an + nsc + ar;
  for (let i = 0; i < total && o < buf.length; i++) {
    o = skipName(buf, o);
    if (o + 10 > buf.length) break;
    const type = buf.readUInt16BE(o);
    const rdlen = buf.readUInt16BE(o + 8);
    if (type === 46 || type === 48) rrsig = true;
    o += 10 + rdlen;
  }
  return ad || rrsig;
}

function udpQuery(server: string, packet: Buffer, id: number, timeoutMs: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const sock = createSocket(server.includes(':') ? 'udp6' : 'udp4');
    let done = false;
    const finish = (v: boolean | null) => {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    sock.on('message', (msg) => {
      clearTimeout(t);
      finish(parseSigned(msg, id));
    });
    sock.on('error', () => {
      clearTimeout(t);
      finish(null);
    });
    sock.send(packet, 53, server, (err) => {
      if (err) {
        clearTimeout(t);
        finish(null);
      }
    });
  });
}

/**
 * Ask for the apex A record with the DO bit set. A signed zone answers with
 * RRSIG records (or the resolver sets AD). Falls back to a DNSKEY query and to
 * a public validating resolver when the system resolver strips DNSSEC data.
 */
export async function queryDnssec(apex: string): Promise<boolean | null> {
  const systemServers = dnsPromises.getServers().filter((s) => !s.startsWith('fe80'));
  const servers = [...new Set([...systemServers.slice(0, 1), '1.1.1.1', '8.8.8.8'])];
  let sawAnswer = false;
  for (const server of servers) {
    const host = server.replace(/^\[|\]$/g, '').split('%')[0] ?? server;
    for (const qtype of [1, 48]) {
      const { id, packet } = buildQuery(apex, qtype);
      const r = await udpQuery(host, packet, id, 2_000);
      if (r === true) return true;
      if (r === false) sawAnswer = true;
    }
    if (sawAnswer) return false;
  }
  return sawAnswer ? false : null;
}
