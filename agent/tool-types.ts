export interface InputSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, InputSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: InputSchema;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; maxItems?: number;
}
export interface Tool {
  name: string; description: string; input_schema: InputSchema;
  func: (args: any, context?: { signal: AbortSignal }) => unknown;
  risk?: 'read' | 'write' | 'dangerous'; timeout_s?: number; max_output?: number;
}
export type ToolBusinessErrorCode = 'NOT_FOUND' | 'SESSION_UNAVAILABLE' | 'TOPIC_NOT_IDENTIFIED' | 'OUTPUT_TOO_LARGE';
/** Explicit failure from a trusted adapter; never infer failure from arbitrary tool data. */
export class ToolExecutionError extends Error {
  constructor(public readonly code: ToolBusinessErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = 'ToolExecutionError';
  }
}
export type ErrorType = 'UNKNOWN_TOOL' | 'INVALID_ARGS' | 'TIMEOUT' | 'CANCELLED' | 'PERMISSION_DENIED' | 'REPEATED_CALL' | 'TOOL_ERROR' | ToolBusinessErrorCode;
export interface ToolResult { ok: boolean; content: string; error_type: ErrorType | null; duration_ms: number }
