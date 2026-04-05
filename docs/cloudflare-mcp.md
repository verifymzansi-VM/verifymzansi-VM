# Cloudflare MCP In VS Code

This workspace already includes Cloudflare MCP configuration for GitHub Copilot.
Use this guide to enable it in VS Code and validate it against the Cloudflare
resources defined in this repo.

## Config Files

- Workspace MCP server for VS Code/Copilot: `.vscode/mcp.json`
- Remote Cloudflare MCP endpoint reference: `.mcp.json`
- Cloudflare resource bindings for this app: `wrangler.toml`

For this repo, treat `.vscode/mcp.json` as the primary configuration for
VS Code/Copilot. Keep `.mcp.json` as the remote-endpoint reference for clients
that support direct remote MCP configuration.

## Current Workspace Configuration

The VS Code workspace MCP server is configured to start the official
Cloudflare server through `npx`:

```json
{
  "servers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@cloudflare/mcp-server-cloudflare", "run"]
    },
    "cloudflare-remote": {
      "type": "http",
      "url": "https://mcp.cloudflare.com/mcp"
    }
  }
}
```

The `run` subcommand is required for the local package-based server startup.
Without it, the package does not launch the MCP server process.

The repo also includes a remote Cloudflare MCP endpoint definition:

```json
{
  "mcpServers": {
    "cloudflare-api": {
      "url": "https://mcp.cloudflare.com/mcp"
    }
  }
}
```

For VS Code, use the remote server as `type: "http"`, not `type: "sse"`.
Cloudflare's hosted MCP endpoints use the current Streamable HTTP transport on
`/mcp`. A workspace entry that still points at `https://mcp.cloudflare.com/sse`
will fail with a 404.

## Resources In Scope

Validate MCP against the resources this repo already binds in `wrangler.toml`.

- R2 buckets: `verifymzansi-public`, `verifymzansi-private`
- KV namespace binding: `OTP_RATE_LIMITS`
- Durable Objects used by the OpenNext cache layer:
  `DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge`
- Main app deployment context: Cloudflare Workers / Pages via OpenNext

## Prerequisites

- VS Code with GitHub Copilot enabled
- Node.js and `npx` available locally
- A Cloudflare authentication method recognized by the MCP server
- Permission scopes limited to the resources you need to inspect or manage

If you use API-token authentication, keep the token least-privilege and start
with read-only verification where possible.

## Authentication Notes

The local package-based server can start by using existing Cloudflare
credentials available on the machine. In local validation for this workspace,
the server started successfully and reported that it had both an account ID and
API token available.

The package also exposes an `init` flow, but that path is not the primary setup
for this repo. In local inspection, `init` was oriented around existing
Wrangler authentication and a Claude Desktop install flow rather than VS Code
workspace MCP configuration.

For this workspace, prefer `.vscode/mcp.json` plus local Cloudflare auth over
using `init` as the source of truth.

Treat that as an environment fact, not a repo guarantee. On another machine,
the same startup may fail until Cloudflare authentication is configured.

If startup succeeds but resource queries fail, assume a permission mismatch
before assuming the MCP server itself is broken.

## Least-Privilege Guidance

For this repo, start with permissions only for the Cloudflare surfaces the app
actually uses.

- Workers and Pages visibility for the `verifymzansi` deployment
- R2 bucket access for `verifymzansi-public` and `verifymzansi-private`
- KV visibility for the namespace bound as `OTP_RATE_LIMITS`
- Worker configuration visibility related to Durable Objects and cache bindings

Add broader access only when there is a concrete operational need such as
observability, logs, or deployment inspection.

Recommended operating pattern:

1. Start with read-only access for discovery and inspection.
2. Validate that the MCP prompts you need can resolve the resources in this
  repo.
3. Expand permissions only when a specific write-capable workflow is approved.

## Least-Privilege Token Scope Baselines

When creating a Cloudflare API token for MCP operations in this repo, map the
token scope to the specific workflow instead of issuing one broad token for all
Cloudflare features.

Cloudflare permission labels can change in the dashboard over time, so treat
the categories below as the required capability baseline and choose the
narrowest matching permissions exposed by Cloudflare at token-creation time.

### Baseline Read-Only Token

Use this for normal Copilot discovery and validation prompts.

- Worker or Pages read access limited to the `verifymzansi` deployment
- R2 read access limited to `verifymzansi-public` and `verifymzansi-private`
- KV read access limited to the namespace bound as `OTP_RATE_LIMITS`
- Read access needed to inspect Worker bindings and Durable Object related
  configuration

This token should be enough for prompts such as listing the app's buckets,
finding the OTP KV namespace, inspecting Worker configuration, and verifying
that the Cloudflare resources in `wrangler.toml` exist.

### Optional Observability Token

Create a separate token if the workflow needs logs, analytics, or build
inspection rather than expanding the baseline token.

- Observability or analytics read access
- Build or deployment inspection read access if the workflow depends on Workers
  build information

Use this only for troubleshooting or operational review workflows.

