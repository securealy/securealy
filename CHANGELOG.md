# Changelog

## 0.1.2

The learning record. `securealy` and `securealy-mcp` only; `securealy-core` and `securealy-checks` stay at 0.1.1.

- Every `grade`, `local`, `scan-repo`, `check-rls`, `check-stripe` and `check-vercel-env` run, and every `grade_url`, `scan_repo`, `check_rls`, `check_stripe` and `check_vercel_env` call, appends one entry to `.securealy/history.json` in the working directory: time, command, tier, grade, score, counts, failing check ids, result id, engine version, and the hostname for a URL grade. Never evidence, tokens or environment values; the serialised entry is passed through the engine's redactor as well. Newest 200 kept; a README is written beside it once; the folder is created, and an unwritable folder is skipped silently. `--no-history` and `SECUREALY_NO_HISTORY=1` turn it off.
- `grade` (CLI) and `grade_url` (MCP) print one line against the previous entry for the same host: `Previous grade B 83 on 2026-10-12; 2 checks improved, 1 regressed: not-found-page`.
- Opt-in telemetry, off by default and never prompted for: with `SECUREALY_TELEMETRY=1`, each of those runs POSTs an aggregate (command, tier, grade, score, duration, requests, counts, engine and Node versions, detected stack kinds, failing check ids) to `https://securealy.com/api/telemetry`. No URL, host, path, evidence or token. Fire and forget, three-second timeout, failures silent. The exact payload is in the README under "What leaves your machine".
- The launch-check skill reads `.securealy/history.json` first and reports the trend before grading again.
- `securealy-mcp` depends on `securealy` for the shared record module (`securealy/record`). The CLI user agent now follows the package version.
- Release workflow publishes only the packages whose version matches the tag, so an unchanged engine is never republished; the layout test checks the exact pins between packages instead of one shared version.

## 0.1.1

Pre-launch false-positive review of the passive grader, graded against twenty live sites. Every class below is fixed in the engine with a regression test; fixtures regenerated.

- Analytics detection matches the vendor's script host or inline bootstrap (gtag config, GTM container, posthog.init, plausible data-domain), never a bare identifier. A first-party script guarding `window.gtag`, or a link to `/gtm-template`, no longer counts as a tag. A preconnect to a tag host with no tag is a warn. `consent-mechanism` follows.
- Builder and database detection need an artifact (badge, asset host, project URL, client library), not a mention of the product.
- DKIM: 24 selectors queried. A miss on all of them fails only when SPF names a provider with fixed selectors; otherwise it is a warn naming what was tried. A domain publishing `v=spf1 -all` with no or a null MX skips the sending-side checks; a null MX is a warn, not a fail.
- robots.txt is parsed into groups: a `Disallow: /` for one named bot no longer reads as blocking every crawler.
- cookie-flags judges session-like cookies; analytics cookies read by client scripts (`ajs_`, `_ga`, `ph_` and friends) are not held to HttpOnly, and a preference cookie without Secure is a warn.
- cors-wildcard-credentials skips when no CORS header was seen instead of passing on nothing.
- legal-pages reads `rel="privacy-policy"` and `rel="terms-of-service"`, treats a `/legal` hub as a warn, and skips on a client-rendered shell with no links.
- llms-txt and ai-crawler-policy report warn, and ai-crawler-policy skips when there is no robots.txt (already the robots-txt finding).
- source-maps ignores a `.map` URL that answers 200 with the SPA fallback page.
- og-image treats 401 and 403 to the grader as a warn and parses `1200px` dimensions.
- not-found-page names a client-rendered 404 behind a 200.
- ttfb between 800 and 1600 ms is a warn (one cold sample from one vantage point).
- Secret scanning ignores documentation placeholders (one repeated character, `xxxx`, `YOUR_`, `EXAMPLE`).
- Fetcher: a HEAD answered 405 or 501 is retried once as GET (some Python and proxy origins refuse HEAD). RDAP: a 404 straight from rdap.org means no RDAP server is listed for the TLD (`.me`, `.io`, `.sh`) and the expiry check skips; only a registry 404 means unregistered. A Vercel or Cloudflare bot challenge is named in the evidence of every page check it blocks.
- Repo sweep allows the builder product domains the engine names; MCP tool descriptions use `.example` hosts.

## 0.1.0

First public release: catalogue, engine, CLI, MCP server, Claude Code plugin, GitHub Action.
