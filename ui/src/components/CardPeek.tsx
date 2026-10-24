import type { TractorComponent } from '@/components/tractor-model-info';

export function KnowledgePeek({ kind, caption }: { kind: 'archive' | 'learning'; caption: string }) {
  return (
    <span className="card-peek">
      <svg viewBox="0 0 120 52" aria-hidden="true">
        <path d="M8 40h104M18 14h28M18 22h40" fill="none" stroke="currentColor" strokeWidth="1.2" />
        {kind === 'learning' ? (
          <path d="M78 28c-3-10-10-10-12-2 6 0 9 2 12 2zm0 0c-3 10-10 10-12 2 6 0 9-2 12-2zm0 0c3-10 10-10 12-2-6 0-9 2-12 2zm0 0c3 10 10 10 12 2-6 0-9-2-12-2z" fill="none" stroke="currentColor" strokeWidth="1.1" />
        ) : (
          <path d="M70 10h28v28H70zM74 16h20M74 22h14" fill="none" stroke="currentColor" strokeWidth="1.1" />
        )}
      </svg>
      <em>{caption}</em>
    </span>
  );
}

const SKETCH: Record<TractorComponent, string> = {
  all: 'M8 34h80M16 34v-8h28l10-10h18v18',
  body: 'M14 32h64M22 32V20h24l8-8h16v20',
  engine: 'M28 30h36v-12H28zM34 18V12h10M52 18V12',
  drivetrain: 'M12 28h72M20 28v8M68 28v8M24 36h12M60 36h12',
  hydraulics: 'M18 30h40M58 30l16-8M58 30l16 8M18 30v-10',
  electrical: 'M24 34h48M32 34V18h8v8M56 34V16h6',
  wheels: 'M28 28a10 10 0 1 0 .1 0M72 26a14 14 0 1 0 .1 0M38 28h20',
  cab: 'M30 34V16h28v18M34 20h20v8H34z',
};

export function ModelPeek({ id, caption }: { id: TractorComponent; caption: string }) {
  return (
    <span className="model-peek">
      <svg viewBox="0 0 96 48" aria-hidden="true">
        <path d={SKETCH[id]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <em>{caption}</em>
    </span>
  );
}
