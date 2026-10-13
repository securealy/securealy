---
name: launch-check
description: Pre-launch check for a web app built with an AI tool. Grades the live or preview URL the way an attacker and a customer would see it, scans the repo for committed secrets and .env coverage, explains blockers in plain language, fetches the fix for each failing check and applies the ones the user approves, then re-grades and reports before and after. Use when the user says they are about to launch, ship, deploy, go live, make public, or asks whether their app is safe, secure or ready.
license: Apache-2.0
compatibility: Needs the securealy MCP server (bundled with this plugin, run with npx) and network access to the URL being graded.
metadata:
  author: securealy
  version: "0.1.0"
---

# Launch check

You are running a launch check with Securealy. The tools come from the `securealy` MCP server: `grade_url`, `scan_repo`, `check_rls`, `check_stripe`, `check_vercel_env`, `get_check`, `list_checks`, `fetch_fix`, `post_result`.

## Rules that hold for the whole session

- Never paste a secret into the chat, a file, a commit or a command line. Not an API key, not a token, not a database password, not even "to check it". If a check needs a credential, tell the user which environment variable to export in the shell that runs the MCP server and re-run the check. Tool output is redacted; keep it that way.
- Stop and ask before any destructive or paid action: rotating or revoking a key, deleting data, changing DNS, changing a Stripe or Supabase setting, buying a domain or plan, force-pushing, or posting results with `post_result`. Read-only checks and local edits to the user's code are fine.
- Never run the verified tier against a domain the user does not own. Passive is fine on any URL.
- Fix the class, not the instance. If one route is missing a header, fix the layer that sets headers for every route.

## Steps

1. Ask what they built and where it is, if you do not already know: the preview or live URL and the path to the repository. If the app is still only local, say that `grade_url` needs a reachable URL and offer `scan_repo` meanwhile.

2. Run `grade_url` on the URL (passive tier). If the host has opted out, stop and say so. If the deployment is protected by Vercel, ask for the protection bypass token to be passed as `bypassToken` (it goes only to that host).

3. Run `scan_repo` on the repository path. The first call returns a trust request; show the user the absolute path, confirm it is their project, then call again with `trust: true`.

4. If the stack uses Supabase, Stripe or Vercel and the user has exported the relevant variables, run `check_rls`, `check_stripe` (pass the production host) and `check_vercel_env`. Skipped checks tell you which variable is missing; relay that, do not ask for the value.

5. Read the results. Report the grade line first (grade, score, cap if any), then the blockers in plain language: what an attacker or a customer would actually experience, not the check id. Then the rest grouped by category, worst first. Keep passing checks to one line.

6. For every failing or warning check, call `get_check` for the meaning and `fetch_fix` for the fix. If the fix is not published yet, give the fix page URL and your own fix from the catalogue entry.

7. Propose the fixes as a short list and ask which to apply. Apply the approved ones in the codebase, smallest safe change first, and say exactly which files changed. Where the fix lives outside the code (a DNS record, a Stripe webhook, a Supabase setting, an environment variable), give the exact value to set and where, and let the user do it.

8. Once the user has deployed the changes, run `grade_url` again on the same URL and `scan_repo` again if the repo changed.

9. Finish with one before/after line, for example `Grade D (58) -> Grade B (81), 2 blockers -> 0`, then what is still open and the single next action.

## Reading a result

- `blocker` fails cap the grade: one caps at D, two or more at F. They come first every time.
- `warn` means the finding is real but partial or low confidence. Say so.
- `skip` means not applicable or missing input, with the reason in the evidence. Do not count it as a pass.
- `error` means the check could not run. Mention it once; do not retry in a loop.
- Evidence is a short string with secrets reduced to six characters. That is all the detail there is; do not try to reconstruct a value.

## What leaves the machine

`grade_url` passive sends requests only to the URL being graded, plus DNS, TLS and RDAP lookups for its domain. `grade_url` verified sends the URL and the project token to securealy.com. `fetch_fix` sends a check id to securealy.com. `post_result` sends a result and the token to securealy.com, and only when the user asks. The local checks send credentials only to the service they belong to (Supabase, Stripe, Vercel) and nothing to Securealy.
