# Changelog

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
