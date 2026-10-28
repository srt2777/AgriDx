/** Guard is deliberately conservative; it is not a substitute for source-grounding checks. */
export function dangerousRequest(text: string): boolean {
  return /(?:绕过|屏蔽|禁用|短接|拆除|解除).{0,18}(?:保护|安全装置|传感器|限速|排放|ecu|联锁)|(?:短接|跨接).{0,12}(?:ecu|控制器)/i.test(text);
}
export function suspiciousInstructions(text: string): boolean {
  return /(?:忽略|无视|覆盖|忘掉).{0,20}(?:之前|以上|系统|指令|规则)|(?:ignore|override|disregard).{0,30}(?:previous|system|instructions)/i.test(text);
}
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\b1[3-9]\d{9}\b/g, '[手机号]').replace(/\b(?:sk|key)-[a-z0-9_-]{12,}\b/gi, '[密钥]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|api.?key|phone|address|location|owner|机主|位置|电话/i.test(key) ? '[已脱敏]' : redact(item)]));
  return value;
}
