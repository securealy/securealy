# Publishing

Every step here is run by the repository owner, in this order. Nothing in the repository holds a credential; each step authenticates on the owner's machine or through GitHub OIDC. Replace `kennyhyder/securealy` with `securealy/securealy` after the repository moves to the organization (the README, `plugin.json`, `marketplace.json`, `server.json` and the four `package.json` files all carry it).

## 0. Before the first release

```
npm run build && npm test && npm run lint && npm run smoke && npm run sweep
```

All five must be clean. `sweep` fails on any credential-shaped string or any hostname that is not securealy.com, a registry or a fixture.

## 1. npm: first publish by hand, then trusted publishing

Trusted publishing can only be configured on a package that already exists, so the first version of each package is published from the owner's machine. npm 11.5.1 or later and Node 22.14 or later are required for the OIDC flow; the manual publish works on Node 20.

```
npm login
npm run build && npm test
npm publish --workspace packages/checks --access public
npm publish --workspace packages/core --access public
npm publish --workspace packages/cli --access public
npm publish --workspace packages/mcp --access public
```

Then, for each of the four packages (`securealy-checks`, `securealy-core`, `securealy`, `securealy-mcp`), open npmjs.com, the package, **Settings**, **Trusted Publisher**, choose **GitHub Actions** and fill in:

| Field | Value |
|---|---|
| Organization or user | `kennyhyder` (later `securealy`) |
| Repository | `securealy` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

Under the same package settings, set **Publishing access** to the strictest option available (trusted publisher only, or two-factor required) so that no long-lived token can publish the package.

In the GitHub repository, create an environment named `npm` (**Settings**, **Environments**) and restrict it to the `main` branch and `v*` tags. `.github/workflows/release.yml` declares `permissions: contents: read, id-token: write`, uses no npm token, and npm attaches provenance attestations automatically for a public package published from a public repository through OIDC.

Every later release is a tag:

```
npm version 0.2.0 --workspaces --include-workspace-root --no-git-tag-version
# also bump: plugin/.claude-plugin/plugin.json, plugin/.mcp.json (the securealy-mcp@ pin),
# .claude-plugin/marketplace.json, server.json (both version fields), packages/action/action.yml (version default),
# packages/action/README.md and plugin/README.md (the version they quote),
# plugin/skills/launch-check/SKILL.md and skills/launch-check/SKILL.md (metadata.version)
npm test            # layout.test.ts fails if any of those disagree
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The CLI (`securealy`) and the server (`securealy-mcp`) always carry the tag version. `securealy-checks` and `securealy-core` keep their own version when nothing in them changed (bump only those two workspaces: `npm version 0.2.0 --workspace packages/checks --workspace packages/core --no-git-tag-version`, then update the exact pins in `packages/core`, `packages/cli` and `packages/mcp`). The release workflow publishes a package only when its version equals the tag, so an unchanged engine is never republished. `securealy-mcp` depends on `securealy` at the same version for the shared run record.

## 2. MCP Registry (`com.securealy/mcp`)

`server.json` at the repository root is the registry record, and `packages/mcp/package.json` carries `"mcpName": "com.securealy/mcp"`, which the registry checks against the published npm package. The namespace is domain-based, so authentication is a DNS TXT record on `securealy.com`.

Install the publisher:

```
brew install mcp-publisher
# or
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

Generate a key, outside the repository, and print the TXT record:

```
cd ~/.config/securealy && openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem
PUBLIC_KEY="$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "securealy.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record at the apex of `securealy.com` in the DNS provider, wait for it to propagate, then from the repository root:

```
PRIVATE_KEY="$(openssl pkey -in ~/.config/securealy/mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain securealy.com --private-key "${PRIVATE_KEY}"
mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.securealy/mcp"
```

The npm package must already be published at the version `server.json` names. To automate this on later tags, add a `MCP_PRIVATE_KEY` repository secret holding the hex private key and append to `release.yml`:

```yaml
      - name: Install mcp-publisher
        run: curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz" | tar xz mcp-publisher
      - run: ./mcp-publisher login dns --domain securealy.com --private-key ${{ secrets.MCP_PRIVATE_KEY }}
      - run: ./mcp-publisher publish
