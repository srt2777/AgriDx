# Main tool loop (AGENT_LOOP=main)

> Status 2026-11-10: the awaited main loop was **removed from the answer
> path** for latency. `AGENT_LOOP=main` now behaves like `off`: the answer
> comes from the single `llm.chat()` call. Tool use continues only as the
> post-answer shadow loop (`AGENT_LOOP=shadow`). This file records what
> the loop was, why it was removed, and what remains.

## Why it was removed

Production traces (2026-11-10, same question, six runs against
`https://agridx.xyz/api/chat`) showed the awaited loop hitting its 8 s
wall-clock deadline in 5 of 6 turns: answering needs at least two
sequential LLM generations (a tool-call round, ~1 s, plus a full answer
round, ~6–7 s), but the budget was 8 s. The loop burned ~8 s, then the
service ran a second full generation anyway, so server time was ~16 s
instead of ~8 s (retrieval <50 ms, routing <2 ms). The one turn where
the loop finished inside budget took 7.1 s total — the same as the
single-call path it fell back to. The single call already carries the
same retrieved chunks, Planner questions and memory, so removing the
awaited loop does not change the answer source.

## Switch (current)

- `AGENT_LOOP=main`: no loop runs; the answer path is the single
  `llm.chat()` call. Kept as a value so existing production config does
  not break; it is documented as deprecated in
  `server/diagnosis/config.ts`.
- `AGENT_LOOP=shadow`: the tool loop runs after the ordinary answer is
  final, in the background, and never changes the answer (see below).
- Anything else (including no `process.env`, as in the browser preview)
  is `off`.

## What remains: the shadow loop

- `runAgent` with `buildContextRegistry(memory)`: brand, model and
  device come from the host, never from the model.
- Allowlist: the read-only `TOOL_LOOP_TOOLS` in
  `server/diagnosis/service.ts`. The loop is bound by the
  host-supplied device scope and may never write, execute repairs or
  choose a device.
- Budget: at most 4 steps (the runner enforces a hard cap of 6), 8
  seconds wall-clock, at most 4 tool calls per step, last step forces a
  tool-free summary. The runner first resolves the machine scope; a
  scope conflict falls back immediately.
- It starts only after the ordinary answer is final
  (`agentLoop === 'shadow'` and `coordination.route === 'ai'`), is
  never awaited, and cannot delay, replace or bypass the coordinated
  answer and answerGuard. At most 4 shadow runs in flight; extra turns
  are skipped with a warning.
- Observability: a one-line desensitised server log (`[agent-shadow]`,
  provider/status/duration/tool names only). Tool events never contain
  arguments, output text or credentials.

## Trace field

`diagnosisTrace.mainLoop` stays in the response so the trace shape is
unchanged, but now always reports `enabled: false, ran: false,
status: null, reason: null, toolSteps: 0, toolEvents: []`.

## DSML tool-call translation (DeepSeek V4 Flash)

DeepSeek V4 Flash models natively emit tool calls as DSML text
(`<｜DSML｜tool_calls>` / `<｜DSML｜invoke>` / `<｜DSML｜parameter>` blocks,
including the V4.1 spaced variant and ASCII-pipe spellings), not as
OpenAI structured `tool_calls`, unless the serving stack converts them.
When it does not, a turn that intended a tool call arrives as plain
content. Two layers handle it, implemented in `agent/dsml.ts`:

- Provider layer (`server/llm/openai-compatible.ts`): a well-formed DSML
  block with no structured calls is translated into structured calls
  (at most 4, names validated, `string="false"` parameters parsed as
  JSON) and the markup is removed from the assistant content, so the
  loop executes the intended call instead of leaking the markup or
  failing as an invalid response. A malformed DSML block is stripped,
  never half-executed: the remaining text is then validated by the usual
  rules below.
- Runner layer (`agent/runner.ts`): any DSML text still present in a
  final answer or question is stripped before the guard runs, and a
  reply that was only a DSML block is rejected (`answer_rejected`) so
  the service falls back to the single-call path. DSML text in an
  assistant message that carries structured calls is likewise stripped.
- The answer guard's safety/source veto rules are unchanged: stripping
  happens before the guard, so a stripped answer still has to pass the
  same guard to be shown, and stripping never removes a safety
  condition from a paragraph.

## Client send failures (not a server error path)

A browser `Failed to fetch` is a transport failure (connection reset /
network interruption), not an application error: an HTTP error from the
server arrives as a structured error response instead. The chat send
logic (`src/features/chat/useChatSession.ts`, classification in
`src/features/chat/session.ts`) now reports the real kind — 60 s client
timeout, transport interruption, or malformed server response —
instead of the same generic row plus a raw browser error string, and it
keeps the draft for an explicit manual retry. There is deliberately no
automatic retry: the request is not idempotent (the server appends the
turn before responding), so retrying automatically after a lost
response could silently duplicate the turn.

## Boundaries that do not change

- No write tools, no repair execution, no telemetry simulation as a tool.
- Tool results are not verified facts: a tool result can only become a
  citation after the existing trusted-evidence filter (exact match,
  indexed source, verified review) and the answer guard.
- DiagnosisRouter rules and thresholds, answerGuard veto rules, retrieval
  topK and weights, and Planner templates and evidence gates are
  untouched by this change.
- Evaluation scores are never written back into diagnostic memory.
