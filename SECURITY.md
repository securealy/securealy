# Security policy

## Reporting a vulnerability

Email **security@securealy.com**. Please include the steps to reproduce, the version or commit you tested, and what you believe the impact is. You will get an acknowledgement within two business days and a fix or a plan within fourteen.

Please do not open a public issue for a security problem until it has been fixed.

## Scope

This repository holds the grading engine, the check catalogue and the CLI. Reports we especially want:

- a check that can be made to crash, hang or exceed the request budget by a hostile site
- any path by which a secret (from a bundle, a repository, or an environment variable) could appear unredacted in a result, a log line or the terminal
- the passive tier doing anything beyond what SPEC.md allows against a site that has not verified ownership
- the opt-out (`_securealy` TXT record or `X-Securealy: optout` header) not being honored
- ownership verification that can be satisfied without controlling the domain

The hosted service at securealy.com lives in a separate private repository; reports about it go to the same address.

## What this code never does

- It never stores response bodies in results, only short evidence strings.
- It never prints, logs or transmits a credential. Environment variables are trimmed, used for the one API call they belong to, and dropped.
- The passive tier never probes `/.env`, `/.git`, admin routes, or reads rows with a key it finds; those probes run only in the verified tier after proof of ownership.
