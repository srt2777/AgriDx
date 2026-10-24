import { useEffect, useState } from 'react';
import type { LlmHealth } from '../../../../shared/chat';
import { requestLlmHealth } from './api';

export function useLlmHealth() {
  const [health, setHealth] = useState<LlmHealth | 'checking' | 'unknown'>('checking');
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    let active = true;
    void requestLlmHealth(controller.signal).then(
      (result) => { if (active) setHealth(result); },
      () => { if (active) setHealth('unknown'); },
    ).finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  return health;
}
