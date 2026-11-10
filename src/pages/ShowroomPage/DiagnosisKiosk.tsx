/**
 * AgriDx interactive kiosk: the showroom's diagnosis demo.
 * Reuses the live in-app diagnosis API (src/features/chat/api.ts →
 * POST /api/chat) — no fake diagnosis. Preset questions are one-tap
 * demos; every demo answer is labelled as live API output, and the panel
 * states clearly when the API is unreachable instead of inventing a reply.
 */
import { useRef, useState } from 'react';
import { requestChat } from '@/features/chat/api';

const PRESETS = [
  { zh: '拖拉机启动困难，冒黑烟', en: 'Hard start, black smoke' },
  { zh: '液压提升无力，动作缓慢', en: 'Weak hydraulic lift' },
  { zh: '作业时发动机过热报警', en: 'Engine overheat alarm' },
] as const;

export default function DiagnosisKiosk({ lang, onClose }: { lang: 'zh' | 'en'; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const reply = await requestChat(
        {
          messages: [{ role: 'user', content: trimmed }],
          machineType: 'tractor',
          brand: '鸿鹄',
          model: 'T70',
        },
        controller.signal,
        lang === 'zh' ? '诊断服务暂时不可用，请稍后再试。' : 'Diagnosis service is unavailable right now.',
      );
      if (reply.role === 'error') setError(reply.content);
      else setAnswer(reply.content);
    } catch {
      setError(lang === 'zh' ? '请求被取消或网络异常，请重试。' : 'Request was cancelled or the network failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="showroom-kiosk" role="dialog" aria-label={lang === 'zh' ? 'AgriDx 智能诊断' : 'AgriDx diagnosis'}>
      <div className="showroom-kiosk-head">
        <div>
          <strong>{lang === 'zh' ? '司稼 · 智能诊断' : 'Sijia · Smart diagnosis'}</strong>
          <span className="showroom-kiosk-live">{lang === 'zh' ? '实时接口 /api/chat' : 'Live API /api/chat'}</span>
        </div>
        <button type="button" className="showroom-icon-btn" onClick={onClose} aria-label={lang === 'zh' ? '关闭' : 'Close'}>
          ✕
        </button>
      </div>
      <p className="showroom-kiosk-note">
        {lang === 'zh'
          ? '输入故障现象，知识库检索后给出诊断结果与维修建议。下面为演示用预设问题。'
          : 'Describe a fault; the knowledge base is searched before a diagnosis and repair advice are given. Presets below are demo shortcuts.'}
      </p>
      <div className="showroom-presets">
        {PRESETS.map((preset) => (
          <button key={preset.zh} type="button" onClick={() => ask(preset.zh)} disabled={loading}>
            {lang === 'zh' ? preset.zh : preset.en}
          </button>
        ))}
      </div>
      <form
        className="showroom-kiosk-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={lang === 'zh' ? '例如：拖拉机启动困难，冒黑烟…' : 'e.g. hard start with black smoke…'}
          aria-label={lang === 'zh' ? '故障现象' : 'Fault symptoms'}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? (lang === 'zh' ? '诊断中…' : 'Diagnosing…') : lang === 'zh' ? '诊断' : 'Diagnose'}
        </button>
      </form>
      {loading && <p className="showroom-kiosk-status">{lang === 'zh' ? '正在检索知识库并生成诊断…' : 'Searching the knowledge base…'}</p>}
      {error && <p className="showroom-kiosk-error">{error}</p>}
      {answer && (
        <div className="showroom-kiosk-answer">
          <span className="showroom-demo-tag">{lang === 'zh' ? '实时诊断结果' : 'Live diagnosis'}</span>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}
