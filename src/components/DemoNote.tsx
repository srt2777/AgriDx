import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { demoNoteCopy } from '@/lib/demo-note-copy';
import { openShortcuts } from '@/lib/delight';
import './demo-note.css';

export default function DemoNote() {
  const lang = useLang();
  const copy = demoNoteCopy(lang === 'zh' ? 'zh' : 'en');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      const note = panel.current;
      if (!anchor || !note) return;
      const width = note.offsetWidth;
      const height = note.offsetHeight;
      let left = anchor.right - width;
      if (left < 16) left = 16;
      if (left + width > window.innerWidth - 16) left = Math.max(16, window.innerWidth - width - 16);
      let top = anchor.bottom + 8;
      if (top + height > window.innerHeight - 12) top = Math.max(12, anchor.top - height - 8);
      note.style.left = `${left}px`;
      note.style.top = `${top}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="demo-note" ref={root}>
      <button
        type="button"
        ref={button}
        className="demo-note-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={lang === 'zh' ? '帮助与演示说明' : 'Help and demo information'}
        onClick={() => setOpen((current) => !current)}
      >
        <Info size={16} />

      </button>
      {open && createPortal(
        <div className="demo-note-panel" id={panelId} role="dialog" aria-label={copy.title} ref={panel}>

          <strong>{copy.title}</strong>
          {copy.points.map((point) => <p key={point}>{point}</p>)}
          <button type="button" className="demo-help-shortcuts" onClick={() => { setOpen(false); button.current?.focus(); openShortcuts(); }}>{lang === 'zh' ? '键盘快捷键与操作帮助' : 'Keyboard shortcuts and controls'}</button>
        </div>,
        document.querySelector('.new-version-shell') ?? document.body,
      )}
    </div>
  );
}
