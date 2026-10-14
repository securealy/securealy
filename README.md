# Securealy

You just shipped something with Lovable, Bolt, v0, Cursor or Claude Code. It works. Is it safe to put in front of strangers?

Securealy grades a URL the way an attacker and a customer would see it, in under a minute, and shows the fix for everything it finds.

```
npx securealy grade https://your-app.vercel.app
```

```
 ####     securealy  https://your-app.vercel.app
 #   #    Grade D  (64/100)   passive tier   19 requests   4.1 s
 #   #    1 blocker . 6 fail . 4 warn . 31 pass . 9 skip . 0 error
 #   #    capped: D or lower because of 1 blocker
 ####     stack: host vercel . builder lovable . db supabase . payments stripe

BLOCKERS
  FAIL  secrets-in-bundle    sk_live_... (stripe-secret) found in /assets/index-8f3a.js (redacted)
                             No secret keys in client JavaScript (blocker) -> https://securealy.com/checks/secrets-in-bundle
```

This repository is the open-source engine: the check catalogue, the grading library, the CLI, the MCP server, the Claude Code plugin, the GitHub Action and the test fixtures. The hosted grader at [securealy.com](https://securealy.com) runs the same code.

## What it checks

58 remote checks and 7 local ones, every one of them listed in [`packages/checks/checks.json`](packages/checks/checks.json) with what passing means and why it matters.

| Category | Examples |
|---|---|
| Security | TLS, HSTS, CSP strength, cookie flags, CORS, source maps, secret keys in bundles, Supabase REST exposure, Firebase config |
| Payments | Stripe test key in production, webhook wiring |
| Email | SPF, DKIM, DMARC, MX, whether your magic-link sender is authenticated |
| Domain | Nameservers, DNSSEC, CAA, registration expiry, security.txt |
| Hygiene | Soft 404s, builder badges and chat residue, broken links, legal pages, env example parity |
| SEO | Title, description, canonical, H1, Open Graph image, JSON-LD, robots, sitemap, llms.txt, AI crawler policy |
| Analytics | Analytics installed, consent mechanism where required |
| Performance | TTFB, page weight, largest image, render-blocking resources |

## The three tiers

**Passive** works on any URL and does only what a browser does when a visitor opens the site, plus DNS and TLS lookups: the home page and its first-party scripts, robots.txt, sitemap.xml, security.txt, one random path for the 404 check, a HEAD on the social image. At most 25 requests, 8 seconds each, 3 redirects, 45 seconds in total. Never port scans, never guesses credentials, never reads rows.

**Verified** runs after you prove you own the domain. It adds the probes you would want run against your own site but nobody should run against someone else's: `/.env` and `/.git` served by URL, internal files, admin and API routes answering anonymous requests, Supabase tables returning rows to the anon key, listable storage buckets, and a 10-request burst to see whether anything rate-limits.

**Local** runs on your machine with your own credentials and nothing leaves it except the result you choose to post:

```
npx securealy scan-repo            # secrets in git history, .gitignore coverage, .env.example parity
npx securealy check-rls            # SUPABASE_MGMT_TOKEN + project ref, or SUPABASE_URL + SUPABASE_SERVICE_KEY
npx securealy check-stripe         # STRIPE_SECRET_KEY (+ SECUREALY_PRODUCTION_URL to compare the webhook host)
npx securealy check-vercel-env     # VERCEL_TOKEN + VERCEL_PROJECT_ID (+ SECUREALY_VERCEL_DECRYPT=1 to read values)
npx securealy local                # all of the above
```

## Not deployed yet?

An app that only runs on your machine still gets a grade:

```
npx securealy local                          # repo checks that need no URL at all
npx securealy grade http://localhost:3000    # pre-launch grade of the running app
```

The second one is a **pre-launch grade**: the result carries `preLaunch: true`, the checks that need a public domain (TLS, HSTS, the https redirect, DNS, email, domain registration, the Stripe live key, server latency) are skipped with the reason, and the score covers the rest, so a clean local app can reach A. Blockers such as a secret in the bundle, a missing CSP and leaky cookies apply exactly as they will after launch. `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test` qualify, plain `http://` included; every other private address is refused as always.

Then get to a real domain with Module 00 and Module 01 of the Fix Kit (or its `AUTOPILOT.md`), and run the same `grade` command on that URL for the real grade.

Every environment variable is trimmed before use, sent only to the service it belongs to, and never printed. Evidence is redacted at the source: a found key shows as its first six characters and an ellipsis. The service key goes only to an https URL on a Supabase-hosted domain (`SECUREALY_SUPABASE_HOST_OVERRIDE=1` for a self-hosted project), and the Vercel check reads variable values only with `SECUREALY_VERCEL_DECRYPT=1`; without it the trailing-newline and live-key checks are reported as skipped. The full list of variables read and hosts contacted is under "What leaves your machine".

## The learning record

Every `grade`, `local`, `scan-repo`, `check-rls`, `check-stripe` and `check-vercel-env` run (and every `grade_url`, `scan_repo`, `check_rls`, `check_stripe` and `check_vercel_env` call through the MCP server) appends one entry to `.securealy/history.json` in the current working directory:

```json
{ "at": "2026-10-12T23:00:00Z", "command": "grade", "tier": "passive", "host": "your-app.com",
  "grade": "B", "score": 83, "summary": { "blocker": 0, "fail": 4, "warn": 3, "pass": 38, "skip": 6, "error": 0 },
  "id": "g_01J...", "failed": ["hsts", "not-found-page"], "engineVersion": "0.1.4" }
```

That is the whole entry: ids and numbers. Never evidence strings, never tokens, never environment values; `host` is recorded only for a grade of a URL. The newest 200 entries are kept, and a `README.md` beside the file explains it. The file is safe to commit. The next `grade` of the same host prints one line against the previous entry:

```
Previous grade B 83 on 2026-10-12; 2 checks improved, 1 regressed: not-found-page
```

The `grade_url` summary from the MCP server carries the same line, and the launch-check skill reads the file before grading again so it can report the trend. Turn it off with `--no-history` or `SECUREALY_NO_HISTORY=1`. If the working directory is not writable, nothing is written and nothing is said.

## Verifying ownership

```
npx securealy verify your-app.com --token sly_...
```

prints three options; use any one:

1. a DNS TXT record at `_securealy.your-app.com`
2. a `<meta name="securealy-verify">` tag in the home page
3. a file at `/.well-known/securealy.txt`

The published value is a fingerprint of your token, never the token. Then:

```
npx securealy grade https://your-app.com --tier verified --token sly_...
```

Vercel deployment protection? Pass `--bypass <protection bypass token>` and it is sent as the `x-vercel-protection-bypass` header on requests to your host only. In CI, set `SECUREALY_TOKEN` and `SECUREALY_BYPASS` in the environment instead of the flags, so neither token appears on a command line.

## Opting out

Add a TXT record `_securealy` with the value `optout`, or send an `X-Securealy: optout` response header. The grader checks both before anything else and stops.

Every request identifies itself as `SecurealyGrader/1.0 (+https://securealy.com/grader)`.

## Using it from an agent

The same checks are available to coding agents through the `securealy-mcp` server: `grade_url`, `scan_repo`, `check_rls`, `check_stripe`, `check_vercel_env`, `get_check`, `list_checks`, `fetch_fix` and `post_result`, plus the catalogue and this spec as resources. Every output is passed through a redactor.

**Claude Code plugin** (adds the `/securealy:launch-check` skill and the server):

```
claude plugin marketplace add securealy/securealy
claude plugin install securealy@securealy
```

The marketplace is published from this repository.

**Claude Code, server only:**

```
claude mcp add securealy -- npx -y securealy-mcp
```

**Cursor:** [Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=securealy&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNlY3VyZWFseS1tY3AiXX0=), or add to `mcp.json`:

```json
{ "mcpServers": { "securealy": { "command": "npx", "args": ["-y", "securealy-mcp"] } } }
```

**VS Code:** [Install in VS Code](vscode:mcp/install?%7B%22name%22%3A%22securealy%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22securealy-mcp%22%5D%7D), or `code --add-mcp '{"name":"securealy","command":"npx","args":["-y","securealy-mcp"]}'`.

**Codex:**

```
codex mcp add securealy -- npx -y securealy-mcp
```

**Any other MCP client:** run `npx -y securealy-mcp` over stdio. The server is listed in the MCP Registry as `com.securealy/mcp`.

**Agent skills:** the `launch-check` skill in `skills/` follows the Agent Skills format, so `npx skills add securealy/securealy` installs it into any compatible agent.

### What leaves your machine

The passive grade sends requests only to the URL being graded (what a browser would request, at most 25) plus DNS, TLS and RDAP lookups for its domain; nothing goes to Securealy. The verified grade sends the URL and your project token to securealy.com. `fetch_fix` sends a check id to securealy.com. `post_result` sends a result and your token to securealy.com, and only when you ask. The repository scan reads the folder you confirm and sends nothing. The Supabase, Stripe and Vercel checks read their credentials from your environment, send each one only to the service it belongs to, and never print them. The learning record (`.securealy/history.json`) stays on your machine.

**Hosts contacted.** `grade`: the URL you give, the hosts it redirects to, and the same-site URLs found in the page (scripts, source maps, sitemap entries, links, images, `og:image`, the icon); the Supabase project URL found in a bundle and `firebasestorage.googleapis.com` when a Firebase bucket is named; your system DNS resolver, plus `1.1.1.1` and `8.8.8.8` for the DNSSEC query; `rdap.org` and, for `.com` and `.net`, `rdap.verisign.com`. Every one of those must be a public address: loopback, link-local, private, CGNAT, unique-local, multicast and reserved addresses, and the names that mean them, are refused on the input, on every redirect and on every URL found in a page. `check-rls`: `api.supabase.com` with a management token, or your Supabase project URL with the service key. `check-stripe`: `api.stripe.com`. `check-vercel-env`: `api.vercel.com`. `securealy.com`: the verified tier, `post`, `fetch_fix`, and telemetry when you turn it on.

**Environment variables read.** `scan-repo`, `gitignore-env-coverage` and `env-example-parity`: none. `check-rls` and `supabase-auth-config`: `SUPABASE_MGMT_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SECUREALY_SIGNUP`, `SECUREALY_SUPABASE_HOST_OVERRIDE`. `check-stripe`: `STRIPE_SECRET_KEY` and, for the production host, the first set of `SECUREALY_PRODUCTION_URL`, `PRODUCTION_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_URL`, `PUBLIC_SITE_URL`, `SITE_URL`, `APP_URL`, `VERCEL_PROJECT_PRODUCTION_URL` (the same list names the host in every local result). `check-vercel-env`: `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `VERCEL_ORG_ID`, `SECUREALY_VERCEL_DECRYPT`, and `.vercel/project.json` in the folder for the project and team ids. `grade`: `SECUREALY_TOKEN`, `SECUREALY_BYPASS`. Every run: `SECUREALY_NO_HISTORY`, `SECUREALY_TELEMETRY`. The MCP server also reads `SECUREALY_SCAN_ROOTS`. The MCP server's redactor additionally learns the value of every variable whose name looks secret and the password inside any variable that is a URL (`DATABASE_URL` and friends) so that none of them can appear in an output.

**Telemetry is off by default and is never prompted for.** If you set `SECUREALY_TELEMETRY=1`, each of the runs listed under the learning record also sends one POST to `https://securealy.com/api/telemetry` with exactly this and nothing else:

```json
{ "command": "grade", "tier": "passive", "grade": "B", "score": 83, "durationMs": 4120, "requests": 19,
  "counts": { "pass": 38, "fail": 4, "warn": 3, "skip": 6, "error": 0, "blocker": 0 },
  "engine": "0.1.4", "node": 22,
  "stack": { "host": "vercel", "builder": "lovable", "db": "supabase", "payments": "stripe", "framework": "next" },
  "failed": ["hsts", "not-found-page"] }
```

`command` is one of `grade`, `local`, `scan-repo`, `check-rls`, `check-stripe`, `check-vercel-env`, or `mcp.grade_url`, `mcp.scan_repo`, `mcp.check_rls`, `mcp.check_stripe`, `mcp.check_vercel_env`. `engine` is the engine version, `node` the Node major version, and `stack.host` is the hosting platform kind the grader detected (`vercel`, `netlify`), not your hostname; a field the grader could not detect is `null`. No URL, no hostname, no path, no evidence, no token and no environment value ever leaves. The request is fire and forget with a three-second timeout; a failure is silent and never changes a run. The aggregate is used to tune the catalogue: which checks fail most on which stacks.

## Using it in CI

```
npx securealy grade https://your-app.com --min-grade B
```

exits 1 when the grade is below the minimum (default C), so a deploy step can gate on it. `--json` prints the full `GradeResult` described in [SPEC.md](SPEC.md).

**GitHub Action:** grades a URL, writes the grade stamp and the failing checks to the job summary, uploads the JSON as an artifact, and fails the job below `min-grade`.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
    with:
      node-version: 22
  - uses: securealy/securealy/packages/action@v0.1.0
    with:
      url: https://your-app.vercel.app
      min-grade: B
```

Inputs, outputs and the verified-tier form are in [packages/action/README.md](packages/action/README.md).

## Using the engine directly

```ts
import { grade, runLocal, catalogue, score } from 'securealy-core';

const result = await grade('https://your-app.com');
console.log(result.grade, result.score, result.summary);
```

`grade()` gathers every piece of evidence once, within the request budget, then runs each check as a pure function over that evidence. The same evidence always produces the same result.

## Why these checks

Each category exists because of a kind of incident that keeps happening to apps built fast:

- **Security**: a service-role key in a bundle, or a database with row level security off, is the single most common way a freshly launched app leaks every user's data to anyone who opens devtools. Missing headers turn a small XSS into session theft.
- **Payments**: a production site on a test key takes no money and nobody notices until launch day; an unwired webhook takes the money and delivers nothing.
- **Email**: magic links and receipts sent from an unauthenticated domain land in spam, and users who cannot sign in simply leave.
- **Domain**: an expired domain or certificate takes down the site, the email and every login at once, usually on a weekend.
- **Hygiene**: a soft 404 lets search engines index garbage; a builder badge or a stray `localhost` URL tells visitors and attackers nobody reviewed the site before shipping it.
- **SEO**: the title is the search result and the Open Graph image is every share; a broken sitemap wastes the little crawl budget a new site gets.
- **Analytics**: launching without measurement means never learning what worked.
- **Performance**: one unoptimized hero image is usually half the page, and the page is the mobile experience.

## Layout

```
packages/checks   the catalogue (checks.json), the source of truth for every check id
packages/core     the engine: fetcher, 58 remote check modules, 7 local checks, scoring
packages/cli      the securealy command
packages/mcp      the securealy-mcp server (stdio) for agents
packages/action   the GitHub Action
plugin/           the Claude Code plugin (skill + server); .claude-plugin/marketplace.json at the root lists it
skills/           the launch-check skill in Agent Skills layout
```

## Development

```
npm install
npm run build
npm test            # vitest: a pass/fail fixture pair per check, scoring, redaction, opt-out
LIVE=1 npm test     # also grades https://example.com for real
npm run lint
npm run smoke       # starts the MCP server over stdio and lists its tools
npm run sweep       # fails on any credential-shaped string or foreign hostname in tracked files
```

Releases, registry and directory submissions: [docs/publishing.md](docs/publishing.md). What changed in each release: [CHANGELOG.md](CHANGELOG.md).

New checks start in `checks.json`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
