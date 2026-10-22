#!/usr/bin/env node
/**
 * DeepSeek role suggestions for 知识库 role-review-queue.jsonl (modelled on dedup-reviewer-deepseek.mjs).
 *
 * For each queued row without ai_suggestion, sends the entry's Markdown section text to deepseek-chat
 * (batched), validates the JSON, keeps only roles backed by a verbatim quote from the text, and writes
 * `ai_suggestion` onto the queue row. `status` stays `pending`; nothing is promoted into entry-roles.jsonl.
 *
 * Auth: DEEPSEEK_API_KEY from the process environment only. Never commit or print it.
 * Options: --limit N  --batch N (default 20)  --concurrency N (default 4)  --dry-run  --redo
 * Env overrides: DEEPSEEK_BASE_URL, DEEPSEEK_MODEL / AGRIDX_ROLE_SUGGESTER_MODEL (default deepseek-chat)
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROLES = ['symptom', 'cause', 'check', 'action', 'retest'];
const RISKS = ['high', 'medium', 'low'];
const ROOT = '知识库/整理后的知识库/农用拖拉机知识库';
const QUEUE = path.join(ROOT, 'role-review-queue.jsonl');

const SYSTEM = `你是农机维修知识库的角色标注助手。对每条条目正文，只标注正文中实际出现的内容角色：
symptom=故障现象/表现；cause=候选原因；check=检查/诊断/核对步骤；action=处理/维修/保养操作或策略；retest=复检/恢复验收。
规则：不得推测或补造；正文没有明确对应内容的角色不要标；仅为安全警告、规格参数、资料说明且无上述角色时 roles 为空数组。
每个角色必须给出一段从正文逐字复制的短引文（≤40字）作为证据。risk_level 仅在正文明确写出危险/伤害/严重损坏风险时给 high/medium，否则省略。
confidence 为 0~1 的数，表示你对整条判断的把握。
只输出 JSON：{"results":[{"entry_id":"...","roles":[{"role":"symptom","quote":"..."}],"risk_level":"high","risk_quote":"...","confidence":0.8}]}`;

const norm = (s) => String(s).replace(/\s+/g, '').replace(/[“”「」『』"']/g, '');

/** Validates one model result against the entry text; drops anything not quoted verbatim. */
export function validateSuggestion(raw, body) {
  if (!raw || typeof raw !== 'object') throw new Error('result is not an object');
  const text = norm(body);
  const found = new Map();
  for (const item of Array.isArray(raw.roles) ? raw.roles : []) {
    const role = typeof item === 'string' ? item : item?.role;
    const quote = typeof item === 'object' && item ? String(item.quote ?? '').trim() : '';
    if (!ROLES.includes(role) || !quote || norm(quote).length < 2 || !text.includes(norm(quote))) continue;
    if (!found.has(role)) found.set(role, quote.slice(0, 80));
  }
  const roles = ROLES.filter((r) => found.has(r));
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
  const out = {
    label: roles.length ? 'roles' : 'none',
    roles,
    evidence: Object.fromEntries(roles.map((r) => [r, found.get(r)])),
    confidence,
  };
  const rq = String(raw.risk_quote ?? '').trim();
  if (RISKS.includes(raw.risk_level) && rq && text.includes(norm(rq))) {
    out.risk_level = raw.risk_level;
    out.risk_evidence = rq.slice(0, 80);
  }
  return out;
}

export function loadSections(paths) {
  const docs = new Map();
  for (const p of paths) {
    const s = new Map();
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gm)) {
      s.set(m[1].split('｜')[0].trim(), { heading: m[1].trim(), text: m[2].trim() });
    }
    docs.set(p, s);
  }
  return docs;
}

function extractJson(text) {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('model response is not valid JSON');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callModel(items, { apiKey, apiUrl, model }) {
  const user = JSON.stringify({ entries: items.map((i) => ({ entry_id: i.id, entry_type: i.type, heading: i.heading, text: i.text })) });
  for (let attempt = 0; attempt < 6; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0, stream: false, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
      if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      const parsed = extractJson(String(content ?? ''));
      if (!Array.isArray(parsed.results)) throw new Error('results missing');
      return { results: parsed.results, usage: data.usage };
    } catch (error) {
      clearTimeout(timer);
      if (attempt === 5 || /HTTP 4/.test(error.message)) throw error;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error('retries exhausted');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
  const limit = opt('limit', Infinity); const batch = opt('batch', 20); const conc = opt('concurrency', 4);
  const dry = args.includes('--dry-run'); const redo = args.includes('--redo');
  const rows = fs.readFileSync(QUEUE, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  const docs = loadSections([...new Set(rows.map((r) => r.knowledge_path))]);
  const todo = rows.filter((r) => redo || !r.ai_suggestion).slice(0, limit).map((r) => {
    const s = docs.get(r.knowledge_path).get(r.entry_id);
    if (!s) throw new Error(`section missing: ${r.entry_id}`);
    return { id: r.entry_id, type: r.entry_type, heading: s.heading, text: s.text, row: r };
  });
  const batches = [];
  for (let i = 0; i < todo.length; i += batch) batches.push(todo.slice(i, i + batch));
  process.stderr.write(`role-suggester: ${todo.length} entries in ${batches.length} batches\n`);
  if (dry) return;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) { process.stderr.write('DEEPSEEK_API_KEY is not set\n'); process.exit(1); }
  const model = (process.env.AGRIDX_ROLE_SUGGESTER_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const apiUrl = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const usage = { prompt_tokens: 0, completion_tokens: 0 }; let done = 0; let failed = 0;
  const save = () => fs.writeFileSync(QUEUE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const b = batches[next++];
      try {
        const { results, usage: u } = await callModel(b, { apiKey, apiUrl, model });
        usage.prompt_tokens += u?.prompt_tokens ?? 0; usage.completion_tokens += u?.completion_tokens ?? 0;
        const byId = new Map(results.filter((r) => r && typeof r === 'object').map((r) => [r.entry_id, r]));
        for (const item of b) {
          const raw = byId.get(item.id);
          if (!raw) { failed++; continue; }
          try {
            item.row.ai_suggestion = { ...validateSuggestion(raw, item.text), model, suggested_at: date, basis: 'AI建议，待人工确认' };
            done++;
          } catch { failed++; }
        }
      } catch (error) {
        failed += b.length;
        process.stderr.write(`batch failed: ${error.message}\n`);
      }
      save();
      process.stderr.write(`progress ${done}/${todo.length} failed ${failed}\n`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  save();
  process.stderr.write(`done ${done}, failed ${failed}, tokens in ${usage.prompt_tokens} out ${usage.completion_tokens}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
