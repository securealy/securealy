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

This repository is the open-source engine: the check catalogue, the grading library, the CLI and the test fixtures. The hosted grader at [securealy.com](https://securealy.com) runs the same code.

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
npx securealy check-vercel-env     # VERCEL_TOKEN + VERCEL_PROJECT_ID
npx securealy local                # all of the above
```

Every environment variable is trimmed before use, sent only to the service it belongs to, and never printed. Evidence is redacted at the source: a found key shows as its first six characters and an ellipsis.

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

Vercel deployment protection? Pass `--bypass <protection bypass token>` and it is sent as the `x-vercel-protection-bypass` header on requests to your host only.

## Opting out

Add a TXT record `_securealy` with the value `optout`, or send an `X-Securealy: optout` response header. The grader checks both before anything else and stops.

Every request identifies itself as `SecurealyGrader/1.0 (+https://securealy.com/grader)`.

## Using it in CI

```
npx securealy grade https://your-app.com --min-grade B
```

exits 1 when the grade is below the minimum (default C), so a deploy step can gate on it. `--json` prints the full `GradeResult` described in [SPEC.md](SPEC.md).

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
```

## Development

```
npm install
npm run build
npm test            # vitest: a pass/fail fixture pair per check, scoring, redaction, opt-out
LIVE=1 npm test     # also grades https://example.com for real
npm run lint
```

New checks start in `checks.json`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
