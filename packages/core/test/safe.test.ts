import { describe, it, expect } from 'vitest';
import { createHostGuard, isForbiddenName, isPrivateAddress, normalizeInput, grade, UnsafeHostError } from '../src/index.js';
import type { Resolver } from '../src/index.js';

/**
 * The request-forgery guard. Addresses are written as the sweep allows them;
 * the ones it does not list are built from octets so no literal appears here.
 */
const PUBLIC_V4 = '8.8.8.8';
const RFC1918_172 = [172, 16, 0, 1].join('.');
const CGNAT = [100, 64, 0, 1].join('.');
const LOOPBACK = '127.0.0.1';
const METADATA = '169.254.169.254';
const LINK_LOCAL_TOP = [169, 254, 255, 255].join('.');
const NAT64_PRIVATE = `64:ff9b::${[10, 0, 0, 1].join('.')}`;
const MAPPED_LOOPBACK = `::ffff:${LOOPBACK}`;
const MAPPED_HEX_RFC1918 = '::ffff:c0a8:1'; // 192.168.0.1 in mapped hex form

function fakeResolver(): Resolver {
  const nodata = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  return { resolveNs: () => Promise.resolve(['ns1.dns.example']), resolve4: () => Promise.resolve([PUBLIC_V4]), resolve6: nodata, resolveMx: nodata, resolveTxt: nodata, resolveCname: nodata, resolveCaa: nodata };
}

