# @grupr/agent

Remote Control for AI coding agents. Pair your dev machine to your Grupr account and approve coding-agent actions from your phone, the web app, or inline within an active Grupr review.

## Install

```sh
npm install -g @grupr/agent
grupr agent pair
```

`npx @grupr/agent pair` also works on macOS/Linux if you'd rather skip the global install.

> **Windows:** prefer the global install above. `npx` can fail to launch the `grupr` binary for scoped packages whose bin name differs from the package name — you'll see `'grupr' is not recognized as an internal or external command`. `npm install -g @grupr/agent` then `grupr agent pair` works reliably.

## Commands

| Command | What it does |
|---|---|
| `grupr agent pair` | One-time pairing flow. Prints a 6-char code; you confirm on phone/web. |
| `grupr agent status` | Show paired device info + recent pending approvals. |
| `grupr agent test` | Send a synthetic approval to verify the round-trip. |
| `grupr agent claude [...]` | Wrap a Claude Code invocation — native MCP, no extra deps. |
| `grupr agent codex [...]` | Wrap OpenAI Codex CLI. **BETA**, needs `node-pty`. |
| `grupr agent aider [...]` | Wrap Aider. **BETA**, needs `node-pty`. |
| `grupr agent continue [...]` | Wrap Continue CLI. **BETA**, needs `node-pty`. |
| `grupr agent cursor [...]` | Wrap Cursor's `cursor-agent` CLI. **BETA**, needs `node-pty`. |
| `grupr agent logout` | Revoke this device's token + remove `~/.grupr/credentials`. |

Pass `--no-grupr` to any wrapper command to bypass the wrap for one run (useful during outages).

### Beta-wrapper one-time setup

The non-Claude wrappers use PTY interception to handle raw-mode `y/N` prompts. Install the optional native dep once:

```sh
npm install -g node-pty
```

Without it, those commands fall back to passthrough exec (no Grupr routing) and print a warning.

## How it works

```
┌─────────────┐   ┌────────────────┐    ┌──────────────┐    ┌──────────────┐
│ Claude Code │   │ @grupr/agent   │    │ Grupr API    │    │ Your phone   │
│ / Codex     │ → │ (this CLI)     │ → │ (relay + WS) │ → │ / web /      │
│ / Aider /   │   │ wrapped via    │    │              │    │ active grupr │
│ Continue /  │   │ MCP or PTY     │    │              │    │              │
│ cursor-agent│   │                │    │              │    │              │
└─────────────┘   └────────────────┘    └──────────────┘    └──────────────┘
                          ↑                     ↑                   │
                          │                     │                   │
                          └────── decision ←────┴─── tap Approve ←──┘
```

The agent stays local on your machine. Only the approval prompt + your decision flow through Grupr. **No code leaves your machine.** Destructive operations (rm -rf, sudo, dd, drop table, git push --force) require 2FA on every approve regardless of allowlist rules.

## Always-allow rules

Tired of re-approving the same `npm install` every time? When you approve a low/medium/high request, the dashboard offers an **Always allow ▾** picker with three scope options:

- **For this session** — auto-approves while your current agent session is alive (one Claude Code conversation, etc.)
- **For this device** — auto-approves on this paired machine across all sessions
- **Everywhere** — auto-approves across all your devices + sessions

Patterns support exact match (`Bash`), glob (`Edit*`, `*Read`), or POSIX regex (`^(npm|yarn)\s+install`). Destructive-tier requests never auto-approve regardless of allowlist rules.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `GRUPR_API_BASE` | `https://api.grupr.ai` | Override the api base URL (self-host / dev) |
| `GRUPR_DEBUG` | unset | Print stack traces on error + MCP server diagnostics on stderr |

## Status

**v0.1** — Pairing, full Claude Code MCP wrap, Codex/Aider/Continue/Cursor PTY wraps (BETA), allowlists with glob + regex, deny-with-reason + approve-with-note, edit-before-approve (web), bulk approve/deny, team-mode + delegation. Production launch ~2026-07.

Source: https://github.com/grupr-ai/agent
Docs: https://app.grupr.ai/agents/docs

## License

MIT
