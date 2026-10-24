import { useId, useLayoutEffect } from 'react';
import { registerUpdateGuard } from './update-safety';

/** Defer a release while the current page owns in-flight or unsaved work. */
export function useUpdateBlocker(route: string, blocked: boolean) {
  const id = useId();
  useLayoutEffect(() => registerUpdateGuard(id, route, blocked), [id, route, blocked]);
}
