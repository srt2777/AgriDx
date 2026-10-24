import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { useTheme } from '@/hooks/useTheme';
import { useUiVersion } from '@/hooks/useUiVersion';
import 'sonner/dist/styles.css';

/** Sonner toasts follow the active theme. New-version glass is in delight.css. */
export function ThemedToaster() {
  const theme = useTheme();
  const version = useUiVersion();
  useEffect(() => {
    document.documentElement.dataset.uiVersion = version;
  }, [version]);
  return (
    <Toaster
      theme={theme}
      position="top-center"
      duration={3200}
      closeButton
      offset={16}
      toastOptions={{ className: 'nv-toast' }}
    />
  );
}
