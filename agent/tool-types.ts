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
export type ErrorType = 'UNKNOWN_TOOL' | 'INVALID_ARGS' | 'TIMEOUT' | 'CANCELLED' | 'PERMISSION_DENIED' | 'REPEATED_CALL' | 'TOOL_ERROR';
export interface ToolResult { ok: boolean; content: string; error_type: ErrorType | null; duration_ms: number }
