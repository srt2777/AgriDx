/** Conservative lexical guard, followed by structured evidence checks. It does not prove that arbitrary text is safe. */
const securityText = (text: string) => text.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, '');
export function dangerousRequest(text: string): boolean {
  const normalized = securityText(text);
  return /(?:绕过|屏蔽|禁用|短接|拆除|解除).{0,18}(?:保护|安全装置|传感器|限速|排放|ecu|联锁)|(?:短接|跨接).{0,12}(?:ecu|控制器)|(?:bypass|disable|override|defeat).{0,24}(?:safety|interlock|sensor|emission|speedlimit)|short.{0,12}(?:ecu|controller)/i.test(normalized);
}
export function suspiciousInstructions(text: string): boolean {
  return /(?:忽略|无视|覆盖|忘掉).{0,20}(?:之前|以上|系统|指令|规则)|(?:ignore|override|disregard).{0,30}(?:previous|prior|above|system|instructions)/i.test(securityText(text));
}
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\b1[3-9]\d{9}\b/g, '[手机号]').replace(/\b(?:sk|key)-[a-z0-9_-]{12,}\b/gi, '[密钥]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|api.?key|phone|address|location|owner|机主|位置|电话/i.test(key) ? '[已脱敏]' : redact(item)]));
  return value;
}
