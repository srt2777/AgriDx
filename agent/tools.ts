/** Compatibility exports for the tool registry and executor. */
export type { InputSchema, Tool, ErrorType, ToolResult } from './tool-types';
export { ToolRegistry } from './tool-registry';
export { ToolExecutor } from './tool-executor';
export { calculator } from './calculator';
export { build_default_registry, registry } from './default-tools';
