import { useDiagnosticMemory } from '../../hooks/useDiagnosticMemory';
import { isRecord } from '../../lib/api-client';
import type { DeviceProfile, MemoryDevice, SessionDetail } from '../../../shared/memory';
import type { DiagnosisMode } from '../../../shared/diagnosis';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import type { ChatProvider, FallbackReason, ChatTelemetrySummary } from '../../../shared/chat';
import { requestChatStream } from './api';
import {
  createChatRequest, generateMessageId, loadChatSession, MAX_QUESTION_LENGTH,
  saveHistory, saveMachineContext, parseHistory, parseFaultCodes, composeDiagnosticQuestion, classifyChatSendFailure, type ChatMessage, type DiagnosticTextAttachment,
} from './session';

interface ChatSessionOptions {
  handoff: unknown;
  translate: (zh: string, en: string) => string;
  focusInput: () => void;
  /** Keeps the loading row on screen long enough to read named orb states. */
  minLoadingMs?: number;
  telemetrySummary?: ChatTelemetrySummary;
  /**
   * Called with the final reply of each settled turn (assistant or error).
   * ChatPage uses it to speak voice-initiated turns; text turns ignore it.
   */
  onTurnSettled?: (turn: { messageId: string; role: 'assistant' | 'error'; content: string }) => void;
}

