// POSIX paths for the read-only knowledge snapshot in the browser.
export const sep = '/';
export const isAbsolute = (value) => value.startsWith('/');
export function normalize(value) {
  const absolute = isAbsolute(value);
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || '.';
}
export const join = (...parts) => normalize(parts.filter(Boolean).join('/'));
export function resolve(...parts) {
  let result = '';
  for (const part of parts) result = isAbsolute(part) ? part : `${result}/${part}`;
  return normalize(result || '/');
}
export function relative(from, to) {
  const first = resolve(from).split('/').filter(Boolean);
  const second = resolve(to).split('/').filter(Boolean);
  let shared = 0;
  while (shared < Math.min(first.length, second.length) && first[shared] === second[shared]) shared++;
  return [...first.slice(shared).map(() => '..'), ...second.slice(shared)].join('/');
}
export default { sep, isAbsolute, normalize, join, resolve, relative };
