import { useDiagnosticMemory } from '../../hooks/useDiagnosticMemory';
import { isRecord } from '../../lib/api-client';
import type { DeviceProfile, MemoryDevice, SessionDetail } from '../../../shared/memory';
import type { DiagnosisMode } from '../../../shared/diagnosis';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import type { ChatProvider, FallbackReason, ChatTelemetrySummary } from '../../../shared/chat';
import { requestChat } from './api';
import {
  createChatRequest, generateMessageId, loadChatSession, MAX_QUESTION_LENGTH,
  saveHistory, saveMachineContext, parseHistory, parseFaultCodes, composeDiagnosticQuestion, type ChatMessage, type DiagnosticTextAttachment,
} from './session';

interface ChatSessionOptions {
  handoff: unknown;
  translate: (zh: string, en: string) => string;
  focusInput: () => void;
  /** Keeps the loading row on screen long enough to read named orb states. */
  minLoadingMs?: number;
  telemetrySummary?: ChatTelemetrySummary;
}

/** Owns conversation lifecycle; the page renders the workspace and input controls. */
export function useChatSession({ handoff, translate: t, focusInput, minLoadingMs = 0, telemetrySummary }: ChatSessionOptions) {
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
      const reply = await requestChat(
        request,
        controller.signal,
        t('智能诊断服务暂时无法连接，请稍后重试。', 'AI service unavailable, please try again later.'),
      );
      // Stop, clear or unmount can invalidate this request while its body is being read.
      if (requestRef.current !== controller) return;
      const remain = Math.max(0, minLoadingMs - (performance.now() - started));
      if (remain > 0) await new Promise((resolve) => window.setTimeout(resolve, remain));
      if (requestRef.current !== controller) return;
      if (reply.memory) memory.updateSession(reply.memory);
      if (reply.role === 'error') {
        if (text === input) setInput(text);
        if (selectedAttachment) setAttachment(selectedAttachment);
      }
      setCurrentModel(reply.model || '');
      setCurrentProvider(reply.provider || '');
      setCurrentFallbackReason(reply.fallbackReason);
      setMessages((previous) => previous.map((message) => message.id === loadingMessage.id
        ? { id: message.id, ...reply } : message));
    } catch (error) {
      if (requestRef.current !== controller) return;
      resetStatus();
      if (submitted) setMessages((previous) => previous.map((message) => message.id === loadingMessage.id ? {
        id: message.id,
        role: 'error',
        content: t('对话请求未完成，请稍后重试；已有对话仍保留。', 'The chat request did not complete. Please retry; your previous messages are preserved.'),
      } : message));
      if (submitted && text === input) setInput(text);
      if (selectedAttachment) setAttachment(selectedAttachment);
      setSendError(error instanceof Error ? error.message : t('请求未完成，草稿已保留。', 'The request did not complete; your draft is preserved.'));
      toast.error(error instanceof Error && error.name !== 'AbortError' ? error.message : t('对话服务暂不可用', 'Chat service unavailable'));
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
        window.setTimeout(focusInput, 0);
      }
    }
  }, [messages, input, attachment, machineType, brand, model, engineModel, faultCodeInput, t, focusInput, resetStatus, memory, profile, diagnosisMode, minLoadingMs, telemetrySummary]);

  const stopRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setMessages((previous) => previous.filter((message) => message.role !== 'loading'));
    focusInput();
  }, [focusInput]);

  const handleClear = useCallback(async () => {
    stopRequest();
    try { await memory.clear(); } catch (error) { toast.error(error instanceof Error ? error.message : "清空失败"); return; }
    resetStatus();
    setMessages([]);
    toast.success(t('对话已清空', 'Chat cleared'));
  }, [stopRequest, resetStatus, t, memory]);

  return {
    messages, input, setInput, machineType, setMachineType, brand, setBrand, model, setModel,
    isLoading, currentModel, currentProvider, currentFallbackReason,
    sendMessage, stopRequest, handleClear, memory, profile,
    diagnosisMode, setDiagnosisMode, deviceName, setDeviceName, hours, setHours, deviceNotes, setDeviceNotes, progress, setProgress,
    engineModel, setEngineModel, faultCodeInput, setFaultCodeInput, attachment, setAttachment, sendError,
  };
}
