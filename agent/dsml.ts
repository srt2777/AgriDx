/**
 * DSML (DeepSeek Markup Language) tool-call translation.
 *
 * Why this exists: DeepSeek V4 Flash models (the production model family,
 * configured as deepseek-flash / deepseek-v4-flash) natively emit tool calls
 * as DSML text, not as OpenAI structured `tool_calls`, unless the serving
 * stack converts them. When the serving stack does not convert, a model turn
 * that intended a tool call arrives here as plain content such as:
 *
 *   <｜DSML｜tool_calls>
 *   <｜DSML｜invoke name="search_knowledge">
 *   <｜DSML｜parameter name="brand" string="true">东方红</｜DSML｜parameter>
 *   ...
 *   </｜DSML｜invoke>
 *   </｜DSML｜tool_calls>
 *
 * (V4.1 variants put a space after the DSML token, e.g. `<｜DSML｜ calls>`,
 * and ASCII-pipe variants `<|DSML|...>` also occur in the wild. All three
 * spellings are handled here.)
 *
 * Without translation, that text has exactly two bad outcomes in the main
 * loop: if the finish reason says "stop" it is accepted as a final answer
 * and the raw markup leaks into the user-visible supplement; if the finish
 * reason says "tool_calls" the OpenAI parser rejects the turn as an invalid
 * response and the loop falls back to the single-call path. Translating a
 * well-formed DSML block into structured calls fixes both outcomes at once.
 *
 * Safety: parsing never trusts the model. Names must match the tool-name
 * pattern, at most 4 calls are returned, parameter values are either raw
 * strings (string="true" or absent) or JSON (string="false"), and any
 * malformed block returns null so the caller falls back to stripping the
 * markup instead of executing a half-parsed call. No arguments, credentials
 * or model output are logged here.
 */

export interface DsmlToolCall { id: string; name: string; input: Record<string, unknown> }

const TOKEN = '[｜|]DSML[｜|]';
const NAME = '[a-zA-Z0-9_-]{1,64}';

function unwrapCdata(value: string): string {
  const match = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : value;
}

function parseParameter(raw: string, isString: boolean): unknown {
  const value = unwrapCdata(raw.trim());
  if (isString) return value;
  return JSON.parse(value);
}

/**
 * Parse a complete DSML tool_calls block in `content` into structured calls.
 * Returns null when there is no complete block, or when any invoke/parameter
 * in the block is malformed. A null result is not an error: callers must
 * strip the markup (see stripDsmlMarkup) instead of executing it.
 */
export function parseDsmlToolCalls(content: string): DsmlToolCall[] | null {
  const block = content.match(new RegExp(`<${TOKEN}\\s*(?:tool_calls|calls)\\s*>([\\s\\S]*?)</${TOKEN}\\s*(?:tool_calls|calls)\\s*>`, 'i'));
  if (!block) return null;
  const inner = block[1];
  const invokes: DsmlToolCall[] = [];
  const invokePattern = new RegExp(`<${TOKEN}\\s*invoke\\s+name="(${NAME})"[^>]*>([\\s\\S]*?)</${TOKEN}\\s*invoke\\s*>`, 'gi');
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(inner)) !== null) {
    const [, name, body] = invokeMatch;
    const input: Record<string, unknown> = {};
    const paramPattern = new RegExp(`<${TOKEN}\\s*parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?[^>]*>([\\s\\S]*?)</${TOKEN}\\s*parameter\\s*>`, 'gi');
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramPattern.exec(body)) !== null) {
      const [, paramName, stringAttr, rawValue] = paramMatch;
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(paramName)) return null;
      try {
        input[paramName] = parseParameter(rawValue, stringAttr !== 'false');
      } catch {
        return null;
      }
    }
    // A parameter element that does not parse as a whole element (e.g. a
    // truncated value) must not be silently dropped: if the body still
    // contains a parameter tag after the matches, the block is malformed.
    const remainder = body.replace(new RegExp(`<${TOKEN}\\s*parameter\\s+name="[^"]+"(?:\\s+string="(?:true|false)")?[^>]*>[\\s\\S]*?</${TOKEN}\\s*parameter\\s*>`, 'gi'), '');
    if (new RegExp(`<${TOKEN}`, 'i').test(remainder)) return null;
    invokes.push({ id: `dsml-${invokes.length + 1}`, name, input });
  }
  if (!invokes.length) return null;
  // Any invoke-shaped text left over means the block was not fully parsed.
  const remainder = inner.replace(new RegExp(`<${TOKEN}\\s*invoke\\s+name="${NAME}"[^>]*>[\\s\\S]*?</${TOKEN}\\s*invoke\\s*>`, 'gi'), '');
  if (new RegExp(`<${TOKEN}\\s*invoke`, 'i').test(remainder)) return null;
  if (invokes.length > 4) return null;
  return invokes;
}

/**
 * Remove DSML tool-call markup from user-visible text. Complete invoke and
 * parameter elements are removed together with their values (a parameter
 * value is a tool argument, not answer prose); stray DSML tags are removed
 * on their own. The result is blank-line-collapsed and trimmed, and is
 * empty when the input was only a tool-call block.
 */
export function stripDsmlMarkup(content: string): string {
  let out = content;
  // Complete tool_calls blocks first (they contain invoke blocks).
  out = out.replace(new RegExp(`<${TOKEN}\\s*(?:tool_calls|calls)\\s*>[\\s\\S]*?</${TOKEN}\\s*(?:tool_calls|calls)\\s*>`, 'gi'), '');
  // An unterminated tool_calls block is truncated markup, not prose.
  out = out.replace(new RegExp(`<${TOKEN}\\s*(?:tool_calls|calls)\\s*>[\\s\\S]*$`, 'gi'), '');
  // Complete invoke blocks (with their parameter values).
  out = out.replace(new RegExp(`<${TOKEN}\\s*invoke\\b[^>]*>[\\s\\S]*?</${TOKEN}\\s*invoke\\s*>`, 'gi'), '');
  // Complete parameter elements left outside an invoke block.
  out = out.replace(new RegExp(`<${TOKEN}\\s*parameter\\b[^>]*>[\\s\\S]*?</${TOKEN}\\s*parameter\\s*>`, 'gi'), '');
  // Any remaining DSML tags (stray opens/closes, incomplete elements).
  out = out.replace(new RegExp(`</?${TOKEN}[^>]*>`, 'gi'), '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