### Change-Capable Token

Do not use a write-capable token for normal MCP usage. Create it only for a
reviewed maintenance workflow that explicitly needs mutations.

- Limit write access to the smallest relevant Cloudflare surface
- Prefer resource-specific scope over account-wide scope
- Expire or rotate the token after the maintenance task if it is not routinely
  needed

Examples of workflows that may justify a separate write-capable token:

- Intentional Workers or Pages configuration changes
- Bucket-level maintenance in the two repo-owned R2 buckets
- Explicit operational updates to KV-backed rate-limit configuration

### Token Design Rules

- Prefer separate tokens for read-only inspection and write-capable operations.
- Keep tokens environment-specific when possible instead of sharing one token
  across unrelated environments.
- Avoid granting unrelated Cloudflare products such as DNS, WAF, CASB, or AI
  Gateway access unless the workflow actually needs them.
- If a prompt unexpectedly fails with authorization errors, add only the
  missing capability instead of replacing the token with a broadly privileged
  one.

## Setup Flow

1. Open this workspace in VS Code.
2. Confirm `.vscode/mcp.json` is present and unchanged.
3. Use the VS Code MCP/Copilot integration to refresh or discover workspace MCP
   servers.
4. Confirm that the `cloudflare` server appears and starts without runtime
   errors.
5. Authenticate to Cloudflare if the MCP client prompts for it.
6. Run safe discovery prompts before attempting any write-capable action.

This workspace's startup form was validated locally with:

```bash
npx -y @cloudflare/mcp-server-cloudflare run
```

The validated startup indicated that the local environment already had usable
Cloudflare credentials. If a different machine does not, resolve auth first.

If you need to establish Cloudflare auth on a new machine, start by fixing the
local Cloudflare/Wrangler login state before editing workspace MCP files.

## Optional Remote Server References

If you use an MCP client that prefers direct remote servers, Cloudflare also
publishes service-specific remote endpoints. The most relevant ones for this
repo are:

- Workers bindings: `https://bindings.mcp.cloudflare.com/mcp`
- Workers builds: `https://builds.mcp.cloudflare.com/mcp`
- Observability: `https://observability.mcp.cloudflare.com/mcp`
- Documentation: `https://docs.mcp.cloudflare.com/mcp`

Keep the workspace-local VS Code setup on `.vscode/mcp.json`. Use these remote
endpoints only when the client and workflow actually benefit from them.

## Recommended Validation Prompts

Start with read-only prompts that map directly to this repo.

- `List my Cloudflare R2 buckets and check whether verifymzansi-public and verifymzansi-private exist.`
- `Inspect my Cloudflare KV namespaces and find the one bound as OTP_RATE_LIMITS in this repo.`
- `Show the Workers or Pages resources related to the verifymzansi deployment.`
- `Inspect Durable Object related Worker configuration for this workspace's cache layer.`
- `Summarize the Cloudflare resources this project depends on for storage, rate limiting, and caching.`

Only move on to mutating actions after read-only access is confirmed and the
required permissions are clear.

## Runtime Posture Check

This repo now includes an automated edge posture probe:

```bash
pnpm cloudflare:posture
pnpm cloudflare:posture:strict
pnpm cloudflare:posture:strict:zone
pnpm cloudflare:posture:json
```

What it checks:

- Root availability and cache directives
- Static asset cache headers (`immutable` / long max-age)
- `/api/health` status
- Cloudflare edge trace protocol and TLS version
- `www` hostname behavior
- DNS NS resolution and DNSSEC DS presence

Interpretation:

- `FAIL` means immediate action is required before release.
- `WARN` means degraded or suboptimal posture. Treat `Health endpoint`,
  `HSTS`, `DNSSEC DS record`, and `www hostname behavior` as launch-sensitive.
- `PASS` indicates expected baseline behavior.

Strict mode fails the command when runtime-critical warnings are present
(`Health endpoint`, `HSTS`).

Zone strict mode fails when zone governance warnings are present
(`DNSSEC DS record`, `www hostname behavior`) in addition to runtime-critical
warnings.

For the recommended Cloudflare WAF/rate-limit baseline, use:

- `docs/playbooks/cloudflare-edge-hardening-baseline.md`

## Troubleshooting Order

If the MCP server does not work, isolate the failing layer in this order.

1. VS Code MCP discovery does not show the workspace server.
2. `npx` cannot start `@cloudflare/mcp-server-cloudflare run`.
3. Cloudflare authentication is missing or expired.
4. The authenticated identity lacks the scopes needed for the requested tools.
5. The MCP client is reading a different config source than expected.

## Operational Notes

- Do not use MCP as a replacement for deploy validation already handled by the
  existing Wrangler and GitHub Actions flow.
- Prefer read-only inspection for production resources unless a change is
  intentional and reviewed.
- Keep this guide aligned with `wrangler.toml` when new Cloudflare bindings are
  added.
- If a contributor reports that Cloudflare MCP starts on one machine but not
  another, compare local Cloudflare auth state before editing workspace config.
