import { publicAsset } from '@/lib/public-asset';
import { Tractor, Wheat, Factory, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP = { Tractor, Wheat, Factory };
export default function ScenariosSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  return (
    <section id="scenarios" className="w-full" data-home-beat="scenarios" data-home-side="start">
      <div className="page-container">
        <div className="section-heading mb-12">
          <h2>{t('面向真实的农业作业。', 'Made for agricultural work.')}</h2>
          <p className="mt-4">{t('以已整理的拖拉机资料为起点，逐步扩充品类。下列是诊断问题示例，实际覆盖范围请查看农机知识。', 'Start with the archived tractor documents and expand by machine type. The following are example questions; see the knowledge browser for actual coverage.')}</p>
        </div>
        <div className="scenario-layout">
          <figure className="scenario-image">
            <img src={publicAsset('images/agri-fields.webp')} alt={t('稻田与田间作业拖拉机的农业场景插图', 'Illustration of rice fields and a tractor at work')} width="1400" height="933" loading="lazy" />
            <figcaption>{t('农业作业场景示意 AI 生成', 'Agricultural scene illustration AI generated')}</figcaption>
          </figure>
          <div className="scenario-list">
            {content.SCENARIOS.map(scenario => {
              const Icon = ICON_MAP[scenario.icon as keyof typeof ICON_MAP] || Tractor;
              return <article key={pick(scenario.name, lang)} className="scenario-item">
                <div className="scenario-title"><Icon size={23} strokeWidth={1.5} /><h3>{pick(scenario.name, lang)}</h3></div>
                <p>{scenario.parts.map(p => pick(p, lang)).join(' ')}</p>
                <ul>{scenario.faults.map(f => <li key={pick(f, lang)}>{pick(f, lang)}</li>)}</ul>
              </article>;
            })}
            <Link to="/chat" className="scenario-link">{t('开始诊断', 'Start diagnosis')}<ArrowUpRight size={18} /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
