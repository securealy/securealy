/**
 * The evidence gathered once by the fetcher. Everything in here is plain JSON
 * so that a fixture under test/fixtures/<id>/ is simply a serialized Evidence.
 * Checks never fetch: they read this object and nothing else.
 */

export type BodyHint = 'html' | 'json' | 'env' | 'git' | 'xml' | 'text' | 'binary' | 'empty';

export interface HttpRecord {
  url: string;
  method: 'GET' | 'HEAD';
  /** 0 when no response was received (see error) */
  status: number;
  /** lower-cased header names, duplicates joined with ", " (set-cookie kept apart) */
  headers: Record<string, string>;
  setCookie: string[];
  /** Location values that were followed to reach this response */
  redirects: string[];
  /** bytes actually read (capped) */
  bytes: number;
  contentLength: number | null;
  ttfbMs: number;
  totalMs: number;
  /** kept only for text resources the checks need (HTML, robots, sitemap, bundles) */
  body?: string;
  truncated?: boolean;
  /** what the first bytes looked like, recorded even when the body is discarded */
  bodyHint?: BodyHint;
  /** set when a HEAD answered 405 or 501 and the record comes from the GET retry */
  headFallback?: number;
  error?: string;
}

export interface DnsEvidence {
  ns: string[];
  a: { apex: string[]; www: string[]; host: string[] };
  aaaa: { apex: string[]; www: string[]; host: string[] };
  cname: string[];
  mx: { exchange: string; priority: number }[];
  txt: string[];
  dmarc: string[];
  dkim: Record<string, string | null>;
  caa: string[];
  /** null when the DNSSEC query could not be made */
  dnssec: boolean | null;
  /** TXT values at _securealy.<host> and _securealy.<apex> */
  securealyTxt: string[];
  errors: Record<string, string>;
}

export interface RdapEvidence {
  expires: string | null;
  registrar?: string;
  error?: string;
  skipped?: string;
}

export interface TlsEvidence {
  /** a TLS handshake completed and a certificate was presented */
  connected: boolean;
  authorized: boolean;
  authorizationError?: string;
  hostMatches: boolean;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  sans: string[];
  issuer?: string;
  subject?: string;
  error?: string;
}

export interface SupabaseEvidence {
  url: string;
  /** the anon key is public by construction but is still stored redacted */
  anonKeyRedacted: string;
  /** role claim decoded from the key, when it is a JWT */
  anonRole: string | null;
  rest: HttpRecord | null;
  /** table names from the REST metadata, never rows */
  tables: string[];
}

export interface FirebaseEvidence {
  projectId: string | null;
  storageBucket: string | null;
  apiKeyRedacted: string | null;
}

export interface RouteProbe {
  url: string;
  source: 'sitemap' | 'bundle' | 'html';
  record: HttpRecord;
}

export interface TableRead {
  table: string;
  status: number;
  /** true when at least one row came back, false when zero rows, null when unknown */
  rows: boolean | null;
  count: number | null;
  error?: string;
}

export interface BurstEvidence {
  url: string;
  statuses: number[];
  limited: boolean;
  /** rate-limit related header names seen */
  headers: string[];
}

export interface VerifiedEvidence {
  method: 'dns' | 'meta' | 'well-known';
  envFiles: HttpRecord[];
  git: HttpRecord[];
  internalFiles: HttpRecord[];
  routes: RouteProbe[];
  tableReads: TableRead[];
  storage: HttpRecord | null;
  storageKind: 'supabase' | 'firebase' | null;
  burst: BurstEvidence | null;
}

export interface Evidence {
  input: string;
  host: string;
  apex: string;
  /** e.g. "vercel.app" when the host is a subdomain of a hosting platform */
  platformSuffix: string | null;
  tier: 'passive' | 'verified';
  startedAt: string;
  dns: DnsEvidence;
  rdap: RdapEvidence;
  tls: TlsEvidence;
  /** the final HTML response after redirects, null when nothing answered */
  page: HttpRecord | null;
  finalUrl: string;
  /** the plain http:// request, not followed */
  httpProbe: HttpRecord | null;
  bundles: HttpRecord[];
  sourceMaps: HttpRecord[];
  robots: HttpRecord | null;
  sitemap: HttpRecord | null;
  sitemapUrls: string[];
  sitemapSamples: HttpRecord[];
  securityTxt: HttpRecord | null;
  llmsTxt: HttpRecord | null;
  notFound: { path: string; record: HttpRecord } | null;
  favicon: HttpRecord | null;
  ogImage: HttpRecord | null;
  linkSamples: HttpRecord[];
  imageSamples: HttpRecord[];
  supabase: SupabaseEvidence | null;
  firebase: FirebaseEvidence | null;
  verified: VerifiedEvidence | null;
  requests: number;
  log: string[];
}

export function emptyDns(): DnsEvidence {
  return {
    ns: [],
    a: { apex: [], www: [], host: [] },
    aaaa: { apex: [], www: [], host: [] },
    cname: [],
    mx: [],
    txt: [],
    dmarc: [],
    dkim: {},
    caa: [],
    dnssec: null,
    securealyTxt: [],
    errors: {},
  };
}

export function emptyEvidence(input: string, host: string, apex: string): Evidence {
  return {
    input,
    host,
    apex,
    platformSuffix: null,
    tier: 'passive',
    startedAt: new Date(0).toISOString(),
    dns: emptyDns(),
    rdap: { expires: null },
    tls: { connected: false, authorized: false, hostMatches: false, sans: [] },
    page: null,
    finalUrl: input,
    httpProbe: null,
    bundles: [],
    sourceMaps: [],
    robots: null,
    sitemap: null,
    sitemapUrls: [],
    sitemapSamples: [],
    securityTxt: null,
    llmsTxt: null,
    notFound: null,
    favicon: null,
    ogImage: null,
    linkSamples: [],
    imageSamples: [],
    supabase: null,
    firebase: null,
    verified: null,
    requests: 0,
    log: [],
  };
}

export function makeRecord(partial: Partial<HttpRecord> & { url: string }): HttpRecord {
  return {
    method: 'GET',
    status: 0,
    headers: {},
    setCookie: [],
    redirects: [],
    bytes: 0,
    contentLength: null,
    ttfbMs: 0,
    totalMs: 0,
    ...partial,
  };
}
