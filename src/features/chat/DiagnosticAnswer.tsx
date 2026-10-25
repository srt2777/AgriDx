import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import type { ChatMessage } from './session';
import { formatChatAnswer } from './answer-presentation';

type Translate = (zh: string, en: string) => string;
export function DiagnosticAnswer({ message, t, onAnswer, disabled }: {
  message: ChatMessage; t: Translate; onAnswer: (answer: string) => void; disabled: boolean;
}) {
  const reply = message.diagnosticReply;
  const body = formatChatAnswer(message, t);
  const [copied, setCopied] = useState(false);
  return <div className="chat-answer">
    <div className="chat-markdown prose max-w-none dark:prose-invert"><DeferredMarkdown>{body}</DeferredMarkdown></div>
    {!!reply?.questions.length && <div className="chat-follow-up mt-3 space-y-3">
      {reply.questions.slice(0, 2).map((question, index) => question.options?.length ? <div key={index} className="flex flex-wrap gap-2" role="group" aria-label={question.text}>
        {question.options.slice(0, 6).map((option, optionIndex) => <button key={optionIndex} type="button" disabled={disabled} className="chat-follow-up-option rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary disabled:opacity-50" onClick={() => onAnswer(`补充：${option}`)}>{option}</button>)}
      </div> : null)}
    </div>}
    {message.role === 'assistant' && <div className="chat-answer-actions mt-3 flex items-center">
      <button type="button" className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={t('复制回答', 'Copy answer')} title={t('复制回答', 'Copy answer')} onClick={async () => {
        try { await navigator.clipboard.writeText(body); setCopied(true); }
        catch { toast.error(t('复制失败，请选中文字复制。', 'Copy failed. Select the text to copy it.')); }
      }}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}<span className="text-xs" role="status">{copied ? t('已复制', 'Copied') : ''}</span></button>
    </div>}
  </div>;
}

/** Outside the answer bubble. Opening details never triggers retrieval or an AI request. */
export function DiagnosticEvidence({ message, t }: { message: ChatMessage; t: Translate }) {
  const sources = message.knowledgeSources || [];
  const sourceLabel = (source: typeof sources[number]) => source.evidenceKind === 'general-knowledge' || source.entryType === '通识学习'
    ? t('通识（无手册页码）', 'General knowledge (no manual pages)')
    : source.evidenceKind === 'prompt' ? t('信息收集提示（非手册）', 'Information prompt (not a manual)')
    : [source.sourceTitle || source.sourceId || source.source, source.pages?.pdf ? t(`PDF第${source.pages.pdf}页`, `PDF p. ${source.pages.pdf}`) : '', source.pages?.printed ? t(`印刷第${source.pages.printed}页`, `Printed p. ${source.pages.printed}`) : ''].filter(Boolean).join(' · ');
  return (<details className="chat-evidence mt-4 border-t border-border/50 pt-3">
      <summary className="cursor-pointer text-xs font-medium">{t('查看依据', 'View evidence')}</summary>
      <div className="chat-evidence-body mt-3 space-y-4 text-xs leading-relaxed text-muted-foreground">
        {sources.length ? <ol className="space-y-4">{sources.map((source, index) => <li key={`${source.entryId || source.source}-${index}`} className="rounded-md border border-border/60 p-3">
          <p className="font-medium text-foreground">{index + 1}. {source.heading}</p><p>{sourceLabel(source)}</p>
          <p>{[source.entryId, source.sourceId, source.version].filter(Boolean).join(' · ')}</p>
          {source.usage && <p>{source.usage === 'answer-evidence' ? t('用于当前资料分析；不代表已确诊', 'Used for evidence analysis; not a confirmed diagnosis') : source.usage === 'prompt-context' ? t('提供给AI的参考上下文，不表示每项生成内容均获支持', 'Context supplied to AI; not proof for every generated claim') : t('仅供参考，不作为本机操作依据', 'Reference only; not an instruction for this machine')}</p>}
          {source.scopeBoundary && <p>{t('适用范围：', 'Scope: ')}{source.scopeBoundary}</p>}
          {!!source.models?.length && <p>{t('型号：', 'Models: ')}{source.models.join('、')}</p>}
          {source.engineModel && <p>{t('发动机：', 'Engine: ')}{source.engineModel}</p>}{!!source.faultCodes?.length && <p>{t('故障码：', 'Codes: ')}{source.faultCodes.join('、')}</p>}
          {source.locator && <p>{t('原文位置：', 'Location: ')}{source.locator}</p>}
          {source.status && <p>{t('原始核验说明：', 'Original review status: ')}{source.status}</p>}
          {source.retrieval && <p>{t('检索层级：', 'Retrieval tier: ')}{source.retrieval.tier} · {source.retrieval.basis.join('；')}{source.retrieval.referenceOnly ? t('；仅参考', '; reference only') : ''}</p>}
        </li>)}</ol> : <p>{t('这条对话没有保存结构化来源；不从历史文字推造证据。', 'This message has no saved structured sources; evidence is not inferred from older text.')}</p>}
        {message.diagnosticReply?.sourceNote && <p>{message.diagnosticReply.sourceNote}</p>}
        {message.coordinationMessage && <p>{message.coordinationMessage}</p>}
        <p>{[message.provider, message.model, message.answerMode].filter(Boolean).join(' · ')}{message.knowledgeChunks !== undefined ? t(` · 检索${message.knowledgeChunks}条`, ` · ${message.knowledgeChunks} snippets`) : ''}</p>
        {message.fallbackReason && <p>{message.fallbackReason === 'not_configured' ? t('外部AI未配置，本次使用本地资料。', 'External AI is not configured; using local evidence.') : t('外部AI暂不可用，本次回退本地资料。', 'External AI was unavailable; using local evidence.')}</p>}
        {(message.coordination || message.diagnosisTrace || message.roleFlow) && <><p>{t('相关性分数是未标定的检索匹配，不是诊断准确率。', 'Relevance scores are uncalibrated retrieval matches, not diagnostic accuracy.')}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">{JSON.stringify({ reply: message.diagnosticReply, coordination: message.coordination, trace: message.diagnosisTrace, roleFlow: message.roleFlow }, null, 2)}</pre></>}
        <details><summary className="cursor-pointer">{t('查看保存的完整答复', 'Saved full answer')}</summary><div className="prose prose-sm mt-2 max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{message.content}</DeferredMarkdown></div></details>
      </div>
    </details>);
}
