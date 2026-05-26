# Contributing to @grupr/agent

Thanks for taking the time to contribute! This is the CLI half of [Grupr Remote Control](https://grupr.ai/agents) — it pairs your dev machine to a Grupr account and routes coding-agent permission prompts to your phone, web, or an active grupr.

## Filing issues

- **Bug reports**: include reproduction steps, your Node version (`node --version`), OS, the wrapped agent + its version (`claude --version` etc.), and what command you ran. Set `GRUPR_DEBUG=1` and paste the stderr output if you can.
- **Feature requests**: open an issue with a brief use case. We're especially interested in: new agent wrappers (currently shipping Claude Code + Codex + Aider + Continue + cursor-agent), prompt-pattern false-positives on the PTY-wrapped agents, and CLI ergonomics.
- **Security issues**: see `SECURITY.md` — do NOT file public issues for security vulnerabilities.

## Setting up a dev environment

```bash
git clone https://github.com/grupr-ai/agent.git
cd agent
# No build step — pure ESM JavaScript. Just run it:
node bin/grupr.js --help
```

You can point at a self-hosted Grupr api with `GRUPR_API_BASE=https://my-api.example.com`.

## Submitting a PR

1. Fork + branch from `main`. Branch name should be `feature/<short-name>` or `fix/<short-name>`.
2. Keep changes focused — one concern per PR.
3. **Test what you change.** Synthetic round-trip via `grupr agent test` proves the pipeline. Wrapper changes should ideally be tested against the real wrapped binary.
4. Follow the existing code style — no semicolons-vs-no debate, just match what's already there.
5. Update `README.md` if you add a user-facing command or option.
6. Open the PR against `main`. CI runs `node --check` on every source file; that passing is the bar.

## Adding a new wrapper

Most coding agents don't expose a permission-prompt hook (Claude Code is the exception). The PTY-wrap pattern in `src/wrappers/_pty-shared.js` handles the rest. To add a new agent:

1. Create `src/wrappers/<binary>.js` — a thin file that calls `runPTYWrappedAgent({binary, agentKind, sessionPrefix, patterns, args, betaCopy})`.
2. Choose an `agentKind` value the api recognizes. Currently: `claude_code`, `codex`, `aider`, `continue`, `cursor`, `generic`. New kinds need a backend migration (open an issue first).
3. Add tool-specific prompt patterns to your wrapper file. The `COMMON_PROMPT_PATTERNS` from `_pty-shared.js` is a fallback — agent-specific patterns should come first.
4. Wire the subcommand in `src/cli.js`.
5. Document in `README.md` + the help text.

## Licence

MIT — your contributions are covered under the same licence as the rest of the repo. By submitting a PR you confirm you have the right to license the code under MIT.
