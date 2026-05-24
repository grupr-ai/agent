// Stub for the Claude Code wrapper. Week 2-3 builds this out using
// Claude Code's --permission-prompt-tool flag + an MCP server that
// forwards permission checks through Grupr.
//
// For Week 1 the CLI surfaces this command but it just prints the
// "coming in v1" message — the round-trip plumbing (`grupr agent test`)
// is what proves the pipeline works end-to-end this week.
export async function runClaude(_args) {
  process.stdout.write(
    [
      'grupr agent claude — Claude Code wrapper',
      '',
      'This command will wrap a `claude` invocation so every permission',
      'prompt routes through Grupr to your phone/web/active grupr.',
      '',
      'Coming in Week 2 of the launch sprint. The pipeline IS already',
      'working end-to-end — try `grupr agent test` to fire a synthetic',
      'approval and verify your pairing.',
      '',
    ].join('\n'),
  );
}
