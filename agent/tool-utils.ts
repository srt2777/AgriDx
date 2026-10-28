export const serialize = (value: unknown): string => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v) ?? 'null';
export function canonical(value: unknown): string {
  return serialize(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical((value as Record<string, unknown>)[k]))])) : value);
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /password|token|secret|key/i.test(k) ? '***' : redact(v)]));
  return value;
}
