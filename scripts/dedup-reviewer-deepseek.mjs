#!/usr/bin/env node
/**
 * Offline pluggable AI pre-reviewer for 知识库/工具/语义预审.py (--reviewer command).
 *
 * Contract (stdin → stdout JSON):
 *   stdin:  { prompt, pair_id, tier, a, b }  (a/b carry entry_id, brand, model, title, source_id, locator, body)
 *   stdout: { relation, keep_both, reason, evidence_spans }
 *   relation ∈ duplicate|complementary|scope_variant|conflict|unrelated|uncertain
 *
 * Auth: reads DEEPSEEK_API_KEY from the process environment only. Never commit the key,
 * never put it in repo files, CHANGELOG, or PR text. Optional overrides:
 *   DEEPSEEK_BASE_URL  (default https://api.deepseek.com)
 *   DEEPSEEK_MODEL / AGRIDX_DEDUP_REVIEWER_MODEL  (default deepseek-chat)
 *
 * Example:
 *   export DEEPSEEK_API_KEY=...   # from a local secret store, chmod 600
 *   export AGRIDX_DEDUP_REVIEWER_CMD='node scripts/dedup-reviewer-deepseek.mjs'
 *   export AGRIDX_DEDUP_REVIEWER_MODEL=deepseek-chat
 *   python3 -B 知识库/工具/语义预审.py --reviewer command --write-review --limit 50
 */
import { readFileSync } from 'node:fs';

const RELATIONS = new Set([
  'duplicate', 'complementary', 'scope_variant', 'conflict', 'unrelated', 'uncertain',
]);

function fail(message, code = 1) {
  process.stderr.write(`dedup-reviewer-deepseek: ${message}\n`);
  process.exit(code);
}

function readStdin() {
  const chunks = [];
  const fd = 0;
  try {
    // Prefer sync read of entire stdin so the Python parent can use subprocess.run.
    const buf = readFileSync(fd);
    if (buf.length) chunks.push(buf);
  } catch (error) {
    fail(`cannot read stdin: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* fall through */
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('model response is not valid JSON');
  }
}

function validateVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') throw new Error('verdict is not an object');
  const relation = verdict.relation;
  if (!RELATIONS.has(relation)) throw new Error(`invalid relation: ${relation}`);
  if (typeof verdict.keep_both !== 'boolean') throw new Error('keep_both must be boolean');
  if (typeof verdict.reason !== 'string') throw new Error('reason must be a string');
  const spans = Array.isArray(verdict.evidence_spans) ? verdict.evidence_spans : [];
  return {
    relation,
    keep_both: verdict.keep_both,
    reason: verdict.reason,
    evidence_spans: spans.map(String).slice(0, 8),
  };
}

function sideSummary(side) {
  if (!side || typeof side !== 'object') return {};
  return {
    entry_id: side.entry_id ?? null,
    brand: side.brand ?? null,
    model: side.model ?? null,
    title: side.title ?? null,
    source_id: side.source_id ?? null,
    locator: side.locator ?? null,
    body: side.body ?? '',
  };
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) fail('DEEPSEEK_API_KEY is not set (provide via process env; do not commit it)');

  const raw = readStdin();
  if (!raw.trim()) fail('empty stdin; expected one pair JSON object');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    fail(`stdin is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
    ? payload.prompt.trim()
    : '比较两条农机维修知识，只输出 JSON 结论。';
  const model = (process.env.AGRIDX_DEDUP_REVIEWER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const apiUrl = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const userContent = JSON.stringify({
    pair_id: payload.pair_id ?? null,
    tier: payload.tier ?? null,
    a: sideSummary(payload.a),
    b: sideSummary(payload.b),
  }, null, 2);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const kind = error?.name === 'AbortError' ? 'timeout' : 'network';
    fail(`${kind} calling DeepSeek chat/completions`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Do not echo response body (may contain request echoes); status only.
    fail(`DeepSeek HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('DeepSeek response is not JSON');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) fail('DeepSeek response missing assistant content');

  let verdict;
  try {
    verdict = validateVerdict(extractJson(content));
  } catch (error) {
    fail(`invalid verdict: ${error instanceof Error ? error.message : String(error)}`);
  }

  process.stdout.write(JSON.stringify(verdict) + '\n');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
