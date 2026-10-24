import { Moon, Sun } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { setTheme, useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

export default function ThemeSwitch({ className }: { className?: string }) {
  const theme = useTheme();
  const lang = useLang();
  const label = theme === 'dark'
    ? (lang === 'zh' ? '切换到浅色模式' : 'Use light theme')
    : (lang === 'zh' ? '切换到深色模式' : 'Use dark theme');
  return <button type="button" className={cn('theme-switch press-control', className)}
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    aria-label={label} title={label} data-theme-switch data-theme={theme}>
    {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
  </button>;
}
