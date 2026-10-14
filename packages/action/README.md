# Securealy GitHub Action

Grades a URL with `npx securealy grade <url> --json --min-grade <grade>`, writes a job summary with the grade stamp and a table of failing checks, uploads the `GradeResult` JSON as an artifact, and fails the job when the grade is below `min-grade` (default C).

## Usage

```yaml
name: Launch grade
on:
  deployment_status:
  workflow_dispatch:
    inputs:
      url:
        description: URL to grade
        required: true

permissions:
  contents: read

jobs:
  grade:
    if: github.event_name == 'workflow_dispatch' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      - uses: securealy/securealy/packages/action@v0.1.0
        with:
          url: ${{ inputs.url || github.event.deployment_status.target_url }}
          min-grade: B
```

For the verified tier, after proving ownership of the domain at securealy.com:

```yaml
      - uses: securealy/securealy/packages/action@v0.1.0
        with:
          url: https://your-app.com
          tier: verified
          token: ${{ secrets.SECUREALY_TOKEN }}
          min-grade: B
```

For a Vercel preview with deployment protection, add `bypass-token: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}`. It is sent only to the graded host.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `url` | required | The URL to grade |
| `min-grade` | `C` | Fail below this letter |
| `tier` | `passive` | `passive` or `verified` |
| `token` | | Project token, needed for `verified` |
| `bypass-token` | | Vercel protection bypass token |
| `version` | `0.1.3` | `securealy` CLI version run through npx. Caller-controlled: set it only from your own workflow file, never from an event payload |
| `artifact-name` | `securealy-grade` | Name of the uploaded JSON artifact |

## Outputs

`grade`, `score`, `passed` and `result-path`.

## What leaves the runner

The passive tier sends requests only to the URL being graded plus DNS, TLS and RDAP lookups for its domain. The verified tier also sends the URL and the token to securealy.com. Nothing else is sent anywhere. The token and the bypass token reach the CLI as the `SECUREALY_TOKEN` and `SECUREALY_BYPASS` environment variables, never as command-line arguments, and travel to their destination in a header; neither is printed.
