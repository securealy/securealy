import { readTextCapped } from 'securealy-core';
import type { GradeResult } from 'securealy-core';

/** The only Securealy-specific constant in this repository. */
export const API_BASE = 'https://securealy.com';
/** No answer from securealy.com is read past this many bytes, before any parsing. */
export const MAX_BODY_BYTES = 256 * 1024;

async function body(res: Response): Promise<string> {
  const r = await readTextCapped(res, MAX_BODY_BYTES);
  if (r.truncated) throw new ApiError(res.status, `response larger than ${MAX_BODY_BYTES} bytes was not read`);
  return r.text;
}

export interface ApiOptions {
  fetch: typeof fetch;
  userAgent: string;
  /** Upper bound on how long to wait for a queued hosted grade. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`securealy.com answered ${status}: ${body.slice(0, 300)}`);
    this.name = 'ApiError';
  }
}

interface GradeResponse {
  id?: string;
  status?: 'queued' | 'done' | string;
  result?: GradeResult;
  error?: string;
}

/**
 * Verified-tier grade through the hosted API. The token travels in the
 * Authorization header only; it is never placed in a URL or a log line.
 * A queued job is polled with a hard upper bound.
 */
export async function hostedGrade(url: string, token: string, api: ApiOptions): Promise<GradeResult> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': api.userAgent };
  const res = await api.fetch(`${API_BASE}/api/grade`, { method: 'POST', headers, body: JSON.stringify({ url, tier: 'verified' }) });
  const text = await body(res);
  if (!res.ok) throw new ApiError(res.status, text);
  let first: GradeResponse;
  try {
    first = JSON.parse(text) as GradeResponse;
  } catch {
    throw new ApiError(res.status, `not JSON: ${text.slice(0, 120)}`);
  }
  if (first.result) return first.result;
  if (!first.id) throw new ApiError(res.status, first.error ?? 'no result and no job id in the response');
  const id = first.id;

  const deadline = Date.now() + (api.pollTimeoutMs ?? 120_000);
  const interval = api.pollIntervalMs ?? 3_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const poll = await api.fetch(`${API_BASE}/api/grade/${encodeURIComponent(id)}`, { headers: { authorization: headers.authorization, accept: 'application/json', 'user-agent': api.userAgent } });
    const pollText = await body(poll);
    if (!poll.ok) throw new ApiError(poll.status, pollText);
    let parsed: GradeResponse | GradeResult;
    try {
      parsed = JSON.parse(pollText) as GradeResponse | GradeResult;
    } catch {
      throw new ApiError(poll.status, `not JSON: ${pollText.slice(0, 120)}`);
    }
    if ('schema' in parsed && parsed.schema === 1) return parsed;
    if ('result' in parsed && parsed.result) return parsed.result;
  }
  throw new ApiError(504, `grade ${id} was still queued after ${Math.round((api.pollTimeoutMs ?? 120_000) / 1000)} s; fetch it later from ${API_BASE}/api/grade/${id}`);
}

export interface FixPayload {
  found: boolean;
  status: number;
  body?: unknown;
}

/** GET /checks/<id>.json. Returns found:false on 404 or a network failure. */
export async function fetchFix(id: string, api: ApiOptions): Promise<FixPayload> {
  try {
    const res = await api.fetch(`${API_BASE}/checks/${encodeURIComponent(id)}.json`, { headers: { accept: 'application/json', 'user-agent': api.userAgent } });
    if (!res.ok) return { found: false, status: res.status };
    const text = await body(res);
    try {
      return { found: true, status: res.status, body: JSON.parse(text) };
    } catch {
      return { found: true, status: res.status, body: text.slice(0, 20_000) };
    }
  } catch {
    return { found: false, status: 0 };
  }
}

/** POST /api/results with a Bearer token. */
export async function postResult(result: GradeResult, token: string, api: ApiOptions): Promise<{ status: number; body: string }> {
  const res = await api.fetch(`${API_BASE}/api/results`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': api.userAgent },
    body: JSON.stringify(result),
  });
  const text = (await readTextCapped(res, 2_000)).text;
  return { status: res.status, body: text };
}
