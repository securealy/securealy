import type { Dispatcher } from 'undici';
import type { BodyHint, HttpRecord } from '../evidence.js';
import { makeRecord } from '../evidence.js';
import { UnsafeHostError } from './safe.js';
import type { HostGuard } from './safe.js';

export const USER_AGENT = 'SecurealyGrader/1.0 (+https://securealy.com/grader)';
export const PER_REQUEST_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

export class Budget {
  used = 0;
  constructor(
    public readonly max: number,
    public readonly deadline: number,
  ) {}
  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }
  get timeLeft(): number {
    return this.deadline - Date.now();
  }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'HEAD';
  /** keep up to this many bytes of the body as text; 0 keeps nothing */
  keepBytes?: number;
  follow?: boolean;
  headers?: Record<string, string>;
  /** header added only for requests to this host */
  bypass?: { host: string; token: string } | null;
}

export interface HttpClient {
  request(url: string, opts?: RequestOptions): Promise<HttpRecord>;
  budget: Budget;
  log: (line: string) => void;
}

function hintFor(head: Uint8Array, contentType: string): BodyHint {
  if (head.length === 0) return 'empty';
  let text = '';
  try {
    text = Buffer.from(head).toString('utf8');
  } catch {
    return 'binary';
  }
  const bom = String.fromCharCode(0xfeff);
  const trimmed = (text.startsWith(bom) ? text.slice(1) : text).trimStart();
  const probe = trimmed.slice(0, 64);
  for (let i = 0; i < probe.length; i++) {
    if (probe.charCodeAt(i) < 9) return 'binary';
  }
  if (/^\[core\]|^ref: /.test(trimmed) || /\[remote "/.test(trimmed)) return 'git';
  if (/^[{[]/.test(trimmed)) return 'json';
  if (/^<\?xml|^<urlset|^<sitemapindex|^<rss|^<feed/i.test(trimmed)) return 'xml';
  if (/^<!doctype html|^<html|<head|<body|<script|<div/i.test(trimmed.slice(0, 2000))) return 'html';
  if (/^(?:#[^\n]*\n|\s*\n)*[A-Z][A-Z0-9_]{1,60}\s*=/.test(trimmed)) return 'env';
  if (/^image\/|^font\/|^application\/octet-stream|^application\/wasm/.test(contentType)) return 'binary';
  return 'text';
}

async function readBody(res: Response, keepBytes: number): Promise<{ text: string; bytes: number; truncated: boolean; head: Uint8Array }> {
  const body = res.body;
  if (!body) return { text: '', bytes: 0, truncated: false, head: new Uint8Array() };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let kept = 0;
  let truncated = false;
  const peek = Math.max(keepBytes, 2048);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      bytes += value.length;
      if (kept < peek) {
        const slice = value.subarray(0, Math.max(0, peek - kept));
        chunks.push(slice);
        kept += slice.length;
      }
      if (kept >= peek) {
        truncated = keepBytes > 0 && kept >= keepBytes;
        // Stop reading once we have what we need, unless we need the byte count for small bodies.
        if (bytes >= Math.max(peek, 1)) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }
  } catch {
    /* ignore read errors, keep what we have */
  }
  const all = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const head = all.subarray(0, 2048);
  const text = keepBytes > 0 ? all.subarray(0, keepBytes).toString('utf8') : '';
  return { text, bytes, truncated, head };
}

function headerMap(h: Headers): { headers: Record<string, string>; setCookie: string[] } {
  const headers: Record<string, string> = {};
  const setCookie: string[] = [];
  const withGetSetCookie = h as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    setCookie.push(...withGetSetCookie.getSetCookie());
  }
  h.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie') {
      if (setCookie.length === 0) setCookie.push(value);
      return;
    }
    headers[k] = headers[k] ? `${headers[k]}, ${value}` : value;
  });
  return { headers, setCookie };
}

/**
 * Every request, including each redirect hop, passes the host guard before a
 * socket is opened, and the connection is pinned to the addresses the guard
 * vetted. A refused URL costs no budget: it never left the machine.
 */
export function createClient(
  fetchImpl: typeof fetch,
  budget: Budget,
  log: (line: string) => void,
  guard: HostGuard,
  defaults: { bypass?: { host: string; token: string } | null } = {},
): HttpClient {
  /** Some origins (Python functions, old proxies) refuse HEAD outright; that says nothing about the resource, so ask again with GET and discard the body. */
  async function request(inputUrl: string, opts: RequestOptions = {}): Promise<HttpRecord> {
    const rec = await requestOnce(inputUrl, opts);
    if ((opts.method ?? 'GET') === 'HEAD' && (rec.status === 405 || rec.status === 501) && budget.remaining > 0) {
      log(`HEAD ${inputUrl} -> ${rec.status}, retrying as GET`);
      const again = await requestOnce(inputUrl, { ...opts, method: 'GET', keepBytes: 0 });
      again.headFallback = rec.status;
      return again;
    }
    return rec;
  }
  async function requestOnce(inputUrl: string, opts: RequestOptions = {}): Promise<HttpRecord> {
    const method = opts.method ?? 'GET';
    const keepBytes = opts.keepBytes ?? 0;
    const follow = opts.follow ?? true;
    const redirects: string[] = [];
    let url = inputUrl;
    const started = Date.now();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (budget.timeLeft <= 0) {
        return makeRecord({ url, method, redirects, error: 'total timeout reached' });
      }
      try {
        await guard.check(new URL(url));
      } catch (e) {
        const reason = e instanceof UnsafeHostError ? e.message : `not a URL: ${(e as Error).message}`;
        log(`${method} ${url} -> refused (${reason})`);
        return makeRecord({ url, method, redirects, totalMs: Date.now() - started, error: `refused: ${reason}`.slice(0, 160) });
      }
      if (!budget.take()) {
        return makeRecord({ url, method, redirects, error: 'request budget exhausted' });
      }
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8',
        'accept-language': 'en',
        ...(opts.headers ?? {}),
      };
      const bypass = opts.bypass ?? defaults.bypass ?? null;
      try {
        if (bypass && new URL(url).hostname.toLowerCase() === bypass.host) {
          headers['x-vercel-protection-bypass'] = bypass.token;
        }
      } catch {
        /* unparsable url, fall through to fetch error */
      }
      const controller = new AbortController();
      const timeoutMs = Math.max(500, Math.min(PER_REQUEST_TIMEOUT_MS, budget.timeLeft));
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const hopStart = Date.now();
      let res: Response;
      try {
        const init: RequestInit & { dispatcher: Dispatcher } = { method, headers, redirect: 'manual', signal: controller.signal, dispatcher: guard.dispatcher };
        res = await fetchImpl(url, init);
      } catch (e) {
        clearTimeout(timer);
        const err = e as Error & { cause?: { code?: string; message?: string } };
        const code = err.cause?.code ?? (err.name === 'AbortError' ? 'TIMEOUT' : err.name);
        const msg = err.cause?.message ?? err.message;
        log(`${method} ${url} -> ${code}`);
        return makeRecord({ url, method, redirects, ttfbMs: Date.now() - hopStart, totalMs: Date.now() - started, error: `${code}: ${msg}`.slice(0, 160) });
      }
      const ttfbMs = Date.now() - hopStart;
      const { headers: resHeaders, setCookie } = headerMap(res.headers);
      const status = res.status;
      const location = resHeaders['location'];
      if (status >= 300 && status < 400 && location && follow && hop < MAX_REDIRECTS) {
        clearTimeout(timer);
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          return makeRecord({ url, method, status, headers: resHeaders, setCookie, redirects, ttfbMs, totalMs: Date.now() - started, error: 'bad redirect location' });
        }
        redirects.push(next);
        log(`${method} ${url} -> ${status} ${next}`);
        url = next;
        continue;
      }
      let bytes = 0;
      let text = '';
      let truncated = false;
      let hint: BodyHint | undefined;
      if (method === 'HEAD') {
        clearTimeout(timer);
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      } else {
        const r = await readBody(res, keepBytes);
        clearTimeout(timer);
        bytes = r.bytes;
        text = r.text;
        truncated = r.truncated;
        hint = hintFor(r.head, resHeaders['content-type'] ?? '');
      }
      const cl = resHeaders['content-length'];
      const contentLength = cl !== undefined && /^\d+$/.test(cl.trim()) ? Number(cl.trim()) : null;
      log(`${method} ${url} -> ${status}${bytes ? ` ${bytes}b` : ''}`);
      const rec = makeRecord({
        url,
        method,
        status,
        headers: resHeaders,
        setCookie,
        redirects,
        bytes,
        contentLength,
        ttfbMs,
        totalMs: Date.now() - started,
      });
      if (keepBytes > 0) {
        rec.body = text;
        rec.truncated = truncated;
      }
      if (hint) rec.bodyHint = hint;
      return rec;
    }
    return makeRecord({ url, method, redirects, totalMs: Date.now() - started, error: `more than ${MAX_REDIRECTS} redirects` });
  }
  return { request, budget, log };
}
