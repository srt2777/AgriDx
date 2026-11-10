import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  describeVoiceError, pickRecordingMimeType, requestVoiceStatus, requestVoiceStt,
  requestVoiceTts, truncateSpeechText,
  VOICE_MAX_RECORD_SECONDS, VOICE_MIN_RECORD_SECONDS, VOICE_SPEAK_MAX_CHARS,
} from './voice-api';

export interface ChatVoiceOptions {
  translate: (zh: string, en: string) => string;
  /** Called with the recognised text; ChatPage puts it in the composer for review before sending. */
  onTranscript: (text: string) => void;
}

/**
 * Web voice input + spoken replies for ChatPage (both UI versions share it).
 *
 * Recording is tap-to-start / tap-to-stop (not press-and-hold: on the web
 * hold conflicts with text selection and touch scrolling). Recording caps
 * at 30 s and auto-stops with a notice. STT fills the composer — nothing
 * is sent automatically. Only turns the user started from a voice draft
 * are read aloud afterwards (beginVoiceTurn marks the turn; the reply is
 * spoken when useChatSession reports it settled). Playback is one shared
 * <audio> element: starting a new turn, clearing, or unmounting stops it.
 * If the browser blocks autoplay after the async turn completes, the
 * failure is shown inline and the replay button stays available.
 */
