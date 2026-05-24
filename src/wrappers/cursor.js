// `grupr agent cursor [...args]` — wraps Cursor's `cursor-agent` CLI.
// BETA: see _pty-shared.js for the architecture + caveats.
//
// Cursor's IDE itself is closed and has no agent-hook API. The
// `cursor-agent` CLI mode is the only intercept point we have; this
// wrapper targets that, not the IDE.
import { runPTYWrappedAgent, COMMON_PROMPT_PATTERNS } from './_pty-shared.js';

export async function runCursor(args) {
  return runPTYWrappedAgent({
    binary: 'cursor-agent',
    agentKind: 'cursor',
    sessionPrefix: 'cu-',
    patterns: COMMON_PROMPT_PATTERNS,
    args,
    betaCopy: 'grupr: cursor-agent wrap (BETA) — approvals routing through Grupr Remote Control.',
  });
}