/** Owns conversation lifecycle; the page renders the workspace and input controls. */
export function useChatSession({ handoff, translate: t, focusInput, minLoadingMs = 0, telemetrySummary, onTurnSettled }: ChatSessionOptions) {
  const [initial] = useState(() => loadChatSession(handoff));
  const [messages, setMessages] = useState(initial.messages);
  const [input, setInput] = useState(initial.draft);
  const [machineType, setMachineType] = useState(initial.context.machineType);
  const [brand, setBrand] = useState(initial.context.brand);
  const [model, setModel] = useState(initial.context.model);
  const [engineModel, setEngineModel] = useState(initial.context.engineModel || '');
  const [faultCodeInput, setFaultCodeInput] = useState(initial.context.faultCodes?.join('、') || '');
  const [attachment, setAttachment] = useState<DiagnosticTextAttachment>();
  const [sendError, setSendError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState<ChatProvider | ''>('');
  const [currentFallbackReason, setCurrentFallbackReason] = useState<FallbackReason | undefined>();
  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>('auto');
  const [deviceName, setDeviceName] = useState('我的设备');
  const [hours, setHours] = useState('');
  const [deviceNotes, setDeviceNotes] = useState('');
  const [progress, setProgress] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  /** Id of the loading row currently receiving streamed text, so Stop can remove the partial preview. */
  const streamingMessageIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  useEffect(() => saveHistory(messages), [messages]);
  useEffect(() => {
    let faultCodes: string[] = [];
    try { faultCodes = parseFaultCodes(faultCodeInput); } catch { /* Keep invalid input editable, never send it. */ }
    saveMachineContext({ machineType, brand, model, engineModel, faultCodes });
  }, [machineType, brand, model, engineModel, faultCodeInput]);

  const resetStatus = useCallback(() => {
    setCurrentModel('');
    setCurrentProvider('');
    setCurrentFallbackReason(undefined);
  }, []);

  const onRestore = useCallback((detail: SessionDetail | null) => {
    requestRef.current?.abort(); requestRef.current = null; setIsLoading(false);
    setMessages(parseHistory(detail?.messages || [])); setProgress(detail?.progress || ''); resetStatus();
    setAttachment(undefined); setSendError('');
    // Engine/codes are diagnosis inputs, not verified facts about another device.
    setEngineModel(''); setFaultCodeInput('');
  }, [resetStatus]);
  const onDevice = useCallback((device: MemoryDevice | null) => {
    setDeviceName(device?.name || '我的设备'); setHours(device?.hours === null || !device ? '' : String(device.hours));
    setDeviceNotes(device?.notes || '');
    setMachineType(device?.machineType || ''); setBrand(device?.brand || ''); setModel(device?.model || '');
  }, []);
  const resumeOnBoot = !(isRecord(handoff) && ['machineType', 'brand', 'model', 'question'].some(key => typeof handoff[key] === 'string'));
  const memory = useDiagnosticMemory(onRestore, onDevice, resumeOnBoot);
  const profile: DeviceProfile = useMemo(() => ({ name: deviceName.trim(), machineType, brand: brand.trim(), model: model.trim(), hours: hours.trim() ? Number(hours) : null, notes: deviceNotes.trim() }), [deviceName, machineType, brand, model, hours, deviceNotes]);

  const sendMessage = useCallback(async (text: string, includeAttachment = true) => {
    // PR2 recovery gate: while a turn is unsaved (or its save outcome is
    // unknown), no new question may be sent along the out-of-sync record —
    // not from the input box, a quick follow-up, or any other trigger.
    // Editing the draft, copying and exporting stay available.
    if (memory.syncStatus !== 'synced') {
      setSendError(t('本轮未保存到诊断记录，继续发送已阻止；请先重新载入已保存记录，核对后再重新提交。', 'This turn was not saved to the diagnosis record, so further sending is blocked; reload the saved record and recheck it before resubmitting.'));
      return;
    }
    if (requestRef.current || memory.busy) return;
    const selectedAttachment = includeAttachment ? attachment : undefined;
    const trimmed = composeDiagnosticQuestion(text, selectedAttachment);
    if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH) {
      setSendError(t('描述与文本文件合计不能超过2000字符。', 'The description and text file must total no more than 2000 characters.'));
      return;
    }
    let faultCodes: string[];
    try { faultCodes = parseFaultCodes(faultCodeInput); }
    catch (error) { setSendError(error instanceof Error ? error.message : '故障码格式错误'); return; }
    setSendError('');
    const controller = new AbortController();
    requestRef.current = controller;
    const started = performance.now();
    // Leave time for sequential provider fallback and transport of the local answer.
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), 60_000);
    const userMessage: ChatMessage = { id: generateMessageId(), role: 'user', content: trimmed };
    const loadingMessage: ChatMessage = { id: generateMessageId(), role: 'loading', content: '' };
    streamingMessageIdRef.current = loadingMessage.id;
    setIsLoading(true);
    let submitted = false;
    try {
      // Validate/save the existing profile before consuming the user's draft.
      const session = memory.ready ? await memory.prepare(profile) : null;
      if (requestRef.current !== controller) return;
      controller.signal.throwIfAborted();
      const request = { ...createChatRequest(messages, trimmed, { machineType, brand, model, engineModel, faultCodes }, session?.revision === 0 ? 38 : 20), diagnosisMode,
        ...(telemetrySummary ? { telemetrySummary } : {}),
        ...(session ? { sessionId: session.id, revision: session.revision } : {}) };
      submitted = true;
      setMessages((previous) => [...previous, userMessage, loadingMessage]);
      if (text === input) setInput('');
      if (selectedAttachment) setAttachment(undefined);
      // Stream the answer: each delta turns the loading row into a live
      // assistant preview (the AI supplement before the answer guard, so
      // provisional). The `done` envelope below replaces the preview with
      // the guard-filtered final reply, exactly as the old non-streaming
      // response did. A plain JSON answer (no SSE) renders the same way,
      // with no deltas in between.
      let streamed = '';
      const reply = await requestChatStream(
        request,
        controller.signal,
        t('智能诊断服务暂时无法连接，请稍后重试。', 'AI service unavailable, please try again later.'),
        (text) => {
          streamed += text;
          const current = streamed;
          setMessages((previous) => previous.map((message) => message.id === loadingMessage.id
            ? { id: message.id, role: 'assistant', content: current } : message));
        },
      );
      // Stop, clear or unmount can invalidate this request while its body is being read.
      if (requestRef.current !== controller) return;
      const remain = Math.max(0, minLoadingMs - (performance.now() - started));
      if (remain > 0) await new Promise((resolve) => window.setTimeout(resolve, remain));
      if (requestRef.current !== controller) return;
      if (reply.memory) memory.updateSession(reply.memory, { clearsPendingForQuestion: trimmed });
      // The answer above is still shown; only its record was not saved.
      // Keep the old session revision (so the next turn can retry) and
      // tell the user the turn is missing from the stored record instead
      // of silently dropping it from server-side history. From here on the
      // turn is a pending unsaved copy: further sends are blocked until the
      // saved record is reloaded and the question is resubmitted.
      if (reply.memorySaveFailed) {
        memory.markSaveFailed(trimmed, reply.content);
        setSendError(t('本轮未保存到诊断记录；回答仍保留在页面上，继续发送已阻止，请重新载入已保存记录后再重新提交。', 'This turn was not saved to the diagnosis record; the answer is still shown, further sending is blocked, please reload the saved record before resubmitting.'));
      }
      if (reply.role === 'error') {
        if (text === input) setInput(text);
        if (selectedAttachment) setAttachment(selectedAttachment);
      }
      setCurrentModel(reply.model || '');
      setCurrentProvider(reply.provider || '');
      setCurrentFallbackReason(reply.fallbackReason);
      setMessages((previous) => previous.map((message) => message.id === loadingMessage.id
        ? { id: message.id, ...reply } : message));
      onTurnSettled?.({ messageId: loadingMessage.id, role: reply.role === 'error' ? 'error' : 'assistant', content: reply.content });
    } catch (error) {
      if (requestRef.current !== controller) return;
      resetStatus();
      // Report the real failure kind instead of the same generic row plus a
      // raw browser error: a transport failure used to surface as
      // "Failed to fetch" in a toast, a 60 s timeout as "Timeout", and both
      // were indistinguishable from a malformed response in the UI.
      const failureKind = classifyChatSendFailure(error);
      const failureMessage = failureKind === 'timeout'
        ? t('请求超时（60 秒），请求未完成，请稍后重试；已有对话仍保留。', 'The request timed out (60 seconds) and did not complete. Please retry; your previous messages are preserved.')
        : failureKind === 'transport'
          ? t('网络连接中断，请求未完成，请检查网络后重试；已有对话仍保留。', 'The network connection was interrupted and the request did not complete. Please check the network and retry; your previous messages are preserved.')
          : failureKind === 'invalid_response'
            ? t('服务器返回异常，请求未完成，请稍后重试；已有对话仍保留。', 'The server returned an invalid response and the request did not complete. Please retry; your previous messages are preserved.')
            : t('对话请求未完成，请稍后重试；已有对话仍保留。', 'The chat request did not complete. Please retry; your previous messages are preserved.');
      // A timeout or transport cut leaves the save outcome unknown: the
      // turn may already be saved on the server even though no answer
      // arrived. Never resend automatically — record the question as an
      // uncertain pending turn, block further sends, and let the reload
      // decide whether it was saved. The draft is still restored below.
      if (submitted && (failureKind === 'timeout' || failureKind === 'transport') && memory.session) {
        memory.markSaveUncertain(trimmed);
        setSendError(t('网络中断，保存结果未确认；请先重新载入已保存记录核对是否已保存，确认未保存后再重新提交，不要重复发送。', 'The network was interrupted and the save outcome is unconfirmed; reload the saved record first to check whether it was saved, and only resubmit after confirming it was not saved.'));
      }
      if (submitted) setMessages((previous) => previous.map((message) => message.id === loadingMessage.id ? {
        id: message.id,
        role: 'error',
        content: failureMessage,
      } : message));
      if (submitted) onTurnSettled?.({ messageId: loadingMessage.id, role: 'error', content: failureMessage });
      if (submitted && text === input) setInput(text);
      if (selectedAttachment) setAttachment(selectedAttachment);
      // The uncertain-save message above takes precedence over the generic
      // failure text: the user must recheck the record before resubmitting.
      if (!(submitted && (failureKind === 'timeout' || failureKind === 'transport') && memory.session)) setSendError(failureMessage);
      if (failureKind !== 'aborted') toast.error(failureMessage);
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        streamingMessageIdRef.current = null;
        setIsLoading(false);
        window.setTimeout(focusInput, 0);
      }
    }
  }, [messages, input, attachment, machineType, brand, model, engineModel, faultCodeInput, t, focusInput, resetStatus, memory, profile, diagnosisMode, minLoadingMs, telemetrySummary, onTurnSettled]);

  const stopRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    // A streamed preview already converted the loading row to an assistant
    // message; remove that partial preview as well as any loading row.
    const streamingId = streamingMessageIdRef.current;
    streamingMessageIdRef.current = null;
    setIsLoading(false);
    setMessages((previous) => previous.filter((message) => message.role !== 'loading' && message.id !== streamingId));
    focusInput();
  }, [focusInput]);

  const handleClear = useCallback(async () => {
    stopRequest();
    try { await memory.clear(); } catch (error) { toast.error(error instanceof Error ? error.message : "清空失败"); return; }
    resetStatus();
    setMessages([]);
    toast.success(t('对话已清空', 'Chat cleared'));
  }, [stopRequest, resetStatus, t, memory]);

  /** Reload the saved record; the pending question comes back as a draft for an explicit resubmission. */
  const recoverSavedRecord = useCallback(async () => {
    let result: Awaited<ReturnType<typeof memory.reloadSavedRecord>>;
    try { result = await memory.reloadSavedRecord(); } catch (error) {
      setSendError(error instanceof Error ? error.message : t('重新载入已保存记录失败，请稍后重试。', 'Reloading the saved record failed. Please try again.'));
      return;
    }
    if (!result) return;
    if (result.saved) {
      setSendError(t('已重新载入并核对：该轮已保存到诊断记录，无需重新提交。', 'Reloaded and checked: that turn was already saved to the diagnosis record, no resubmission needed.'));
    } else {
      setInput(result.turn.question);
      setSendError(t('已重新载入已保存记录，原问题已恢复为草稿；重新提交会生成新的回答，原回答不会自动保存到记录中。', 'The saved record has been reloaded and the original question restored as a draft; resubmitting will generate a new answer, and the original answer will not be saved to the record automatically.'));
    }
  }, [memory, t]);

  // Leaving the page while a turn is unsaved would lose the pending copy
  // when browser storage also failed; warn before the navigation happens.
  useEffect(() => {
    if (memory.syncStatus !== 'unsaved') return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [memory.syncStatus]);

  return {
    messages, input, setInput, machineType, setMachineType, brand, setBrand, model, setModel,
    isLoading, currentModel, currentProvider, currentFallbackReason,
    sendMessage, stopRequest, handleClear, memory, profile,
    syncStatus: memory.syncStatus, pendingTurn: memory.pendingTurn, pendingStorageFailed: memory.pendingStorageFailed,
    recoverSavedRecord, discardPendingTurn: memory.discardPendingTurn,
    diagnosisMode, setDiagnosisMode, deviceName, setDeviceName, hours, setHours, deviceNotes, setDeviceNotes, progress, setProgress,
    engineModel, setEngineModel, faultCodeInput, setFaultCodeInput, attachment, setAttachment, sendError,
  };
}
