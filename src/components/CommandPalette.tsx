import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLang } from '@/hooks/useLang';
import { filterCommands, openCommandPalette } from '@/lib/command-routes';
import { beginSharedTransition } from '@/lib/shared-transition';
import './command-palette.css';

export function CommandButton({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <button
      type="button"
      className={`command-launch${className ? ` ${className}` : ''}`}
      aria-keyshortcuts="Control+K Meta+K"
      aria-label={lang === 'zh' ? '快速前往，Ctrl 或 Command K' : 'Quick navigation, Control or Command K'}
      onClick={() => openCommandPalette()}
    >
      <Search size={16} strokeWidth={1.5} />
    </button>
  );
}

/** Glass destination list for the new version. Ctrl/Cmd+K toggles it. */
export default function CommandPalette() {
  const lang = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(() => filterCommands(query), [query]);
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const openFromButton = () => setOpen(true);
    window.addEventListener('keydown', toggle);
    window.addEventListener('agridx-command-open', openFromButton);
    return () => {
      window.removeEventListener('keydown', toggle);
      window.removeEventListener('agridx-command-open', openFromButton);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function close() {
    setOpen(false);
    previousFocus.current?.focus();
  }

  function go(path: string) {
    if (location.pathname === path) {
      setOpen(false);
      previousFocus.current?.focus();
      return;
    }
    beginSharedTransition(null, () => {
      setOpen(false);
      navigate(path);
    });
  }

  if (!open) return null;
  const active = results[index];
  return createPortal(
    <div className="command-palette" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="command-palette-panel"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((value) => (results.length ? (value + 1) % results.length : 0));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((value) => (results.length ? (value - 1 + results.length) % results.length : 0));
          } else if (event.key === 'Home') {
            event.preventDefault();
            setIndex(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            setIndex(Math.max(0, results.length - 1));
          } else if (event.key === 'Enter' && active) {
            event.preventDefault();
            go(active.path);
          }
        }}
      >
        <p id={titleId} className="command-palette-title">{t('快速前往', 'Quick navigation')}</p>
        <label className="command-palette-field">
          <Search size={16} strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('大厅、展厅、目录、模型、诊断', 'Hub, hall, catalog, model, diagnosis')}
            aria-controls="command-results"
            aria-activedescendant={active ? `command-${active.id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="command-results" role="listbox" aria-label={t('目的地', 'Destinations')}>
          {results.map((item, itemIndex) => (
            <li key={item.id} role="presentation">
              <button
                type="button"
                id={`command-${item.id}`}
                role="option"
                aria-selected={itemIndex === index}
                className={itemIndex === index ? 'is-active' : undefined}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => go(item.path)}
              >
                <strong>{lang === 'zh' ? item.zh : item.en}</strong>
                <span>{lang === 'zh' ? item.hintZh : item.hintEn}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="command-empty">{t('没有匹配的去向', 'No matching destination')}</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
