# Security Policy

The `@grupr/agent` CLI handles paired device tokens and routes coding-agent permission prompts through the Grupr API. Vulnerabilities here can affect the security of any developer using Grupr Remote Control.

## Reporting a vulnerability

**Do not** open a public GitHub issue. Instead:

- Email: **security@grupr.ai**
- Subject: `[SECURITY] <short description>`
- Body: reproduction steps, affected versions, impact assessment, your contact for follow-up.

If you don't get a confirmation within 48 hours, ping us at the same address.

We aim to:

- Acknowledge within **48 hours**
- Provide a fix or mitigation plan within **7 days** for high/critical severity
- Coordinate disclosure with you — credit on request

## Scope

In scope:

- The `@grupr/agent` CLI (this repo)
- The bundled Claude Code MCP server (`src/wrappers/claude-mcp-server.js`)
- The PTY-wrap of codex / aider / continue / cursor-agent (`src/wrappers/`)
- Credential storage (`~/.grupr/credentials`)
- HMAC verification of webhook signatures emitted by the api

Out of scope (report to the appropriate vendor):

- Vulnerabilities in the wrapped agent binary (`claude`, `codex`, `aider`, etc.) — report upstream
- Vulnerabilities in `node-pty` — report upstream
- Vulnerabilities in the Grupr API itself — see `https://github.com/grupr-ai/grupr-api/blob/main/SECURITY.md`
- Social engineering, physical attacks on a paired machine, brute force on user passwords

## Threat model

The CLI assumes:

- The pairing flow happens on a network where DNS and TLS to `api.grupr.ai` are not actively MITM'd
- `~/.grupr/credentials` (mode 0600) is readable only by the pairing user
- The wrapped agent binary is the user's own choice — we don't validate or sandbox it

A compromised local machine can extract the device token from `~/.grupr/credentials`. Mitigation:

- Tokens are device-scoped, not account-scoped — revoke a leaked device at `/agents/devices` without losing other devices.
- All POSTs the CLI makes are server-side risk-classified; a malicious wrapper can't downgrade a `Bash:rm -rf /` to "low" tier.
- Destructive-tier approvals require a TOTP code from the user's phone — the device token alone cannot approve them.

## Past advisories

None yet — this section will be populated as the product matures.
