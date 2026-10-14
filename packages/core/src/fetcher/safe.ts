import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import type { Dispatcher } from 'undici';

/**
 * The request-forgery guard. Every URL the engine fetches (the input, each
 * redirect hop, and every URL lifted from page content or a bundle) is checked
 * here first, and the connection is pinned to the addresses that passed the
 * check, so a hostname cannot answer the check with a public address and the
 * connect with a private one.
 */

export interface Address {
  address: string;
  family: number;
}

export type Lookup = (hostname: string) => Promise<Address[]>;

export class UnsafeHostError extends Error {
  constructor(
    public readonly host: string,
    public readonly reason: string,
  ) {
    super(`${host}: ${reason}`);
    this.name = 'UnsafeHostError';
  }
}

const LOOKUP_TIMEOUT_MS = 5_000;
const FORBIDDEN_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/** Names that only ever mean "this machine" or "this network". */
export function isForbiddenName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  return FORBIDDEN_SUFFIXES.some((s) => h.endsWith(s));
}

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Expand an IPv6 literal into eight 16-bit groups. Returns null when it is not one. */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  // A trailing dotted quad (::ffff:10.0.0.0) becomes two hex groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const v4 = parseV4(dotted[1] ?? '');
    if (!v4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    s = `${s.slice(0, s.length - (dotted[1]?.length ?? 0))}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = groups(halves[0] ?? '');
  const tail = halves.length === 2 ? groups(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function loopbackV4(o: number[]): boolean {
  return o[0] === 127;
}

/** True only for loopback: the 127 loopback range, ::1, and the IPv6 forms that embed a 127.x address. */
export function isLoopbackAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return loopbackV4(v4);
  const g = parseV6(ip);
  if (!g) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return loopbackV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  return false;
}

/** Names that only ever mean the developer's own machine: localhost, *.localhost (RFC 6761) and *.test (reserved for local use). */
export function isLocalDevName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.test');
}

/**
 * A hostname the CLI and the MCP server grade as a pre-launch grade: a local
 * dev name or a loopback literal. Nothing else private qualifies.
 */
export function isPreLaunchHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (isLocalDevName(h)) return true;
  return isIP(h) !== 0 && isLoopbackAddress(h);
}

function privateV4(o: number[]): boolean {
  const [a = 0, b = 0] = o;
  if (a === 0) return true; // this network
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0 && o[2] === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * True for any address that must never be fetched: loopback, link-local,
 * RFC 1918, CGNAT, unique-local, multicast, unspecified, and every IPv6 form
 * that embeds one of those IPv4 addresses (mapped, compatible, NAT64, 6to4).
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return privateV4(v4);
  const g = parseV6(ip);
  if (!g) return true; // not an address at all: never connect to it
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = (hi: number, lo: number) => privateV4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  if (g.every((x) => x === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return embedded(g6, g7); // ::ffff:a.b.c.d and ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7); // NAT64 64:ff9b::/96
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Why a hostname may not be fetched without resolving it, or null when it needs a lookup. */
export function literalReason(hostname: string): string | null {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (isForbiddenName(h)) return 'name is reserved for the local machine or network';
  if (isIP(h) && isPrivateAddress(h)) return 'address is private, loopback, link-local or reserved';
  return null;
}

export async function defaultLookup(hostname: string): Promise<Address[]> {
  const rows = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family }));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('lookup timed out')), ms);
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

export interface HostGuardOptions {
  /** Test hook. Defaults to dns.lookup with every address. */
  lookup?: Lookup;
  /** Tests only: let the engine fetch loopback and private addresses. */
  allowPrivate?: boolean;
  /**
   * Pre-launch grade of a local server: loopback names and addresses pass,
   * and a name may only resolve to loopback. Every other private address,
   * on the input or on a redirect, is refused exactly as without it.
   */
  allowLoopback?: boolean;
}

type LookupCallback = ((err: NodeJS.ErrnoException | null, address: string, family: number) => void) & ((err: NodeJS.ErrnoException | null, addresses: Address[]) => void);

export interface HostGuard {
  /** Throws UnsafeHostError. Resolves to the vetted addresses, which later connects to the host are pinned to. */
  check(url: URL): Promise<Address[]>;
  /** A dispatcher whose connections only ever use addresses that passed check(). */
  dispatcher: Dispatcher;
  /** The same guarantee for a raw socket (the TLS probe): a net.connect compatible lookup. */
  lookup(hostname: string, options: { all?: boolean; family?: number | string } | number | undefined, callback: LookupCallback): void;
  close(): Promise<void>;
}

/**
 * One guard per grade. The vetted addresses are cached for the life of the
 * guard, so the check and every connect see the same answer: a host that
 * changes its record between the two (DNS rebinding) gains nothing.
 */
export function createHostGuard(opts: HostGuardOptions = {}): HostGuard {
  const lookupImpl = opts.lookup ?? defaultLookup;
  const allowPrivate = opts.allowPrivate === true;
  const allowLoopback = opts.allowLoopback === true;
  const vetted = new Map<string, Promise<Address[]>>();

  const resolveVetted = (hostname: string): Promise<Address[]> => {
    const key = hostname.toLowerCase().replace(/\.$/, '');
    let p = vetted.get(key);
    if (!p) {
      p = (async () => {
        const literal = literalReason(key);
        const loopbackName = allowLoopback && isPreLaunchHost(key);
        if (literal && !allowPrivate && !loopbackName) throw new UnsafeHostError(key, literal);
        const bare = key.replace(/^\[|\]$/g, '');
        if (isIP(bare)) return [{ address: bare, family: isIP(bare) }];
        let rows: Address[];
        try {
          rows = await withTimeout(lookupImpl(bare), LOOKUP_TIMEOUT_MS);
        } catch (e) {
          // localhost and *.localhost are loopback by definition (RFC 6761); not every resolver says so.
          if (loopbackName && /(^|\.)localhost$/.test(bare)) rows = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];
          else {
            const code = (e as { code?: string }).code ?? (e as Error).message;
            throw new UnsafeHostError(key, `did not resolve (${code})`);
          }
        }
        if (rows.length === 0) throw new UnsafeHostError(key, 'did not resolve (no addresses)');
        if (!allowPrivate && rows.some((r) => isPrivateAddress(r.address))) {
          if (!(allowLoopback && rows.every((r) => isLoopbackAddress(r.address)))) {
            throw new UnsafeHostError(key, 'resolves to a private, loopback, link-local or reserved address');
          }
        }
        return rows;
      })();
      vetted.set(key, p);
      p.catch(() => vetted.delete(key));
    }
    return p;
  };

  const check = async (url: URL): Promise<Address[]> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeHostError(url.hostname, `scheme ${url.protocol} is not fetched`);
    if (!url.hostname) throw new UnsafeHostError('', 'no hostname');
    return resolveVetted(url.hostname);
  };

  const lookup: HostGuard['lookup'] = (hostname, options, callback) => {
    const o = typeof options === 'object' && options ? options : {};
    const family = typeof options === 'number' ? options : typeof o.family === 'number' ? o.family : typeof o.family === 'string' ? Number(o.family.replace(/^IPv/i, '')) : 0;
    resolveVetted(hostname).then(
      (rows) => {
        const usable = family === 4 || family === 6 ? rows.filter((r) => r.family === family) : rows;
        const first = usable[0];
        if (!first) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), [] as Address[]);
          return;
        }
        if (o.all) callback(null, usable);
        else callback(null, first.address, first.family);
      },
      (e: Error) => callback(Object.assign(e, { code: 'ENOTFOUND' }), [] as Address[]),
    );
  };

  const dispatcher = new Agent({ connect: { lookup } });

  return {
    check,
    dispatcher,
    lookup,
    close: () => dispatcher.close(),
  };
}