```

## 3. Claude Code plugin and the Anthropic directory

The marketplace is already live once the repository is public:

```
claude plugin validate ./plugin
claude plugin validate .
claude plugin marketplace add kennyhyder/securealy
claude plugin install securealy@securealy
```

To list it in the directory, open https://claude.ai/directory/manage from a Pro, Max, Team or Enterprise account, connect GitHub, select **Submit new**, then **Plugin bundle**, and enter:

| Field | Value |
|---|---|
| Repository | `kennyhyder/securealy` (later `securealy/securealy`) |
| Plugin path | `plugin` |
| Branch or tag | leave empty to follow `main`, or the release tag |

Select **Validate**. The pre-submission checks require the `npx` launcher in `plugin/.mcp.json` to be pinned to an exact version (it is), a README of at least 40 words in the plugin folder (`plugin/README.md`), and a license (`license` in `plugin.json`). Two findings are expected and are held for a reviewer rather than blocking: **Runs a pinned npx package** (the server comes from npm) and **Uses a credential from the user's machine** (the local checks read `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_KEY`, `VERCEL_TOKEN` from the environment and send each one only to its own service). Both are disclosed in `plugin/README.md`.

On the **Data handling** step, answer truthfully:

| Question | Answer |
|---|---|
| Does the plugin read or store personal data? | No. It reads the URL the user asks to grade and the repository folder the user confirms. It stores a local run record (`.securealy/history.json` in the working directory: grade, score, counts, failing check ids and the graded hostname; never evidence or credentials), which `SECUREALY_NO_HISTORY=1` turns off. |
| Does it send data to services other than its declared connectors? | Yes, with disclosure: `grade_url` sends HTTP requests to the URL being graded and DNS, TLS and RDAP lookups for its domain; the verified tier sends the URL and the project token to securealy.com; `fetch_fix` sends a check id to securealy.com; `post_result` sends a result and the token to securealy.com only when the user asks. The local checks send credentials only to Supabase, Stripe and Vercel respectively. Nothing from `scan_repo` leaves the machine. Only if the user sets `SECUREALY_TELEMETRY=1` (off by default, never prompted) does each run also send an anonymous aggregate (command, grade, counts, stack kinds, failing check ids; no URL, host or evidence) to securealy.com. |
| How long is data kept? | The plugin keeps the local run record until the user deletes the file. Results posted with `post_result` are kept by securealy.com under the user's project until the user deletes them. |
| Intended for people under 18? | No. |

On **Compliance**, confirm the contact email and the four acknowledgements, then **Submit for review**. Keep **GitHub push webhook** so each commit to `main` is scanned as a new version. Raise `version` in `plugin/.claude-plugin/plugin.json` with every release.

The hosted grader at securealy.com is not a remote MCP server, so there is no separate **MCP connector** submission.

## 4. Cursor

The one-click link is in the README. It is built as `cursor://anysphere.cursor-deeplink/mcp/install?name=securealy&config=<base64>` where `<base64>` encodes `{"command":"npx","args":["-y","securealy-mcp"]}`. Regenerate it with:

```
node -e 'console.log("cursor://anysphere.cursor-deeplink/mcp/install?name=securealy&config="+Buffer.from(JSON.stringify({command:"npx",args:["-y","securealy-mcp"]})).toString("base64"))'
```

Cursor also lists servers from the official MCP Registry, so step 2 covers its marketplace.

## 5. VS Code

The install link is `vscode:mcp/install?` followed by the URL-encoded JSON `{"name":"securealy","command":"npx","args":["-y","securealy-mcp"]}` (and `vscode-insiders:mcp/install?` for Insiders). Regenerate with:

```
node -e 'console.log("vscode:mcp/install?"+encodeURIComponent(JSON.stringify({name:"securealy",command:"npx",args:["-y","securealy-mcp"]})))'
```

From the command line: `code --add-mcp '{"name":"securealy","command":"npx","args":["-y","securealy-mcp"]}'`.

## 6. Smithery

Open https://smithery.ai/new, sign in with GitHub, and add the server. Smithery accepts remote URL servers and local servers packaged as an MCPB bundle; for this stdio server, point the listing at the npm package `securealy-mcp` and the repository, or publish a bundle with `smithery mcp publish ./securealy-mcp.mcpb -n securealy/securealy-mcp` once one is built. Smithery also ingests the official MCP Registry, so step 2 is enough for discovery.

## 7. Glama

Open https://glama.ai/mcp/servers and use **Add server** with the repository URL, then claim it with the GitHub account that owns the repository. Optionally commit a `glama.json` at the root:

```json
{ "$schema": "https://glama.ai/mcp/schemas/server.json", "maintainers": ["kennyhyder"] }
```

## 8. GitHub Action

The Action is referenced by path and tag: `uses: kennyhyder/securealy/packages/action@v0.1.0`. Each release tag makes a new version usable. To list it on the GitHub Marketplace the action must live at the root of its own repository, so that step is optional and needs a separate `securealy/action` repository that copies `packages/action`.

## 9. Repository move

After moving to the `securealy` organization: replace `kennyhyder/securealy` everywhere (`grep -rn kennyhyder --exclude-dir=node_modules --exclude-dir=.git .`), update the trusted publisher entries on npm to the new organization, update the directory submission's repository (a new submission is needed; the old one can be delisted), and tell marketplace users to run `claude plugin marketplace add securealy/securealy`. The `com.securealy/mcp` registry name does not change because it is tied to the domain, not the repository.
