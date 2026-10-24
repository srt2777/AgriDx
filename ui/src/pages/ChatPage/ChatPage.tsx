import { useUiCopy } from '@/ui/useUiCopy';
import type { DiagnosisMode } from '../../../../shared/diagnosis';
import { useRef, useEffect, useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Trash2, Loader2, Bot, User, Sparkles, Cpu, Square } from 'lucide-react';
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

import type { AnswerMode, ChatProvider, FallbackReason } from '@shared/chat';
import { MACHINE_TYPES_ZH, MACHINE_TYPES_EN } from '@/features/chat/session';
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
  const { t, format, separator } = useUiCopy(lang);
  const providerLabel = (provider?: ChatProvider) =>
    provider === 'knowledge-base' ? t('本地知识库', 'Local knowledge base') :
    provider === 'gemini' ? 'Gemini' : provider === 'deepseek' ? 'DeepSeek' : '';
  const answerModeLabel = (mode?: AnswerMode) =>
    mode === 'knowledge-grounded' ? t('知识库依据 + LLM', 'Knowledge-grounded LLM answer') :
    mode === 'general-guidance' ? t('LLM 通用建议 · 需核实', 'General LLM guidance · verify applicability') :
    mode === 'local-evidence' ? t('本地资料答复', 'Local evidence answer') : '';
  const fallbackLabel = (reason?: FallbackReason) =>
    reason === 'not_configured' ? t('LLM 未配置，仅使用本地资料', 'LLM not configured; using local evidence') :
    reason === 'provider_unavailable' ? t('模型服务暂不可用，已使用本地资料', 'Model service unavailable; using local evidence') : '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback(() => textareaRef.current?.focus(), []);
  const {
    messages, input, setInput, isLoading, currentModel, currentProvider, currentFallbackReason,
    machineType, setMachineType, brand, setBrand, model, setModel,
    sendMessage, stopRequest, handleClear, memory, profile,
    diagnosisMode, setDiagnosisMode, deviceName, setDeviceName, hours, setHours, deviceNotes, setDeviceNotes, progress, setProgress,
  } = useChatSession({ handoff, translate: t, focusInput, minLoadingMs: version === 'new' && PREMIUM_MOTION_ENABLED ? 900 : 0 });
  const orb = useDiagnosisOrb(PREMIUM_MOTION_ENABLED && version === 'new' && isLoading);
  useUpdateBlocker('/chat', isLoading || memory.busy || !memory.ready || !!input.trim()
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => {
    if (version === 'old' && messages.length === 0) return;
    scrollToBottom();
  }, [messages, scrollToBottom, version]);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(version === 'old' ? { preventScroll: true } : undefined), 100);
    return () => window.clearTimeout(timer);
  }, [version]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const handleQuickQuestion = useCallback(
    (question: string) => {
      sendMessage(question);
    },
    [sendMessage],
  );

  const isEmpty = messages.length === 0;
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
            <div className="truncate text-sm font-semibold text-foreground" data-shared-target={version === 'new' ? 'diagnosis' : undefined}>{format('耕知·耘诊')}{separator}{t('诊断工作台', 'Diagnosis workspace')}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <span title={configurationHint}>{serviceStatus}</span>
              {currentProvider && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/60 px-1.5 py-0.5 text-[11px] text-foreground">
                  <Cpu className="h-3 w-3 text-primary" />
                  {providerLabel(currentProvider)}
                </span>
              )}
              {currentModel && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  {currentModel}
                </span>
              )}
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
          <AlertDialogContent portalContainer={version === 'old' ? document.querySelector<HTMLElement>('.classic-version-shell .fluid-body') ?? undefined : undefined}>
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
      <div className={version === 'new' ? 'chat-workspace' : 'flex min-h-0 flex-1 flex-col'}>
      <div className={version === 'new' ? 'chat-thread' : 'contents'}>
      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label={t('诊断对话', 'Diagnosis conversation')} aria-live="polite">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
              {version !== 'new' && <details className="fluid-machine-context"><summary>{t('机具信息与诊断记忆', 'Machine details & memory')}</summary><MachineContext framed {...contextProps} /></details>}

          {/* 空状态 / 欢迎态 */}
          {isEmpty && (
            <div className="chat-empty flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex items-center justify-center">
                {version === 'new' && PREMIUM_MOTION_ENABLED
                  ? <ThinkingOrbs state="listening" label={t('待命', 'Listening')} />
                  : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-7 w-7" /></span>}
              </div>
              <h2 className="font-serif text-xl font-bold text-foreground">{version === 'new' ? t('描述现象，从资料里找起点。', 'Describe the symptom. Start from the evidence.') : t('描述故障现象', 'Describe the fault')}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">{version === 'new' ? t('带上机型更好。回答依据是已索引资料，适用范围仍需核对。', 'A model helps. Answers follow indexed evidence, and scope still needs a check.') : t('可填写品牌、型号和发生工况。', 'Include the brand, model and operating conditions.')}</p>


              {/* 快捷提问按钮 */}
              <div className="mt-6 w-full">
                <div className="mb-3 text-xs font-medium text-wheat">{version === 'new' ? t('可以这样问', 'You can ask') : t('示例问题', 'Example questions')}</div>
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
                className={`min-w-0 break-words max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed md:max-w-[75%] ${
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
                  <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
                    {msg.coordinationMessage && <p className="text-xs text-muted-foreground">{msg.coordinationMessage}</p>}
                    <DeferredMarkdown>{msg.localSummary || msg.content}</DeferredMarkdown>
                    {msg.localSummary && <details className="chat-evidence mt-3"><summary className="cursor-pointer text-xs">{t('展开完整资料与适用限制', 'Full evidence and applicability')}</summary><div className="chat-evidence-body"><DeferredMarkdown>{msg.content}</DeferredMarkdown></div></details>}
                    {msg.role === 'assistant' && (msg.model || msg.provider || msg.answerMode || msg.fallbackReason || msg.knowledgeChunks !== undefined) && (
                      <div className="chat-source mt-2 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {msg.answerMode && <span>{answerModeLabel(msg.answerMode)}</span>}
                          {msg.knowledgeChunks !== undefined && <span>{t(`知识库命中 ${msg.knowledgeChunks} 条`, `${msg.knowledgeChunks} knowledge snippets retrieved`)}</span>}
                          {(msg.model || msg.provider) && <span>{[providerLabel(msg.provider), msg.model].filter(Boolean).join(separator)}</span>}
                        </div>
                        {msg.fallbackReason && <div className="mt-1">{fallbackLabel(msg.fallbackReason)}</div>}
                      </div>
                    )}
                  </div>
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
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={t('故障描述', 'Fault description')}
              aria-describedby="chat-input-help"
              aria-invalid={input.trim().length > 2000}
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
              disabled={!input.trim() || input.trim().length > 2000}
              className={version === 'new' && PREMIUM_MOTION_ENABLED ? 'shrink-0 glass-press' : 'shrink-0'}
              data-motion={version === 'new' && PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined}
              aria-label={t('发送', 'Send')}
            >
              <Send className="h-4 w-4" />
            </Button>}
          </div>
          <div id="chat-input-help" className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span>{t('按 Enter 发送，Shift + Enter 换行', 'Enter to send, Shift+Enter for newline')}</span>
            <span className={input.trim().length > 2000 ? 'text-destructive' : ''}>{input.trim().length} / 2000</span>
          </div>
        </form>
      </LiquidGlass>
      </div>
      {version === 'new' && (
        <aside className="chat-context" aria-label={t('机具上下文', 'Machine context')}>
          <MachineContext framed={false} {...contextProps} />
        </aside>
      )}
      </div>
    </div>
  );
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
  const version = useUiVersion();
  const separator = version === 'old' ? ' ' : ' · ';
  const [hud, setHud] = useState<'machine' | 'scope' | 'progress'>('machine');
  const plate = [machineType, brand, model].filter(Boolean).join(separator);
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
        <summary className="cursor-pointer text-sm font-medium">{t('诊断记忆', 'Diagnosis memory')}{separator}{memory.ready ? t('已连接', 'Connected') : t('未就绪', 'Not ready')}</summary>
        <div className="chat-evidence-body">
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__ ? t('开发预览的档案与对话仅保存在当前浏览器，清除网站数据会删除。检查结果是用户报告。', 'Preview profiles and chats stay in this browser. Clearing site data deletes them. Checks are user reports.') : t('档案与对话保存到后端，同一浏览器重新打开可继续。清除浏览器身份后无法自动恢复；检查结果是用户报告。', 'Profiles and chats are saved on the server for this browser. Clearing browser identity prevents automatic recovery; checks are user reports.')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select aria-label={t('选择设备档案', 'Select device profile')} value={memory.deviceId} disabled={isLoading || memory.busy || !memory.ready} onChange={(event) => memory.selectDevice(event.target.value)} className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm">
              <option value="">{t('新设备（独立档案）', 'New device (separate profile)')}</option>
              {memory.devices.map((device) => <option key={device.id} value={device.id}>{device.name}{separator}{device.model || device.brand}</option>)}
            </select>
            <select aria-label={t('继续历史诊断', 'Resume diagnosis')} value={memory.session?.id || ''} disabled={isLoading || memory.busy || !memory.ready} onChange={(event) => { if (event.target.value) void memory.restore(event.target.value); }} className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm">
              <option value="">{t('继续历史诊断…', 'Resume a diagnosis…')}</option>
              {memory.sessions.map((session) => <option key={session.id} value={session.id}>{memory.devices.find((device) => device.id === session.deviceId)?.name}{separator}{session.title}</option>)}
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
