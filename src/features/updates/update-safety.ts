import type { DeviceProfile } from '../../../shared/memory';

const guards = new Map<string, { route: string; blocked: boolean }>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function registerUpdateGuard(id: string, route: string, blocked: boolean) {
  guards.set(id, { route, blocked });
  notify();
  return () => { guards.delete(id); notify(); };
}

export function subscribeUpdateSafety(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function canAutoReload(route: string) {
  const active = [...guards.values()].filter(guard => guard.route === route);
  if (active.some(guard => guard.blocked)) return false;
  if (route === '/' || route === '/knowledge') return true;
  // Do not reload lazy protected pages before their safety guard has mounted.
  return (route === '/chat' || route === '/models' || route === '/fault-detection') && active.length > 0;
}

/** Read the live hash, not an effect's previous route during a navigation commit. */
export function canAutoReloadUrl(href: string) {
  try { return canAutoReload(new URL(href).hash.slice(1).split('?')[0] || '/'); }
  catch { return false; }
}

const emptyProfile: DeviceProfile = { name: '我的设备', machineType: '', brand: '', model: '', hours: null, notes: '' };
export function hasUnsavedProfile(profile: DeviceProfile, saved?: DeviceProfile) {
  const baseline = saved ?? emptyProfile;
  return (Object.keys(emptyProfile) as (keyof DeviceProfile)[]).some(key => profile[key] !== baseline[key]);
}
