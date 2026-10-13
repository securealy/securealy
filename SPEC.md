# Securealy engine spec (public)

Securealy grades a URL the way an attacker and a customer would see it, then shows the fix. This repo holds the check catalogue, the engine, the CLI, the MCP server, the Claude Code plugin and the GitHub Action. The hosted grader, monitor and Fix Kit live in a private platform repo that depends on this one. Nothing in this repo ever holds a Securealy secret; the only Securealy-specific value is the public API base URL.

## Tiers

- **passive**: allowed on any domain. Exactly what a browser does when a visitor opens the site, plus DNS and TLS lookups: the home page and the first-party assets it references, robots.txt, sitemap.xml, /.well-known/security.txt, one random path for the 404 check, a HEAD on og:image, the first-party JS bundles. Never: port scans, probing /.env or /.git, credential guessing, row reads with a found key, fuzzing, more than 25 requests, following more than 3 redirects. One request to the Supabase REST root with the page's own anon key counts as passive (the page itself makes it) and reads metadata only.
- **verified**: only after the owner proves control (DNS TXT `_securealy`, meta tag `securealy-verify`, or `/.well-known/securealy.txt`). Adds the probes listed in the catalogue.
- **local**: runs on the owner's machine through the CLI or MCP server with the owner's own credentials from their environment. Nothing leaves the machine except the result the owner chooses to post.

Opt-out: a TXT record `_securealy` with value `optout`, or a response header `X-Securealy: optout`, stops passive grading of that host. Honor it before any other request.

User-Agent on every request: `SecurealyGrader/1.0 (+https://securealy.com/grader)`.

## Catalogue

`packages/checks/checks.json` is the source of truth. Fields: `id` (kebab-case, stable forever), `category` (security, email, domain, seo, hygiene, payments, analytics, performance), `title`, `severity` (blocker, high, medium, low, info), `tier`, `what` (one sentence, what passing means), `why` (one sentence), `module` (Fix Kit module `00` to `09`), `freeFix` (the fix is published free). Adding a check means adding it here first.

## Result schema (`GradeResult`, JSON, the public API contract)

```json
{
  "schema": 1,
  "id": "g_01J...",
  "input": "https://example.com",
  "finalUrl": "https://example.com/",
  "host": "example.com",
  "gradedAt": "2026-10-12T23:00:00Z",
  "tier": "passive",
  "grade": "C",
  "score": 64,
  "capped": "D or lower because of 1 blocker",
  "summary": { "blocker": 1, "fail": 6, "warn": 4, "pass": 31, "skip": 9, "error": 0 },
  "stack": {
    "host": "vercel", "dns": "cloudflare", "builder": "lovable", "db": "supabase",
    "payments": "stripe", "analytics": ["ga4"], "emailProvider": "resend", "framework": "next"
  },
  "checks": [
    { "id": "secrets-in-bundle", "status": "fail", "severity": "blocker",
      "evidence": "sk_live_… found in /assets/index-8f3a.js (redacted)",
      "detail": "optional longer text", "fixSlug": "secrets-in-bundle" }
  ],
  "requests": 19,
  "durationMs": 4120
}
```

Status values: `pass`, `fail`, `warn` (true but low confidence or partial), `skip` (not applicable, with evidence saying why), `error` (the check could not run). `severity` is copied from the catalogue so a result is self-describing. Evidence is a short string, never a response body, and secrets in evidence are always redacted to a prefix plus an ellipsis.

## Scoring

Weights by severity: blocker 10, high 5, medium 3, low 1, info 0. Score = 100 × (sum of weights of passing checks) / (sum of weights of pass+fail+warn checks); warn counts as half a pass; skip and error are excluded. Letter: 90 and up A, 75 B, 60 C, 40 D, else F. Caps: one failing blocker caps at D; two or more cap at F. `capped` explains the cap when applied.

## Engine API (`packages/core`)

```ts
grade(url: string, opts?: { tier?: 'passive' | 'verified', verifyToken?: string, bypassToken?: string, timeoutMs?: number, maxRequests?: number, fetch?: typeof fetch, dns?: Resolver, log?: (line: string) => void }): Promise<GradeResult>
runLocal(opts: { cwd: string, checks?: string[], env?: Record<string,string> }): Promise<GradeResult>   // tier 'local'
catalogue(): Check[]
score(checks: CheckResult[]): { grade, score, capped, summary }
```

Each check is a module in `packages/core/src/checks/<id>.ts` exporting `{ id, run(ctx) }` where `ctx` carries fetched evidence (the HTML, headers, parsed document, bundle text, DNS answers, TLS info) gathered once by the fetcher so checks never fetch on their own. Every check has a fixture pair under `packages/core/test/fixtures/<id>/{pass,fail}` and a test.

Determinism: the same evidence must produce the same result. No randomness except the 404 probe path, which is seeded from the host.

## CLI (`packages/cli`, package name `securealy`)

```
npx securealy grade <url> [--json] [--tier verified --token <sly_...>] [--bypass <vercel token>]
npx securealy verify <domain>            # prints the TXT / meta / well-known options
npx securealy scan-repo [path]           # repo-secrets, gitignore-env-coverage, env-example-parity
npx securealy check-rls                  # reads SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_MGMT_TOKEN + project ref) from env
npx securealy check-stripe               # reads STRIPE_SECRET_KEY from env; reports webhook wiring, never prints the key
npx securealy check-vercel-env           # reads VERCEL_TOKEN (project-scoped) + project id from env
npx securealy post <result.json> --token sly_...   # posts a local result to the owner's project
```

Exit code 0 when grade is at or above `--min-grade` (default C) else 1, so the GitHub Action can gate. Human output is a report: grade stamp, blockers first, then by category, evidence in a mono column. `--json` prints the GradeResult.

Secrets discipline: every env read is trimmed; no secret is ever printed, logged or included in a result; evidence is redacted at the source.

## Public API (hosted, platform repo)

- `POST https://securealy.com/api/grade` `{ url }` → `{ id, status: 'queued'|'done', result? }`; anonymous: two per IP per day, one-hour cache per host, global daily cap. Authenticated with `Authorization: Bearer sly_…`: unlimited for verified projects.
- `GET https://securealy.com/api/grade/:id` → GradeResult.
- `GET https://securealy.com/checks/:id.json` → the catalogue entry plus the fix text the caller is entitled to.
- `POST https://securealy.com/api/results` (Bearer token) → store a local-tier result against a project.
