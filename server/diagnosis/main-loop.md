# Main tool loop (AGENT_LOOP=main)

This is the awaited Tool Use loop in the main diagnosis chain. It is not the
shadow loop, and it does not replace the safety or routing rules.

## Switch

- `AGENT_LOOP=main` enables the main loop; `AGENT_LOOP=shadow` keeps the old
  post-answer shadow behaviour; anything else (including no `process.env`,
  as in the browser preview) is `off`.
- Main and shadow never run on the same answer: the service only starts
  shadow when `agentLoop === 'shadow'` and only attempts the main loop when
  `agentLoop === 'main'`.

## Trigger conditions (all required, otherwise the old path runs unchanged)

1. `coordination.route === 'ai'` — local, clarify and safe routes never run
   the loop and never call a tool provider.
2. External AI is allowed — not `knowledge_only`, not
   `ALLOW_EXTERNAL_AI=false`.
3. No Planner restriction or stop — if the Planner vetoed, paused or
   escalated this turn, the loop does not run.
4. `llm.toolProvider()` returns a configured provider with `chatWithTools`
   (today only the OpenAI-compatible provider, i.e. DeepSeek; Gemini does
   not expose tool calls). If it returns null, the single `llm.chat()` path
   runs instead.

## What runs

- `runAgent` with `buildContextRegistry(memory)`: brand, model and device
  come from the host, never from the model.
- Allowlist: the same read-only allowlist as shadow (see
  `TOOL_LOOP_TOOLS` in `server/diagnosis/service.ts`), because the main
  loop differs from shadow only in being awaited and in replacing the AI
  supplement, never in tool permissions. When the Planner already supplied
  this turn's question, `ask_user_for_info` is removed from the allowlist
  so the loop only gathers evidence and never asks a second question.
- Budget: at most 4 steps (the runner enforces a hard cap of 6), 8 seconds
  wall-clock, at most 4 tool calls per step, last step forces a
  tool-free summary. The runner first resolves the machine scope; a scope
  conflict falls back immediately.
- Prompt: the same system message and history as the single AI path
  (including the Planner-question note when the Planner supplied one),
  plus the runner's own scope message. The guard is the same
  `filterDiagnosticAnswer` with the same trusted evidence ids and model.

## Result integration and fallback chain

- `answered`: the loop content becomes `aiSupplement`, with the same
  understanding rewrite, question clearing, 16000-character cap and
  rendering as the single AI path. Local facts are built the same way.
- `question`: only reachable when the Planner did not already ask, because
  then `ask_user_for_info` is excluded. The question becomes this turn's
  `diagnosticReply.questions`; local facts are unchanged.
- `fallback` (tool error, disallowed tool, guard rejection, timeout
  without an abort, empty content): the service continues to the existing
  single `llm.chat()` path. Only if that also fails does the local
  fallback run. The main loop never returns unfiltered content.
- `cancelled` with an aborted request signal: no single call is attempted;
  the service returns the existing local fallback. `cancelled` without an
  abort is treated as `fallback`.

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
  never half-executed; if nothing remains, the usual missing-content
  error makes the loop fall back safely.
- Runner layer (`agent/runner.ts`): any DSML text still present in a
  final answer or question is stripped before the guard runs, and a
  reply that was only a DSML block is rejected (`answer_rejected`) so
  the service falls back to the single-call path. DSML text in an
  assistant message that carries structured calls is likewise stripped.
- The answer guard's safety/source veto rules are unchanged: stripping
  happens before the guard, so a stripped answer still has to pass the
  same guard to be shown, and stripping never removes a safety
  condition from a paragraph.

## Observability

`diagnosisTrace.mainLoop` records `enabled`, `ran`, `status`
(`answered` | `question` | `fallback` | `cancelled` | null),
`reason` (the runner's desensitised fallback/cancel reason, null
otherwise — added because production traces previously showed only a
fallback count, which cannot distinguish a deadline, a guard rejection,
a DSML/provider error or a scope failure),
`toolSteps` (desensitised tool event count) and `toolEvents` (step, tool,
ok, error type, duration, source label only). It never contains tool
arguments, tool output text or credentials, and it is not written into
`knowledgeSources` or the frontend evidence text.

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
