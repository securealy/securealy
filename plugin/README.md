# Securealy plugin for Claude Code

Grades a freshly launched web app the way an attacker and a customer would see it, then walks through the fixes. Built for apps shipped with AI tools, where the code works but nobody has checked what it exposes.

## What it adds

- The `/securealy:launch-check` skill: asks for the preview or live URL and the repository, grades the URL, scans the repository for committed secrets and `.env` coverage, explains blockers in plain language, fetches the fix for each failing check, applies the fixes you approve, re-grades, and reports the before and after grade.
- The `securealy` MCP server, started with `npx -y securealy-mcp@0.1.0`, with these tools: `grade_url`, `scan_repo`, `check_rls`, `check_stripe`, `check_vercel_env`, `get_check`, `list_checks`, `fetch_fix`, `post_result`, and two resources, `securealy://checks` (the catalogue) and `securealy://spec` (the engine spec).

## Install

```
claude plugin marketplace add kennyhyder/securealy
claude plugin install securealy@securealy
```

## What runs and what it sends

Everything runs on your machine through the published `securealy-mcp` npm package, which depends on `securealy-core` from the same repository.

- `grade_url` in the passive tier sends requests only to the URL being graded (what a browser would request, at most 25 requests) plus DNS, TLS and RDAP lookups for its domain. Nothing goes to Securealy.
- `grade_url` in the verified tier sends the URL and your project token to `https://securealy.com/api/grade`, because the probes it adds run on the hosted grader after you have proven you own the domain.
- `fetch_fix` sends a check id to `https://securealy.com/checks/<id>.json`.
- `post_result` sends a result and your project token to `https://securealy.com/api/results`, and only when you ask for it.
- `scan_repo` reads the folder you confirm, including its git history, and sends nothing anywhere.
- `check_rls`, `check_stripe` and `check_vercel_env` read `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_PROJECT_REF`, `STRIPE_SECRET_KEY`, `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` from the environment of the shell that started Claude Code, send each one only to the service it belongs to, and never print or transmit it anywhere else. These values are not sent to Securealy.

Every tool output is passed through a redactor: secret-shaped strings and any credential value the server has seen are reduced to six characters and an ellipsis. The skill instructs Claude never to paste a secret into the chat or a file and to stop before any destructive or paid action.

Source, catalogue and tests: https://github.com/kennyhyder/securealy. License: Apache-2.0.
