import { AlertTriangle, Brain, ScanLine, ArrowUpRight } from 'lucide-react';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP = { AlertTriangle, Brain, ScanLine };
export default function PainPointsSection() {
  const lang = useLang();
  return (
    <section id="painpoints" className="w-full" data-home-beat="painpoints" data-home-side="start">
      <div className="page-container">
        <div className="challenge-layout">
          <div className="challenge-intro">
            <h2>{lang === 'zh' ? '从维修现场的问题出发。' : 'Built around real repair work.'}</h2>
            <p>{lang === 'zh' ? '让分散的维修知识，成为有依据、可追溯的诊断建议。' : 'Turn scattered repair knowledge into grounded, traceable diagnostic guidance.'}</p>
            <ArrowUpRight size={36} strokeWidth={1} aria-hidden="true" />
          </div>
          <div className="challenge-list">
            {content.PAIN_POINTS.map((item) => {
              const Icon = ICON_MAP[item.icon as keyof typeof ICON_MAP] || AlertTriangle;
              return <article className="challenge-row" key={pick(item.title, lang)}>
                <Icon size={23} strokeWidth={1.5} />
                <div><h3>{pick(item.title, lang)}</h3><p>{pick(item.desc, lang)}</p></div>
              </article>;
            })}
          </div>
        </div>
        <dl className="implementation-strip">
          {content.CAPABILITY_STATS.map(stat => <div key={pick(stat.label, lang)}><dt>{pick(stat.label, lang)}</dt><dd>{pick(stat.value, lang)}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}
