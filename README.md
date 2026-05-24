# @grupr/agent

Remote Control for AI coding agents. Pair your dev machine to your Grupr account and approve coding-agent actions from your phone, the web app, or inline within an active Grupr review.

## Install

```sh
npx @grupr/agent pair
```

That's it for first-time setup — no global install required.

## Commands

| Command | What it does |
|---|---|
| `grupr agent pair` | One-time pairing flow. Prints a code; you confirm on phone/web. |
| `grupr agent status` | Show paired device info. |
| `grupr agent test` | Send a synthetic approval to verify the round-trip. |
| `grupr agent claude [...]` | Wrap a Claude Code invocation. (Week 2+) |
| `grupr agent logout` | Remove local credentials. |

## Environment

| Variable | Default | What it does |
|---|---|---|
| `GRUPR_API_BASE` | `https://api.grupr.ai` | Override the api base URL (self-host / dev) |
| `GRUPR_DEBUG` | unset | Print stack traces on error |

## How it works

```
Coding agent on your laptop → @grupr/agent wrapper → Grupr API → your phone
                                                                 ↓
                          ← decision ← Grupr API ← Approve tap ←┘
```

The agent stays local — only the approval prompt + your decision flow through Grupr. No code leaves your machine.

## Status

**Alpha.** Pairing + synthetic approvals work today (Week 1 of the launch build). Claude Code + Codex wrappers ship Week 2-4. Production launch ~2026-06-29.

## License

MIT