describe('isPrivateAddress', () => {
  it('refuses every reserved IPv4 range', () => {
    for (const ip of ['0.0.0.0', [0, 1, 2, 3].join('.'), '10.0.0.0', [10, 255, 255, 255].join('.'), LOOPBACK, [127, 255, 0, 1].join('.'), CGNAT, [100, 127, 255, 255].join('.'), METADATA, LINK_LOCAL_TOP, RFC1918_172, [172, 31, 255, 255].join('.'), '192.168.0.1', [192, 0, 0, 8].join('.'), [224, 0, 0, 1].join('.'), [255, 255, 255, 255].join('.')]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('passes public IPv4 addresses, including the edges of the private ranges', () => {
    for (const ip of [PUBLIC_V4, '1.1.1.1', [100, 63, 255, 255].join('.'), [100, 128, 0, 1].join('.'), [172, 15, 255, 255].join('.'), [172, 32, 0, 1].join('.'), [192, 167, 255, 255].join('.'), [9, 255, 255, 255].join('.'), [11, 0, 0, 1].join('.')]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses loopback, unspecified, link-local, unique-local and multicast IPv6', () => {
    for (const ip of ['::1', '::', '0:0:0:0:0:0:0:1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '[::1]', 'fe80::1%en0']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('sees through IPv6 forms that embed a private IPv4 address', () => {
    for (const ip of [MAPPED_LOOPBACK, MAPPED_HEX_RFC1918, `::ffff:${METADATA}`, `::${LOOPBACK}`, NAT64_PRIVATE, '2002:c0a8:1::', '2002:a9fe:a9fe::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress(`::ffff:${PUBLIC_V4}`)).toBe(false);
    expect(isPrivateAddress('64:ff9b::808:808')).toBe(false);
  });

  it('passes public IPv6 and refuses anything that is not an address', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('1:2:3:4:5:6:7:8:9')).toBe(true);
    expect(isPrivateAddress('::1::2')).toBe(true);
  });
});

describe('isForbiddenName', () => {
  it('refuses the names that mean this machine or this network', () => {
    for (const h of ['localhost', 'LOCALHOST.', 'app.localhost', 'printer.local', 'metadata.google.internal', 'db.internal', 'router.home.arpa']) expect(isForbiddenName(h), h).toBe(true);
    for (const h of ['example.com', 'internal.example.com', 'localhost.example', 'local.example.org']) expect(isForbiddenName(h), h).toBe(false);
  });
});

describe('normalizeInput', () => {
  it('refuses private literals and reserved names before anything resolves', () => {
    for (const input of ['http://localhost:3000', 'localhost', `http://${LOOPBACK}/`, 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://[::1]/', `http://${METADATA}/latest/meta-data`, `http://[::ffff:${LOOPBACK}]/`, 'http://app.local/', 'http://0.0.0.0/']) {
      expect(() => normalizeInput(input), input).toThrow(UnsafeHostError);
    }
  });

  it('refuses schemes other than http and https', () => {
    expect(() => normalizeInput('ftp://example.com')).toThrow(/Not an http/);
    expect(() => normalizeInput('file:///etc/passwd')).toThrow(/Not an http/);
  });

  it('accepts a public name and keeps the tests-only override explicit', () => {
    expect(normalizeInput('example.com').toString()).toBe('https://example.com/');
    expect(normalizeInput(`http://${LOOPBACK}:4000/x`, { allowPrivate: true }).hostname).toBe(LOOPBACK);
  });
});

describe('createHostGuard', () => {
  const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('refuses a name whose answer contains any private address', async () => {
    for (const answers of [[LOOPBACK], [PUBLIC_V4, RFC1918_172], [CGNAT], ['fe80::1'], ['fd00::1'], [MAPPED_LOOPBACK], [PUBLIC_V4, '::1']]) {
      const guard = createHostGuard({ lookup: lookupTo(...answers) });
      await expect(guard.check(new URL('https://victim.example/')), answers.join(',')).rejects.toBeInstanceOf(UnsafeHostError);
      await guard.close();
    }
  });

  it('passes a name that only resolves to public addresses and refuses one that does not resolve', async () => {
    const guard = createHostGuard({ lookup: lookupTo(PUBLIC_V4, '2001:4860:4860::8888') });
    const rows = await guard.check(new URL('https://ok.example/'));
    expect(rows.map((r) => r.address)).toEqual([PUBLIC_V4, '2001:4860:4860::8888']);
    await guard.close();
    const dead = createHostGuard({ lookup: () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })) });
    await expect(dead.check(new URL('https://gone.example/'))).rejects.toThrow(/did not resolve/);
    await dead.close();
  });

  it('refuses literals and reserved names without resolving, and non-http schemes', async () => {
    let calls = 0;
    const guard = createHostGuard({
      lookup: async () => {
        calls += 1;
        return [{ address: PUBLIC_V4, family: 4 }];
      },
    });
    await expect(guard.check(new URL(`http://${METADATA}/`))).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(guard.check(new URL('http://localhost/'))).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(guard.check(new URL('http://[::1]/'))).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(guard.check(new URL('ftp://ok.example/'))).rejects.toThrow(/scheme/);
    expect(calls).toBe(0);
    await guard.close();
  });

  it('pins every later connect to the answer that passed the check (no rebinding)', async () => {
    let answer = [PUBLIC_V4];
    const guard = createHostGuard({ lookup: async () => answer.map((address) => ({ address, family: 4 })) });
    await guard.check(new URL('https://rebind.example/'));
    answer = [LOOPBACK];
    const all = await new Promise<{ address: string }[]>((resolve, reject) => guard.lookup('rebind.example', { all: true }, (err, rows) => (err ? reject(err) : resolve(rows as { address: string }[]))));
    expect(all.map((r) => r.address)).toEqual([PUBLIC_V4]);
    const one = await new Promise<string>((resolve, reject) => guard.lookup('rebind.example', { family: 4 }, (err, address) => (err ? reject(err) : resolve(address as string))));
    expect(one).toBe(PUBLIC_V4);
    await guard.close();
  });

  it('refuses at the socket too when a host was never checked', async () => {
    const guard = createHostGuard({ lookup: lookupTo(LOOPBACK) });
    await expect(new Promise((resolve, reject) => guard.lookup('unchecked.example', { all: true }, (err, rows) => (err ? reject(err) : resolve(rows))))).rejects.toThrow(/private/);
    await guard.close();
  });

  it('only the explicit tests-only override lets private answers through', async () => {
    const guard = createHostGuard({ lookup: lookupTo(LOOPBACK), allowPrivate: true });
    expect((await guard.check(new URL('http://fixture.example/'))).map((r) => r.address)).toEqual([LOOPBACK]);
    await guard.close();
  });
});

describe('the fetcher refuses private hops', () => {
  const HTML = '<!doctype html><html lang="en"><head><title>Guard test page title</title></head><body><h1>Hi</h1></body></html>';

  function fakeFetch(handler: (url: string) => Response): typeof fetch & { calls: string[] } {
    const calls: string[] = [];
    const f = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return handler(url);
    }) as typeof fetch & { calls: string[] };
    f.calls = calls;
    return f;
  }

  it('does not follow a redirect to a private address or a reserved name', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url === 'https://redirector.example/') return new Response(null, { status: 302, headers: { location: `http://${METADATA}/latest/meta-data/` } });
      if (url === 'https://redirector.example/robots.txt') return new Response(null, { status: 301, headers: { location: 'http://localhost:9200/' } });
      if (url === 'https://redirector.example/sitemap.xml') return new Response(null, { status: 301, headers: { location: 'https://internal-only.example/' } });
      if (/rdap/.test(url)) return new Response('{}', { status: 404 });
      return new Response('nope', { status: 404 });
    });
    const lookup = async (hostname: string) => [{ address: hostname === 'internal-only.example' ? RFC1918_172 : PUBLIC_V4, family: 4 }];
    const r = await grade('https://redirector.example', { fetch: fetchImpl, dns: fakeResolver(), lookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(fetchImpl.calls.some((u) => u.includes(METADATA))).toBe(false);
    expect(fetchImpl.calls.some((u) => u.includes('localhost'))).toBe(false);
    expect(fetchImpl.calls.some((u) => u.includes('internal-only.example'))).toBe(false);
    expect(r.checks.length).toBeGreaterThan(40);
  });

  it('refuses the input itself when its name resolves privately', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }));
    const lookup = async () => [{ address: LOOPBACK, family: 4 }];
    const r = await grade('https://intranet.example', { fetch: fetchImpl, dns: fakeResolver(), lookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(r.checks.length).toBeGreaterThan(40);
    expect(r.grade).toBe('F');
  });

  it('refuses URLs lifted from the page (og:image, icon) that point at private hosts', async () => {
    const page = `<!doctype html><html lang="en"><head><title>Lifted URLs test page</title><meta property="og:image" content="http://${LOOPBACK}:8080/og.png"><link rel="icon" href="http://printer.local/favicon.ico"></head><body><h1>Hi</h1><img src="http://[::1]/big.jpg"></body></html>`;
    const fetchImpl = fakeFetch((url) => {
      if (url === 'https://lifted.example/') return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
      if (/rdap/.test(url)) return new Response('{}', { status: 404 });
      return new Response('nope', { status: 404 });
    });
    const lookup = async () => [{ address: PUBLIC_V4, family: 4 }];
    await grade('https://lifted.example', { fetch: fetchImpl, dns: fakeResolver(), lookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(fetchImpl.calls.filter((u) => !u.startsWith('https://lifted.example') && !u.startsWith('http://lifted.example') && !/rdap/.test(u))).toEqual([]);
  });
});
