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

## Observability

`diagnosisTrace.mainLoop` records `enabled`, `ran`, `status`
(`answered` | `question` | `fallback` | `cancelled` | null),
`toolSteps` (desensitised tool event count) and `toolEvents` (step, tool,
ok, error type, duration, source label only). It never contains tool
arguments, tool output text or credentials, and it is not written into
`knowledgeSources` or the frontend evidence text.

## Boundaries that do not change

- No write tools, no repair execution, no telemetry simulation as a tool.
- Tool results are not verified facts: a tool result can only become a
  citation after the existing trusted-evidence filter (exact match,
  indexed source, verified review) and the answer guard.
- DiagnosisRouter rules and thresholds, answerGuard veto rules, retrieval
  topK and weights, and Planner templates and evidence gates are
  untouched by this change.
- Evaluation scores are never written back into diagnostic memory.
