import { sceneFallbackCopy } from '@/lib/scene-fallback-copy';
import type { GraphicsReason } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';
import './scene-fallback.css';

export default function SceneFallback({
  kind,
  reason,
  hidden = false,
}: {
  kind: 'campus' | 'hall';
  reason: GraphicsReason;
  hidden?: boolean;
}) {
  const lang = useLang();
  const copy = sceneFallbackCopy(kind, reason, lang === 'zh' ? 'zh' : 'en');
  return (
    <div className="scene-fallback" role="img" aria-label={copy.title} aria-hidden={hidden || undefined} data-graphics={reason}>
      {kind === 'campus' ? <CampusPlan /> : <HallPlan />}
      <p className="scene-fallback-note" role="status">
        {reason === 'loading' && <i className="scene-fallback-ring" aria-hidden="true" />}
        {copy.note}
      </p>
    </div>
  );
}

function CampusPlan() {
  return (
    <svg className="scene-fallback-art" viewBox="0 0 720 420" aria-hidden="true">
      <rect width="720" height="420" rx="28" fill="color-mix(in srgb, var(--hub-card) 88%, var(--hub-primary))" />
      <ellipse cx="360" cy="214" rx="250" ry="150" fill="color-mix(in srgb, var(--hub-primary) 16%, var(--hub-background))" />
      <circle cx="360" cy="214" r="54" fill="none" stroke="var(--hub-primary)" strokeWidth="2" opacity="0.7" />
      <g fill="none" stroke="color-mix(in srgb, var(--hub-primary) 55%, white)" strokeWidth="3">
        <path d="M118 168c18 8 28 8 46 0M118 180c18 8 28 8 46 0M118 192c18 8 28 8 46 0" />
        <path d="M556 230c18 8 28 8 46 0M556 242c18 8 28 8 46 0M556 254c18 8 28 8 46 0" />
      </g>
      <path d="M150 92v28M150 92l16 8M150 92l-10 10" stroke="#85caff" strokeWidth="3" fill="none" />
      <path d="M560 300v28M560 300l16 8M560 300l-10 10" stroke="#e9bb76" strokeWidth="3" fill="none" />
      <Pavilion x={168} y={118} roof="flat" color="#85caff" label="01" />
      <Pavilion x={552} y={118} roof="dome" color="#e9bb76" label="02" />
      <Pavilion x={168} y={286} roof="saw" color="#83e1c1" label="03" />
      <Pavilion x={552} y={286} roof="lintel" color="#d2dce9" label="04" />
    </svg>
  );
}

function Pavilion({ x, y, roof, color, label }: { x: number; y: number; roof: 'flat' | 'dome' | 'saw' | 'lintel'; color: string; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="34" rx="62" ry="16" fill="color-mix(in srgb, var(--hub-background) 70%, black)" opacity="0.35" />
      <rect x="-46" y="-8" width="92" height="40" rx="6" fill="var(--hub-card)" stroke={color} strokeWidth="2" />
      {roof === 'flat' && <path d="M-54 -8h108l-8-16h-92z" fill={color} />}
      {roof === 'dome' && <ellipse cx="0" cy="-16" rx="40" ry="22" fill={color} />}
      {roof === 'saw' && <path d="M-50 -8l22-22 22 16 22-20 28 26h-94z" fill={color} />}
      {roof === 'lintel' && (
        <>
          <rect x="-34" y="-28" width="8" height="22" fill={color} />
          <rect x="26" y="-28" width="8" height="22" fill={color} />
          <rect x="-40" y="-34" width="80" height="8" fill={color} />
        </>
      )}
      <text x="0" y="18" textAnchor="middle" fill="var(--hub-foreground)" fontSize="14" fontFamily="sans-serif">{label}</text>
    </g>
  );
}

function HallPlan() {
  const zones = [
    { x: 70, y: 70, id: 'A', color: '#3ec6ff', name: '动力' },
    { x: 380, y: 70, id: 'B', color: '#7dffa8', name: '耕作' },
    { x: 70, y: 230, id: 'C', color: '#ffd36a', name: '收获' },
    { x: 380, y: 230, id: 'D', color: '#c9b6ff', name: '智慧' },
  ];
  return (
    <svg className="scene-fallback-art" viewBox="0 0 720 420" aria-hidden="true">
      <rect width="720" height="420" rx="28" fill="#d7e8f5" />
      <rect x="48" y="42" width="624" height="300" rx="16" fill="#eef6fb" stroke="#9fc4db" />
      <rect x="346" y="58" width="28" height="268" fill="#c5e4f6" />
      {zones.map((zone) => (
        <g key={zone.id} transform={`translate(${zone.x} ${zone.y})`}>
          <rect width="270" height="120" rx="12" fill="#f7fbfe" stroke={zone.color} strokeWidth="3" />
          <circle cx="48" cy="60" r="22" fill={zone.color} opacity="0.85" />
          <text x="48" y="66" textAnchor="middle" fill="#102033" fontSize="16" fontFamily="sans-serif">{zone.id}</text>
          <text x="86" y="56" fill="#1d3346" fontSize="16" fontFamily="sans-serif">{zone.name}</text>
          <rect x="86" y="70" width="70" height="22" rx="4" fill={zone.color} opacity="0.35" />
          <rect x="166" y="74" width="46" height="14" rx="3" fill="#243240" />
        </g>
      ))}
      <rect x="300" y="348" width="120" height="28" rx="4" fill="#d5e7f4" stroke="#8fb4cc" />
    </svg>
  );
}
