import type { ChatKnowledgeSource, ChatRoleFlow, DiagnosisTrace } from './chat';
import type { CoordinationDecision, DiagnosticReply } from './diagnosis';
/** Business memory is user-reported data, never verified repair evidence. */
export interface DeviceProfile {
  name: string;
  machineType: string;
  brand: string;
  model: string;
  hours: number | null;
  notes: string;
}
export interface MemoryDevice extends DeviceProfile {
  id: string;
  updatedAt: string;
}
export interface MemoryMessage {
  diagnosticReply?: DiagnosticReply;
  knowledgeSources?: ChatKnowledgeSource[];
  coordination?: CoordinationDecision;
  diagnosisTrace?: DiagnosisTrace;
  roleFlow?: ChatRoleFlow;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  model?: string;
  provider?: 'gemini' | 'deepseek' | 'knowledge-base';
  localSummary?: string;
  coordinationMessage?: string;
  answerMode?: 'knowledge-grounded' | 'general-guidance' | 'local-evidence';
  fallbackReason?: 'not_configured' | 'provider_unavailable';
  knowledgeChunks?: number;
}
export interface MemorySession {
  id: string;
  deviceId: string;
  title: string;
  progress: string;
  summary: string;
  revision: number;
  updatedAt: string;
}
export interface SessionDetail extends MemorySession {
  device: MemoryDevice;
  messages: MemoryMessage[];
}
export interface MemoryOverview {
  devices: MemoryDevice[];
  sessions: MemorySession[];
}
export interface PriorDeviceReport {
  sessionId: string;
  updatedAt: string;
  question: string;
  progress: string;
}
