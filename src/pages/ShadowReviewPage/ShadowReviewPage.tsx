import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Internal shadow-review page (direct access only: /shadow-review).
 *
 * This page is intentionally NOT linked from the main navigation, the home
 * page or the chat page. It only reads the internal /api/shadow-review
 * endpoints, which are same-origin + no-store, and it never writes a
 * diagnosis, a rule or diagnosis memory. The promotion area only calls
 * the promotion-CHECK endpoint: an "approved" result is a gate check, not
 * an executed promotion.
 */
type ShadowReviewComparison = 'consistent' | 'new_evidence' | 'conflict' | 'high_risk';

interface ShadowReviewViewItem {
  sessionId: string;
  comparison: ShadowReviewComparison;
  comparisonLabel: string;
  candidateEvidenceIds: string[];
  plannerSteps: string[];
  toolResults: { tool: string; ok: boolean; error_type: string | null; duration_ms: number; source: string }[];
  safety: 'ok' | 'high_risk';
  mainRoute: string;
  mainReason?: string;
  durationMs: number;
  timedOut: boolean;
  reviewOnly: true;
}

type PromotionDecision =
  | { approved: true; sessionId: string; reviewer: string; candidateEvidenceIds: string[] }
  | { approved: false; reason: string };

const COMPARISON_FILTERS: { value: 'all' | ShadowReviewComparison; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'consistent', label: '一致' },
  { value: 'new_evidence', label: '补新证据' },
  { value: 'conflict', label: '冲突' },
  { value: 'high_risk', label: '高风险' },
];

export default function ShadowReviewPage() {
  const [items, setItems] = useState<ShadowReviewViewItem[]>([]);
  const [candidateCount, setCandidateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<'all' | ShadowReviewComparison>('all');
  const [sessionId, setSessionId] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<PromotionDecision | null>(null);
  const [checkError, setCheckError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/shadow-review', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!value || !Array.isArray(value.items)) { setFailed(true); return; }
        setItems(value.items);
        setCandidateCount(Array.isArray(value.candidates) ? value.candidates.length : 0);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const visible = filter === 'all' ? items : items.filter((item) => item.comparison === filter);

  const runPromotionCheck = async (event: React.FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setDecision(null);
    setCheckError('');
    try {
      const response = await fetch('/api/shadow-review/promotion-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.trim(), reviewer: reviewer.trim(), verified }),
      });
      const value = await response.json().catch(() => null);
      if (!response.ok) { setCheckError(value?.error ?? '门控检查失败'); return; }
      setDecision(value?.decision ?? null);
    } catch {
      setCheckError('门控检查请求失败，请稍后重试');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="knowledge-page">
      <div className="page-container">
        <Link to="/">返回首页</Link>
        <header>
          <div>内部 · 影子审阅</div>
          <h1>影子审阅记录</h1>
          <p>
            内部页面，仅直接访问 /shadow-review 打开，未加入主导航。只读展示影子运行的审阅记录；
            不改规则、不写诊断记忆、不直接拼进用户答案。
          </p>
          <p>
            <strong>注意：</strong>本接口只做了同源（sameOrigin）与 no-store，与状态接口同级，不是登录鉴权；
            若部署环境需要更强鉴权，须另行加。
          </p>
        </header>

        {loading && <p>正在加载影子审阅记录……</p>}
        {!loading && failed && <p>加载失败：请确认服务端已启动且可访问 /api/shadow-review。</p>}
        {!loading && !failed && items.length === 0 && (
          <section>
            <h2>暂无影子审阅记录</h2>
            <p>
              空不代表故障：影子是 opt-in 的，只有在 AGENT_LOOP=shadow 且主诊断 route 为 ai 时才会跑；
              且只有在有诊断记忆（memory）时才会传入 sessionId、生成审阅记录。存储是内存存储，
              服务重启后清空，只保留最新 100 条。
            </p>
          </section>
        )}
        {!loading && !failed && items.length > 0 && (
          <>
            <p>共 {items.length} 条记录，其中推广候选（补新证据）{candidateCount} 条。</p>
            <label>
              按比较结论筛选：
              <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                {COMPARISON_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {visible.length === 0 && <p>该筛选下没有记录。</p>}
            {visible.map((item, index) => (
              <article key={`${item.sessionId}-${index}`}>
                <h2>{item.comparisonLabel} · {item.sessionId}</h2>
                <p>
                  安全标记：{item.safety === 'high_risk' ? '高风险' : '正常'}；
                  主路由：{item.mainRoute}
                  {item.mainReason ? `（${item.mainReason}）` : ''}；
                  耗时：{item.durationMs} 毫秒；超时：{item.timedOut ? '是' : '否'}
                </p>
                <p>候选证据 ID：{item.candidateEvidenceIds.length ? item.candidateEvidenceIds.join('、') : '无'}</p>
                <p>Planner 步骤：{item.plannerSteps.length ? item.plannerSteps.join(' → ') : '无'}</p>
                <ul>
                  {item.toolResults.map((result, toolIndex) => (
                    <li key={toolIndex}>
                      {result.tool}：{result.ok ? '成功' : `失败（${result.error_type ?? 'error'}）`}，
                      {result.duration_ms} 毫秒，来源：{result.source}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </>
        )}

        <section>
          <h2>推广门控检查（不是执行推广）</h2>
          <p>
            <strong>这只是门控检查，不改规则、不写诊断记忆、不自动推广。</strong>
            即使返回“通过”，真正提炼仍需人工按审阅稿 3.4 核对证据、手册页码或范围标注、离线复现后操作。
            只有当你已完成上述核对，才勾选“已核验”。
          </p>
          <form onSubmit={runPromotionCheck}>
            <label>
              会话编号 sessionId：
              <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="例如：某条记录的 sessionId" />
            </label>
            <label>
              审阅人 reviewer：
              <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="填写审阅人姓名或编号" />
            </label>
            <label>
              <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
              已核验：证据已核验、有手册页码或范围标注、已离线复现
            </label>
            <button type="submit" disabled={checking}>{checking ? '检查中……' : '运行门控检查'}</button>
          </form>
          {checkError && <p>{checkError}</p>}
          {decision && decision.approved && (
            <p>
              门控检查通过：会话 {decision.sessionId}，审阅人 {decision.reviewer}，
              候选证据 {decision.candidateEvidenceIds.length ? decision.candidateEvidenceIds.join('、') : '无'}。
              这仍不是推广执行。
            </p>
          )}
          {decision && !decision.approved && <p>门控检查未通过，原因：{decision.reason}</p>}
        </section>
      </div>
    </div>
  );
}
