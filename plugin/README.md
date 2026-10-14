# Securealy plugin for Claude Code

Grades a freshly launched web app the way an attacker and a customer would see it, then walks through the fixes. Built for apps shipped with AI tools, where the code works but nobody has checked what it exposes.

## What it adds

- The `/securealy:launch-check` skill: asks for the preview or live URL and the repository, grades the URL, scans the repository for committed secrets and `.env` coverage, explains blockers in plain language, fetches the fix for each failing check, applies the fixes you approve, re-grades, and reports the before and after grade.
- The `securealy` MCP server, started with `npx -y securealy-mcp@0.1.4`, with these tools: `grade_url`, `scan_repo`, `check_rls`, `check_stripe`, `check_vercel_env`, `get_check`, `list_checks`, `fetch_fix`, `post_result`, and two resources, `securealy://checks` (the catalogue) and `securealy://spec` (the engine spec).

## Install

```
claude plugin marketplace add securealy/securealy
claude plugin install securealy@securealy
```

## What runs and what it sends

Everything runs on your machine through the published `securealy-mcp` npm package, which depends on `securealy-core` from the same repository.

- `grade_url` in the passive tier sends requests only to the URL being graded (what a browser would request, at most 25 requests) plus DNS, TLS and RDAP lookups for its domain. Nothing goes to Securealy. Every address it fetches must be public: loopback, link-local, private, CGNAT, unique-local, multicast and reserved addresses, and names such as `localhost`, `*.local` and `*.internal`, are refused on the input, on every redirect and on every URL found in a page.
- `grade_url` in the verified tier sends the URL and your project token to `https://securealy.com/api/grade`, because the probes it adds run on the hosted grader after you have proven you own the domain.
- `fetch_fix` sends a check id to `https://securealy.com/checks/<id>.json`.
- `post_result` sends a result and your project token to `https://securealy.com/api/results`, and only when you ask for it.
- `scan_repo` reads the folder you confirm, including its git history, and sends nothing anywhere. It may only read inside the server's working directory or a folder listed in `SECUREALY_SCAN_ROOTS`; git runs with its hooks and file monitor disabled so a repository cannot execute code during the scan.
- `check_rls`, `check_stripe` and `check_vercel_env` read credentials from the environment of the shell that started Claude Code, send each one only to the service it belongs to, and never print or transmit it anywhere else. These values are not sent to Securealy.

### Hosts contacted

- `grade_url`: the URL you give, the hosts it redirects to, the same-site URLs in the page (scripts, source maps, sitemap entries, links, images, `og:image`, the icon), the Supabase project URL found in a bundle, `firebasestorage.googleapis.com` when a Firebase bucket is named; your system DNS resolver plus `1.1.1.1` and `8.8.8.8` for the DNSSEC query; `rdap.org` and, for `.com` and `.net`, `rdap.verisign.com`.
- `check_rls`: `api.supabase.com` with a management token, or your Supabase project URL with the service key. The key is sent only to an https URL on a Supabase-hosted domain (the project URL Supabase issued); any other `SUPABASE_URL` skips the check unless `SECUREALY_SUPABASE_HOST_OVERRIDE=1` is set.
- `check_stripe`: `api.stripe.com`.
- `check_vercel_env`: `api.vercel.com`. Variable values are fetched only with `SECUREALY_VERCEL_DECRYPT=1`; without it only names and targets are read, and the trailing-newline and live-key checks are reported as skipped.
- `securealy.com`: the verified tier of `grade_url`, `fetch_fix`, `post_result`, and telemetry when you turn it on.

### Environment variables read

- `check_rls` (`rls-policies`, `supabase-auth-config`): `SUPABASE_MGMT_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SECUREALY_SIGNUP`, `SECUREALY_SUPABASE_HOST_OVERRIDE`.
- `check_stripe` (`stripe-webhook-wiring`): `STRIPE_SECRET_KEY`, and for the production host the first set of `SECUREALY_PRODUCTION_URL`, `PRODUCTION_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_URL`, `PUBLIC_SITE_URL`, `SITE_URL`, `APP_URL`, `VERCEL_PROJECT_PRODUCTION_URL` (the same list names the host in every local result).
- `check_vercel_env` (`vercel-env-hygiene`): `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `VERCEL_ORG_ID`, `SECUREALY_VERCEL_DECRYPT`, and the file `.vercel/project.json` in the working directory for the project and team ids.
- `scan_repo`: none; `SECUREALY_SCAN_ROOTS` decides which folders it may read.
- Every tool: `SECUREALY_NO_HISTORY`, `SECUREALY_TELEMETRY`.
- The redactor also learns, without using them, the value of every variable whose name looks secret and the password inside any variable that is a URL (`DATABASE_URL` and friends), so none of them can appear in an output.

Every tool output is passed through a redactor: secret-shaped strings and any credential value the server has seen are reduced to six characters and an ellipsis. The skill instructs Claude never to paste a secret into the chat or a file and to stop before any destructive or paid action.

## The learning record

Each `grade_url`, `scan_repo`, `check_rls`, `check_stripe` and `check_vercel_env` call appends one entry to `.securealy/history.json` in the server's working directory: time, command, tier, grade, score, the pass/fail counts, the ids of the failing checks, the result id and the engine version, plus the hostname for a grade of a URL. Never evidence, tokens or environment values. The newest 200 entries are kept and the file is safe to commit. The skill reads it before grading again so it can report which checks improved or regressed, and `grade_url` includes the same comparison line. Set `SECUREALY_NO_HISTORY=1` to turn it off.

Telemetry is off by default and never prompted for. With `SECUREALY_TELEMETRY=1` in the environment, each of those calls also sends one anonymous aggregate to `https://securealy.com/api/telemetry`: command, tier, grade, score, duration, request count, the pass/fail counts, the engine and Node versions, the detected stack kinds (hosting platform, builder, database, payments, framework) and the failing check ids. No URL, hostname, path, evidence, token or environment value. Fire and forget, three-second timeout, failures silent. The exact payload is documented in the repository README under "What leaves your machine".

Source, catalogue and tests: https://github.com/securealy/securealy. License: Apache-2.0.