export function useChatVoice({ translate: t, onTranscript }: ChatVoiceOptions) {
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [spokenMessageIds, setSpokenMessageIds] = useState<ReadonlySet<string>>(new Set());
  const [ttsFailedMessageId, setTtsFailedMessageId] = useState<string | null>(null);
  const [ttsTruncatedMessageId, setTtsTruncatedMessageId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const sttControllerRef = useRef<AbortController | null>(null);
  const ttsControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const pendingVoiceReplyRef = useRef(false);
  const callbacksRef = useRef({ onTranscript });
  callbacksRef.current = { onTranscript };

  // Voice needs both a recorder and the server routes (stacked on #249);
  // when either is missing the mic stays hidden instead of failing later.
  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || typeof navigator === 'undefined'
      || !navigator.mediaDevices?.getUserMedia) {
      setVoiceSupported(false);
      return;
    }
    const controller = new AbortController();
    requestVoiceStatus(controller.signal).then(
      () => { if (!controller.signal.aborted) setVoiceSupported(true); },
      () => { if (!controller.signal.aborted) setVoiceSupported(false); },
    );
    return () => controller.abort();
  }, []);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlayingMessageId(null);
  }, []);

  // Unmount (route change included): never leave audio playing or a
  // recorder / request running behind the page.
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    sttControllerRef.current?.abort();
    ttsControllerRef.current?.abort();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* Already stopped; nothing to clean up. */ }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const audio = audioRef.current;
    if (audio) audio.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const finishRecording = useCallback(async (audio: Blob, elapsedSeconds: number) => {
    if (elapsedSeconds < VOICE_MIN_RECORD_SECONDS) {
      toast.error(t('录音太短，请再说一次', 'Recording too short, please try again'));
      return;
    }
    const controller = new AbortController();
    sttControllerRef.current = controller;
    setIsTranscribing(true);
    try {
      const result = await requestVoiceStt(audio, controller.signal);
      if (controller.signal.aborted) return;
      const text = result.text.trim();
      if (!text) {
        toast.error(t('没听清，请再说一次', 'Could not hear you, please try again'));
        return;
      }
      callbacksRef.current.onTranscript(text);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = describeVoiceError(error);
      if (message) toast.error(message);
    } finally {
      if (sttControllerRef.current === controller) sttControllerRef.current = null;
      setIsTranscribing(false);
    }
  }, [t]);

  const stopRecording = useCallback((auto = false) => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setIsRecording(false);
    if (auto) toast(t('已到 30 秒上限，录音已停止', '30-second limit reached, recording stopped'));
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing) return;
    stopPlayback();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message = describeVoiceError(error);
      if (message) toast.error(message);
      return;
    }
    const mimeType = pickRecordingMimeType((mime) => MediaRecorder.isTypeSupported(mime));
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      toast.error(t('当前浏览器不支持录音，请使用最新版 Chrome 或 Edge', 'This browser cannot record audio; use the latest Chrome or Edge'));
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void finishRecording(audio, elapsed);
    };
    recorderRef.current = recorder;
    streamRef.current = stream;
    startedAtRef.current = performance.now();
    setRecordSeconds(0);
    setIsRecording(true);
    recorder.start(250);
    timerRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      setRecordSeconds(elapsed);
      if (elapsed >= VOICE_MAX_RECORD_SECONDS) stopRecordingRef.current(true);
    }, 200);
  }, [isRecording, isTranscribing, stopPlayback, finishRecording, t]);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording(false);
    else void startRecording();
  }, [isRecording, stopRecording, startRecording]);

  /** Synthesize and play one reply; returns false when speech failed (text stays visible). */
  const speakText = useCallback(async (messageId: string, text: string): Promise<boolean> => {
    const { text: spoken, truncated: clientTruncated } = truncateSpeechText(text, VOICE_SPEAK_MAX_CHARS);
    if (!spoken) return false;
    stopPlayback();
    const controller = new AbortController();
    ttsControllerRef.current = controller;
    try {
      const result = await requestVoiceTts(spoken, controller.signal);
      if (controller.signal.aborted) return false;
      const truncated = clientTruncated || result.truncated;
      setTtsTruncatedMessageId((previous) => (truncated ? messageId : previous === messageId ? null : previous));
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(result.audio);
      audioUrlRef.current = url;
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        audio.addEventListener('ended', () => setPlayingMessageId(null));
        audio.addEventListener('error', () => setPlayingMessageId(null));
        audioRef.current = audio;
      }
      audio.src = url;
      try {
        await audio.play();
      } catch {
        // Autoplay blocked after the async turn (no user gesture left):
        // keep the text, offer replay, and say so inline.
        setTtsFailedMessageId(messageId);
        setSpokenMessageIds((previous) => new Set(previous).add(messageId));
        return false;
      }
      setPlayingMessageId(messageId);
      setSpokenMessageIds((previous) => new Set(previous).add(messageId));
      setTtsFailedMessageId((previous) => (previous === messageId ? null : previous));
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      setTtsFailedMessageId(messageId);
      const message = describeVoiceError(error);
      if (message) toast.error(message);
      return false;
    } finally {
      if (ttsControllerRef.current === controller) ttsControllerRef.current = null;
    }
  }, [stopPlayback]);

  /** Mark the turn being submitted as voice-initiated: its reply gets spoken. */
  const beginVoiceTurn = useCallback(() => {
    stopPlayback();
    pendingVoiceReplyRef.current = true;
  }, [stopPlayback]);

  const cancelPendingSpeech = useCallback(() => {
    pendingVoiceReplyRef.current = false;
    stopPlayback();
  }, [stopPlayback]);

  /** Called by useChatSession when a turn settles; speaks only voice turns. */
  const handleTurnSettled = useCallback((messageId: string, role: 'assistant' | 'error', content: string) => {
    const pending = pendingVoiceReplyRef.current;
    pendingVoiceReplyRef.current = false;
    if (!pending || role !== 'assistant' || !content.trim()) return;
    void speakText(messageId, content);
  }, [speakText]);

  const replayReply = useCallback((messageId: string, text: string) => {
    void speakText(messageId, text);
  }, [speakText]);

  const hasVoiceControls = useCallback((messageId: string) => (
    spokenMessageIds.has(messageId) || ttsFailedMessageId === messageId
  ), [spokenMessageIds, ttsFailedMessageId]);

  return {
    voiceSupported, isRecording, recordSeconds, isTranscribing,
    playingMessageId, spokenMessageIds, ttsFailedMessageId, ttsTruncatedMessageId,
    toggleRecording, stopPlayback, beginVoiceTurn, cancelPendingSpeech,
    handleTurnSettled, replayReply, hasVoiceControls,
  };
}
