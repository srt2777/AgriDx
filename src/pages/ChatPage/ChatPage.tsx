import type { DiagnosisMode } from '../../../shared/diagnosis';
import { useRef, useEffect, useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Trash2, Loader2, Bot, User, Sparkles, Square, Paperclip, X, Settings2 } from 'lucide-react';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import { Link, useLocation } from 'react-router-dom';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';

import type { ChatProvider } from '@shared/chat';
import { MACHINE_TYPES_ZH, MACHINE_TYPES_EN, composeDiagnosticQuestion, readDiagnosticTextAttachment, type ChatMessage } from '@/features/chat/session';
import { useChatSession } from '@/features/chat/useChatSession';
import { useLlmHealth } from '@/features/chat/useLlmHealth';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';
import { hasUnsavedProfile } from '@/features/updates/update-safety';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';
import { MorphingPanel } from '@/components/motion/MorphingPanel';
import { ThinkingOrbs } from '@/components/motion/ThinkingOrbs';
import { useDiagnosisOrb } from '@/components/motion/useDiagnosisOrb';

export default function ChatPage() {
  const location = useLocation();
  const handoff: unknown = location.state;
  const lang = useLang();
  const version = useUiVersion();
  const t = useCallback((zh: string, en: string) => (lang === 'zh' ? zh : en), [lang]);
  const providerLabel = (provider?: ChatProvider) =>
    provider === 'knowledge-base' ? t('本地知识库', 'Local knowledge base') :
    provider === 'gemini' ? 'Gemini' : provider === 'deepseek' ? 'DeepSeek' : '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => {
    if (window.matchMedia('(pointer: fine)').matches) textareaRef.current?.focus({ preventScroll: true });
  }, []);
  const {
    messages, input, setInput, isLoading, currentModel, currentProvider, currentFallbackReason,
    machineType, setMachineType, brand, setBrand, model, setModel,
    sendMessage, stopRequest, handleClear, memory, profile,
    diagnosisMode, setDiagnosisMode, deviceName, setDeviceName, hours, setHours, deviceNotes, setDeviceNotes, progress, setProgress,
    engineModel, setEngineModel, faultCodeInput, setFaultCodeInput, attachment, setAttachment, sendError,
  } = useChatSession({ handoff, translate: t, focusInput, minLoadingMs: version === 'new' && PREMIUM_MOTION_ENABLED ? 900 : 0 });
  const orb = useDiagnosisOrb(PREMIUM_MOTION_ENABLED && version === 'new' && isLoading);
  useUpdateBlocker('/chat', isLoading || memory.busy || !memory.ready || !!input.trim() || !!attachment
    || progress.trim() !== (memory.session?.progress ?? '')
    || hasUnsavedProfile(profile, memory.devices.find(device => device.id === memory.deviceId)));
  const llmHealth = useLlmHealth();
  useEffect(() => {
    if (typeof llmHealth === 'object') {
      if (llmHealth.allowExternalAi === false) setDiagnosisMode('knowledge_only');
      else if (llmHealth.defaultMode) setDiagnosisMode(llmHealth.defaultMode);
    }
  }, [llmHealth, setDiagnosisMode]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const followThread = useRef(true);
  const [contextOpen, setContextOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1101px)').matches);

  const scrollToBottom = useCallback(() => {
    if (followThread.current) messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }, []);
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const timer = window.setTimeout(focusInput, 100);
    return () => window.clearTimeout(timer);
  }, [focusInput]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      followThread.current = true;
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && window.matchMedia('(pointer: fine)').matches) {
        e.preventDefault();
        followThread.current = true;
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const handleQuickQuestion = useCallback(
    (question: string) => {
      followThread.current = true;
      void sendMessage(question, false);
    },
    [sendMessage],
  );

  const isEmpty = messages.length === 0;
  const composedLength = composeDiagnosticQuestion(input, attachment).length;
  const plate = [machineType, brand, model].filter(Boolean).join(' · ');
  const topic = messages.filter(message => message.role === 'user').at(-1)?.content.split('\n')[0] || input.trim().split('\n')[0];
  const typeOptions = lang === 'zh' ? MACHINE_TYPES_ZH : MACHINE_TYPES_EN;
  const serviceStatus = currentFallbackReason === 'provider_unavailable'
    ? t('本地知识库 · LLM 暂不可用', 'Local KB · LLM temporarily unavailable')
    : currentFallbackReason === 'not_configured'
    ? t('本地知识库 · LLM 未配置', 'Local KB · LLM not configured')
    : currentProvider === 'gemini' || currentProvider === 'deepseek'
    ? t('本地知识库 + LLM', 'Local KB + LLM')
    : typeof llmHealth === 'object' && !llmHealth.configured
    ? t('本地知识库 · LLM 未配置', 'Local KB · LLM not configured')
    : typeof llmHealth === 'object' && llmHealth.configured
    ? t('本地知识库 + LLM（已配置）', 'Local KB + LLM (configured)')
    : llmHealth === 'checking'
    ? t('本地知识库 · 正在检查 LLM 配置', 'Local KB · checking LLM configuration')
    : t('本地知识库 · LLM 配置状态未知', 'Local KB · LLM configuration unknown');
  const configurationHint = typeof llmHealth === 'object' && llmHealth.configured
    ? `${llmHealth.primary ? `${t('首选模型', 'Preferred provider')}: ${providerLabel(llmHealth.primary)}. ` : ''}${t('已配置密钥；服务可用性以实际对话结果为准。', 'An API key is configured; availability is determined by actual chat requests.')}`
    : undefined;
  const contextProps = {
    t, typeOptions, machineType, setMachineType, brand, setBrand, model, setModel,
    isLoading, memory, profile, deviceName, setDeviceName, hours, setHours,
    deviceNotes, setDeviceNotes, progress, setProgress,
  };

  return (
    <div className={`flex h-[calc(100dvh-5.625rem)] flex-col chat-glass${version === 'new' ? ' is-premium' : ''}`}>
      {/* 顶部工具栏 */}
      <LiquidGlass
        variant="regular"
        className="chat-bar-glass"
        contentClassName="flex items-center justify-between border-b border-border/60 px-4 py-3 md:px-6"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground" data-shared-target={version === 'new' ? 'diagnosis' : undefined}>耕知·耘诊 · {t('诊断工作台', 'Diagnosis workspace')}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <span title={configurationHint}>{serviceStatus}</span>
            </div>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" aria-label={t('清空对话', 'Clear conversation')} disabled={isEmpty || isLoading || memory.busy}>
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('清空对话', 'Clear')}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('确认清空对话？', 'Clear all messages?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('清空后当前所有对话记录将被删除，且无法恢复。', 'All current messages will be deleted and cannot be recovered.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('取消', 'Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleClear}>{t('确认清空', 'Clear')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </LiquidGlass>

      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-xs">
        <label htmlFor="diagnosis-mode">{t('回答模式', 'Answer mode')}</label>
        <select id="diagnosis-mode" value={diagnosisMode} disabled={isLoading || memory.busy} onChange={e => setDiagnosisMode(e.target.value as DiagnosisMode)} className="rounded-md border border-border bg-background px-2 py-1">
          <option value="auto">{t('自动协调', 'Automatic')}</option>
          <option value="knowledge_only">{t('仅本地知识库', 'Local knowledge only')}</option>
          <option value="ai_assisted" disabled={typeof llmHealth !== 'object' || !llmHealth.configured || llmHealth.allowExternalAi === false}>{t('AI 辅助分析', 'AI-assisted analysis')}</option>
        </select>
      </div>
      <div className="chat-current-context">
        <div className="min-w-0"><p className="truncate font-medium">{plate || t('尚未指定车型 · 可先描述现象', 'No model specified · describe the symptom first')}</p>{topic && <p className="truncate text-muted-foreground">{t('当前问题：', 'Current topic: ')}{topic.slice(0, 100)}</p>}</div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1" aria-expanded={contextOpen} aria-controls="chat-machine-context" onClick={() => setContextOpen(open => !open)}><Settings2 className="h-4 w-4" />{t('车型与记录', 'Machine & history')}</Button>
      </div>
      <div className={version === 'new' ? `chat-workspace${contextOpen ? '' : ' is-context-closed'}` : 'flex min-h-0 flex-1 flex-col'}>
      <div className={version === 'new' ? 'chat-thread' : 'contents'}>
      {/* 消息列表 */}
      <div ref={threadRef} onScroll={() => { const node = threadRef.current; if (node) followThread.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label={t('诊断对话', 'Diagnosis conversation')} aria-live="polite">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
              {version !== 'new' && contextOpen && <div id="chat-machine-context"><MachineContext framed {...contextProps} /></div>}

          {/* 空状态 / 欢迎态 */}
          {isEmpty && (
            <div className="chat-empty flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex items-center justify-center">
                {version === 'new' && PREMIUM_MOTION_ENABLED
                  ? <ThinkingOrbs state="listening" label={t('待命', 'Listening')} />
                  : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-7 w-7" /></span>}
              </div>
              <h2 className="font-serif text-xl font-bold text-foreground">{version === 'new' ? t('描述现象，从资料里找起点。', 'Describe the symptom. Start from the evidence.') : pick(content.CHAT_WELCOME.title, lang)}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">{version === 'new' ? t('带上机型更好。回答依据是已索引资料，适用范围仍需核对。', 'A model helps. Answers follow indexed evidence, and scope still needs a check.') : pick(content.CHAT_WELCOME.desc, lang)}</p>


              {/* 快捷提问按钮 */}
              <div className="mt-6 w-full">
                <div className="mb-3 text-xs font-medium text-wheat">{version === 'new' ? t('可以这样问', 'You can ask') : t('您可以这样问', 'Try asking')}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {content.CHAT_QUICK_QUESTIONS.map((q) => (
                    <button
                      key={pick(q, lang)}
                      onClick={() => handleQuickQuestion(pick(q, lang))}
                      disabled={isLoading || memory.busy}
                      className="chat-chip rounded-md border border-border/60 bg-card p-3 text-left text-sm text-foreground transition-all hover:border-primary/40 hover:bg-accent/50 hover:text-primary disabled:opacity-50"
                    >
                      {pick(q, lang)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message mb-4 flex ${msg.role === 'user' ? 'is-user justify-end' : 'is-reply justify-start'}${msg.role === 'loading' ? ' is-thinking' : ''}${msg.role === 'assistant' ? ' is-answer' : ''}`}
            >
              {msg.role !== 'user' && (
                <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={`min-w-0 break-words ${msg.role === 'user' ? 'max-w-[85%] md:max-w-[75%]' : 'w-full'} rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                    : msg.role === 'error'
                    ? 'rounded-tl-sm border border-destructive/30 bg-destructive/5 text-destructive'
                    : msg.role === 'loading'
                    ? 'rounded-tl-sm border border-border/60 bg-card text-muted-foreground'
                    : 'rounded-tl-sm border border-border/60 bg-card text-foreground'
                }`}
              >
                {msg.role === 'loading' ? (
                  version === 'new' && PREMIUM_MOTION_ENABLED ? (
                    <ThinkingOrbs
                      state={orb === 'listening' ? 'searching' : orb}
                      label={orb === 'solving' ? t('整理判断…', 'Sorting the answer…') : t('检索资料…', 'Searching evidence…')}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t('正在思考...', 'Thinking...')}</span>
                    </div>
                  )
                ) : msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <DiagnosticAnswer message={msg} t={t} onAnswer={handleQuickQuestion} disabled={isLoading || memory.busy} />
                )}
              </div>
              {msg.role === 'user' && (
                <div className="ml-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/80 text-primary-foreground">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入区 */}
      <LiquidGlass
        variant="regular"
        className="chat-input-glass"
        contentClassName="border-t border-border/60 px-4 py-4 md:px-6"
      >
        <form onSubmit={handleSubmit} className="chat-composer mx-auto max-w-3xl">
          <details className="chat-input-extras mb-2 text-xs"><summary className="cursor-pointer py-1">{t('补充发动机、故障码或文本报告（选填）', 'Add engine, fault codes or a text report (optional)')}</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label>{t('发动机型号', 'Engine model')}<input value={engineModel} onChange={event => setEngineModel(event.target.value)} maxLength={100} disabled={isLoading || memory.busy} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>
              <label>{t('故障码原文（逗号分隔）', 'Fault codes (comma separated)')}<input value={faultCodeInput} onChange={event => setFaultCodeInput(event.target.value)} maxLength={660} disabled={isLoading || memory.busy} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>
            </div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-2"><Paperclip className="h-3.5 w-3.5" />{t('添加故障文本', 'Add fault text')}<input type="file" accept=".txt,.log,.csv,.json,text/plain,text/csv,application/json" disabled={isLoading || memory.busy} className="sr-only" aria-label={t('添加故障信息文本文件', 'Add a fault information text file')} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { setAttachment(await readDiagnosticTextAttachment(file)); } catch (error) { toast.error(error instanceof Error ? error.message : t('读取文本失败', 'Could not read text')); } }} /></label>
            <p className="mt-1 text-muted-foreground">{t('仅UTF-8的txt/log/csv/json，最多16KB；发送时文字随问题提交。暂不支持照片识别，请勿包含密钥或个人资料。', 'UTF-8 txt/log/csv/json only, up to 16KB. Text is submitted with your question when sent. Photo recognition is unavailable; omit secrets and personal information.')}</p>
          </details>
          {attachment && <div className="chat-attachment mb-2 rounded-md border border-border p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="truncate">{attachment.name} · {attachment.text.length} {t('字符', 'characters')}</span><Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={isLoading} aria-label={t('移除文本报告', 'Remove text report')} onClick={() => setAttachment(undefined)}><X className="h-3.5 w-3.5" /></Button></div><details><summary className="cursor-pointer">{t('预览将发送的文本', 'Preview text to send')}</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">{attachment.text}</pre></details></div>}
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={t('故障描述', 'Fault description')}
              aria-describedby="chat-input-help"
              aria-invalid={composedLength > 2000}
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('描述您遇到的农机故障现象...', 'Describe the fault symptom...')}
              className="min-h-[60px] resize-none"
              rows={2}
              disabled={isLoading || memory.busy}
            />
            {isLoading ? (
              <Button type="button" size="icon" onClick={stopRequest} aria-label={t('停止等待', 'Stop waiting')} title={t('停止等待', 'Stop waiting')}>
                <Square className="h-4 w-4" />
              </Button>
            ) : <Button
              type="submit"
              size="icon"
              disabled={(!input.trim() && !attachment) || composedLength > 2000 || memory.busy}
              className={version === 'new' && PREMIUM_MOTION_ENABLED ? 'shrink-0 glass-press' : 'shrink-0'}
              data-motion={version === 'new' && PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined}
              aria-label={t('发送', 'Send')}
            >
              <Send className="h-4 w-4" />
            </Button>}
          </div>
          <div id="chat-input-help" className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span><span className="hidden sm:inline">{t('Enter发送，Shift + Enter换行', 'Enter to send, Shift+Enter for newline')}</span><span className="sm:hidden">{t('点击发送；回车换行', 'Tap send; Enter adds a line')}</span></span>
            <span className={composedLength > 2000 ? 'text-destructive' : ''}>{composedLength} / 2000</span>
          </div>
          {sendError && <p role="alert" className="mt-2 text-xs text-destructive">{sendError}</p>}
        </form>
      </LiquidGlass>
      </div>
      {version === 'new' && (
        <aside id="chat-machine-context" hidden={!contextOpen} className="chat-context" aria-label={t('机具上下文', 'Machine context')}>
          <MachineContext framed={false} {...contextProps} />
        </aside>
      )}
      </div>
    </div>
  );
}

function DiagnosticAnswer({ message, t, onAnswer, disabled }: {
  message: ChatMessage; t: (zh: string, en: string) => string; onAnswer: (answer: string) => void; disabled: boolean;
}) {
  const reply = message.diagnosticReply;
  const sources = message.knowledgeSources || [];
  const sourceLabel = (source: typeof sources[number]) => source.evidenceKind === 'general-knowledge' || source.entryType === '通识学习'
    ? t('通识（无手册页码）', 'General knowledge (no manual pages)')
    : source.evidenceKind === 'prompt' ? t('信息收集提示（非手册）', 'Information prompt (not a manual)')
    : [source.sourceTitle || source.sourceId || source.source, source.pages?.pdf ? t(`PDF第${source.pages.pdf}页`, `PDF p. ${source.pages.pdf}`) : '', source.pages?.printed ? t(`印刷第${source.pages.printed}页`, `Printed p. ${source.pages.printed}`) : ''].filter(Boolean).join(' · ');
  const used = sources.filter(source => source.usage === 'answer-evidence');
  return <div className="chat-answer">
    {reply ? <>
      <p className="whitespace-pre-wrap">{reply.understanding}</p>
      {reply.causes.length > 0 && <section className="mt-4"><h3 className="mb-2 font-semibold">{t('可能原因，仍需核实', 'Possible causes to verify')}</h3><ul className="space-y-2 pl-4 list-disc">{reply.causes.map((cause, index) => <li key={index}>{cause.text}{cause.basis === 'general_hypothesis' && <span className="ml-1 text-xs text-muted-foreground">{t('（通用分析，非本机结论）', ' (general analysis, not a vehicle diagnosis)')}</span>}</li>)}</ul></section>}
      {reply.suggestions.length > 0 && <section className="mt-4"><h3 className="mb-2 font-semibold">{t('建议先做', 'Suggested next steps')}</h3><ol className="list-decimal space-y-2 pl-5">{[...reply.suggestions].sort((a, b) => a.priority - b.priority).map((suggestion, index) => <li key={index}>{suggestion.text}</li>)}</ol></section>}
      {reply.aiSupplement && <section className="mt-4"><h3 className="mb-2 font-semibold">{t('补充分析', 'Additional analysis')}</h3><div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{reply.aiSupplement}</DeferredMarkdown></div></section>}
      {reply.sourceNote && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{reply.sourceNote}</p>}
      {reply.questions.length > 0 && <section className="chat-follow-up mt-4"><h3 className="mb-2 font-semibold">{t('再确认一下', 'A couple of questions')}</h3>{reply.questions.slice(0, 2).map((question, index) => <div key={index} className="mt-3"><p>{question.text}</p>{question.options?.length ? <div className="mt-2 flex flex-wrap gap-2">{question.options.slice(0, 6).map((option, optionIndex) => <button key={optionIndex} type="button" disabled={disabled} className="chat-follow-up-option rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary disabled:opacity-50" onClick={() => onAnswer(`${question.text}\n${option}`)}>{option}</button>)}</div> : null}</div>)}</section>}
    </> : <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{message.localSummary || message.content}</DeferredMarkdown></div>}
    {used.length > 0 && <p className="mt-4 border-t border-border/50 pt-2 text-xs text-muted-foreground">{t('依据：', 'Evidence: ')}{used.slice(0, 2).map(sourceLabel).join('；')}{used.length > 2 ? t(`，另${used.length - 2}条见详情`, `; ${used.length - 2} more in details`) : ''}</p>}
    {message.role === 'assistant' && <details className="chat-evidence mt-4 border-t border-border/50 pt-3">
      <summary className="cursor-pointer text-xs font-medium">{t('诊断依据与技术详情', 'Evidence and technical details')}{sources.length ? ` · ${sources.length}` : ''}</summary>
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
        {message.coordinationMessage && <p>{message.coordinationMessage}</p>}
        <p>{[message.provider, message.model, message.answerMode].filter(Boolean).join(' · ')}{message.knowledgeChunks !== undefined ? t(` · 检索${message.knowledgeChunks}条`, ` · ${message.knowledgeChunks} snippets`) : ''}</p>
        {message.fallbackReason && <p>{message.fallbackReason === 'not_configured' ? t('外部AI未配置，本次使用本地资料。', 'External AI is not configured; using local evidence.') : t('外部AI暂不可用，本次回退本地资料。', 'External AI was unavailable; using local evidence.')}</p>}
        {(message.coordination || message.diagnosisTrace || message.roleFlow) && <><p>{t('相关性分数是未标定的检索匹配，不是诊断准确率。', 'Relevance scores are uncalibrated retrieval matches, not diagnostic accuracy.')}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">{JSON.stringify({ coordination: message.coordination, trace: message.diagnosisTrace, roleFlow: message.roleFlow }, null, 2)}</pre></>}
        <details><summary className="cursor-pointer">{t('查看保存的完整答复', 'Saved full answer')}</summary><div className="prose prose-sm mt-2 max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{message.content}</DeferredMarkdown></div></details>
      </div>
    </details>}
  </div>;
}

function MachineContext({
  framed, t, typeOptions, machineType, setMachineType, brand, setBrand, model, setModel,
  isLoading, memory, profile, deviceName, setDeviceName, hours, setHours, deviceNotes, setDeviceNotes, progress, setProgress,
}: {
  framed: boolean;
  t: (zh: string, en: string) => string;
  typeOptions: readonly string[];
  machineType: string;
  setMachineType: (value: string) => void;
  brand: string;
  setBrand: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  isLoading: boolean;
  memory: ReturnType<typeof useChatSession>['memory'];
  profile: Parameters<ReturnType<typeof useChatSession>['memory']['saveProfile']>[0];
  deviceName: string;
  setDeviceName: (value: string) => void;
  hours: string;
  setHours: (value: string) => void;
  deviceNotes: string;
  setDeviceNotes: (value: string) => void;
  progress: string;
  setProgress: (value: string) => void;
}) {
  const [hud, setHud] = useState<'machine' | 'scope' | 'progress'>('machine');
  const plate = [machineType, brand, model].filter(Boolean).join(' · ');
  const hudSteps = [
    ['machine', t('机具', 'Machine')],
    ['scope', t('边界', 'Scope')],
    ['progress', t('进度', 'Progress')],
  ] as const;
  return (
    <div className={framed ? 'mb-6 w-full rounded-xl border border-border/60 bg-card p-4 text-left' : 'text-left'}>
      {!framed && PREMIUM_MOTION_ENABLED && (
        <section className="chat-hud" aria-label={t('诊断步骤', 'Diagnosis steps')}>
          <div className="morph-steps" role="tablist" aria-label={t('诊断步骤', 'Diagnosis steps')}>
            {hudSteps.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={hud === id} onClick={() => setHud(id)}>{label}</button>
            ))}
          </div>
          <MorphingPanel stepKey={hud}>
            <div role="tabpanel">
              {hud === 'machine' && <p>{plate || t('尚未填写铭牌', 'No plate yet')}<br />{t('核对铭牌上的完整型号。', 'Check the full model on the plate.')}</p>}
              {hud === 'scope' && <p>{t('回答依据是已索引资料。系列资料不能代替具体机型，适用范围仍需核对。', 'Answers follow indexed evidence. Series documents do not replace a specific model, and scope still needs a check.')}</p>}
              {hud === 'progress' && <p>{progress.trim() || t('还没有本次检查进度。', 'No check progress yet.')}<br />{t('保存后留在这台设备的诊断记忆里。', 'After you save it, it stays with this device’s diagnosis memory.')}</p>}
            </div>
          </MorphingPanel>
        </section>
      )}
      <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium text-primary">
        <span>{framed ? t('诊断上下文 · 请核对现场铭牌', 'Machine context · check the machine plate') : t('机具上下文', 'Machine context')}</span>
        <Link to="/knowledge" className="underline underline-offset-4">{t('浏览资料', 'Browse evidence')}</Link>
      </div>
      <div className="chat-fields grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select aria-label={t('农机类型', 'Machine type')} value={machineType} onChange={(event) => setMachineType(event.target.value)} disabled={isLoading || memory.busy} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60">
          <option value="">{t('类型', 'Type')}</option>
          {typeOptions.map((label, index) => <option key={MACHINE_TYPES_ZH[index]} value={MACHINE_TYPES_ZH[index]}>{label}</option>)}
        </select>
        <input aria-label={t('品牌', 'Brand')} maxLength={100} value={brand} onChange={(event) => setBrand(event.target.value)} placeholder={t('品牌（选填）', 'Brand (optional)')} disabled={isLoading || memory.busy} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60" />
        <input aria-label={t('型号', 'Model')} maxLength={100} value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('型号（选填）', 'Model (optional)')} disabled={isLoading || memory.busy} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{framed ? t('完整型号与配置帮助限定资料范围；系列资料不能直接代替具体机型。带入的问题仅预填，由你确认后发送。', 'The complete model and configuration define applicability. Series documents do not replace specific-model evidence. Imported questions are drafts for you to review and send.') : t('核对铭牌上的完整型号。系列资料不能代替具体机型。', 'Check the full model on the plate. Series documents do not replace a specific model.')}</p>
      <details className="chat-evidence mt-4 border-t border-border/60 pt-3">
        <summary className="cursor-pointer text-sm font-medium">{t('诊断记忆', 'Diagnosis memory')} · {memory.ready ? t('已连接', 'Connected') : t('未就绪', 'Not ready')}</summary>
        <div className="chat-evidence-body">
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__ ? t('开发预览的档案与对话仅保存在当前浏览器，清除网站数据会删除。检查结果是用户报告。', 'Preview profiles and chats stay in this browser. Clearing site data deletes them. Checks are user reports.') : t('档案与对话保存到后端，同一浏览器重新打开可继续。清除浏览器身份后无法自动恢复；检查结果是用户报告。', 'Profiles and chats are saved on the server for this browser. Clearing browser identity prevents automatic recovery; checks are user reports.')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select aria-label={t('选择设备档案', 'Select device profile')} value={memory.deviceId} disabled={isLoading || memory.busy || !memory.ready} onChange={(event) => memory.selectDevice(event.target.value)} className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm">
              <option value="">{t('新设备（独立档案）', 'New device (separate profile)')}</option>
              {memory.devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.model || device.brand}</option>)}
            </select>
            <select aria-label={t('继续历史诊断', 'Resume diagnosis')} value={memory.session?.id || ''} disabled={isLoading || memory.busy || !memory.ready} onChange={(event) => { if (event.target.value) void memory.restore(event.target.value); }} className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm">
              <option value="">{t('继续历史诊断…', 'Resume a diagnosis…')}</option>
              {memory.sessions.map((session) => <option key={session.id} value={session.id}>{memory.devices.find((device) => device.id === session.deviceId)?.name} · {session.title}</option>)}
            </select>
            <label className="text-xs">{t('设备名称（区分不同车辆）', 'Device name (identify the vehicle)')}<input maxLength={100} value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={isLoading || memory.busy} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>
            <label className="text-xs">{t('使用小时数（选填）', 'Operating hours (optional)')}<input type="number" min="0" max="1000000" step="any" value={hours} onChange={(event) => setHours(event.target.value)} disabled={isLoading || memory.busy} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm" /></label>
          </div>
          <label className="mt-3 block text-xs">{t('设备维护记录（用户提供）', 'Maintenance notes (user reported)')}<Textarea value={deviceNotes} maxLength={2000} onChange={(event) => setDeviceNotes(event.target.value)} disabled={isLoading || memory.busy} className="mt-1" rows={2} /></label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={isLoading || memory.busy || !memory.ready || !deviceName.trim()} onClick={() => void memory.action(async () => { await memory.saveProfile(profile); })}>{t('保存设备档案', 'Save device profile')}</Button>
            <Button variant="secondary" size="sm" disabled={isLoading || memory.busy || !memory.ready} onClick={memory.newDiagnosis}>{t('新建诊断', 'New diagnosis')}</Button>
            <Button variant="ghost" size="sm" disabled={isLoading || memory.busy || !memory.deviceId} onClick={() => { if (window.confirm(t('删除此设备及其全部诊断记录？无法恢复。', 'Delete this device and all its diagnoses? This cannot be undone.'))) void memory.deleteDevice(); }}>{t('删除设备及记录', 'Delete device and records')}</Button>
          </div>
          <label className="mt-3 block text-xs">{t('本次检查进度（已检查项目、结果、待检查项）', 'Progress (checks done, results, remaining checks)')}<Textarea value={progress} maxLength={2000} onChange={(event) => setProgress(event.target.value)} disabled={isLoading || memory.busy || !memory.session} placeholder={t('例如：电瓶已检查正常；下一步检查接线。', 'Example: Battery checked, reported normal; wiring check pending.')} className="mt-1" rows={2} /></label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={isLoading || memory.busy || !memory.session || progress.trim() === memory.session.progress} onClick={() => void memory.saveProgress(progress)}>{t('保存检查进度', 'Save progress')}</Button>
            <Button variant="ghost" size="sm" disabled={isLoading || memory.busy || !memory.session} onClick={() => { if (window.confirm(t('删除本次诊断及检查进度？设备档案保留。', 'Delete this diagnosis and progress? Keep the device profile.'))) void memory.deleteDiagnosis(); }}>{t('删除本次诊断', 'Delete diagnosis')}</Button>
          </div>
          {memory.session?.summary && <details className="mt-3 text-xs"><summary className="cursor-pointer">{t('查看历史用户报告节选', 'Older user report excerpts')}</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{memory.session.summary}</p></details>}
          {memory.error && <p role="alert" className="mt-2 text-xs text-destructive">{memory.error}</p>}
          {!memory.ready && <Button variant="secondary" size="sm" className="mt-2" onClick={memory.retry}>{t('重试连接记忆', 'Retry memory connection')}</Button>}
        </div>
      </details>
    </div>
  );
}
