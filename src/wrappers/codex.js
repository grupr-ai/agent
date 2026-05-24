// `grupr agent codex [...args]` — wraps OpenAI's Codex CLI.
// BETA: see _pty-shared.js for the architecture + caveats.
import { runPTYWrappedAgent, COMMON_PROMPT_PATTERNS } from './_pty-shared.js';

export async function runCodex(args) {
  return runPTYWrappedAgent({
    binary: 'codex',
    agentKind: 'codex',
    sessionPrefix: 'cx-',
    // Codex-specific patterns could go here; for v1 we use the common
    // y/N matchers. Refine once we see real Codex prompts.
    patterns: COMMON_PROMPT_PATTERNS,
    args,
    betaCopy: 'grupr: codex wrap (BETA) — approvals routing through Grupr Remote Control.',
  });
}
