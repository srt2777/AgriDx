import { Database, ShieldCheck, Box } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import TractorHero from './TractorHero';

/**
 * 旧版首页首屏：交互拖拉机 hero（重做版）。
 * 旧滚动舞台 HomeStage 不再挂载——它与交互 hero 是两个 WebGL 画布，
 * 同时存在会双倍加载模型并互相遮挡；HomeStage 文件本身未删除。
 */
export default function HeroSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return (
    <>
      <TractorHero />
      <div className="capability-strip page-container" data-home-beat="capabilities" aria-label={t('系统能力', 'Platform capabilities')}>
        {[
          { icon: Database, title: t('知识有依据', 'Grounded knowledge'), detail: t('本地维修资料辅助检索', 'Retrieval from local repair documents') },
          { icon: ShieldCheck, title: t('诊断可解释', 'Explainable diagnosis'), detail: t('原因分析与分步排查建议', 'Causes and step-by-step troubleshooting') },
          { icon: Box, title: t('结构可交互', 'Interactive structure'), detail: t('三维模型辅助理解机械结构', 'Explore machinery through a 3D model') },
        ].map(({ icon: Icon, title, detail }) => (
          <div className="capability-item" key={title}>
            <Icon size={21} strokeWidth={1.5} />
            <div><strong>{title}</strong><span>{detail}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}
