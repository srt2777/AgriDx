import HeroSection from './sections/HeroSection';
import PainPointsSection from './sections/PainPointsSection';
import MultimodalSection from './sections/MultimodalSection';
import ArchitectureSection from './sections/ArchitectureSection';
import SimulationSection from './sections/SimulationSection';
import TechRouteSection from './sections/TechRouteSection';
import ScenariosSection from './sections/ScenariosSection';
import ClosingSection from './sections/ClosingSection';
import ResearchSection from './sections/ResearchSection';
import KnowledgeCoverage from '@/components/KnowledgeCoverage';
import { ChevronDown } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './home-stage.css';

const HomeStage = lazy(() => import('./HomeStage'));

export default function HomePage() {
  const location = useLocation();
  const lang = useLang();

  // 从其他页面跳回首页时，按导航传入的 scrollTo 滚动到对应区块（HashRouter 下不使用锚点 hash）
  useEffect(() => {
    const target = (location.state as { scrollTo?: string } | null)?.scrollTo;
    if (!target) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(target);
      const details = element?.closest('details');
      if (details) details.open = true;
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.state]);

  return (
    <MotionConfig reducedMotion="user"><div className="glass-home home-immersive min-h-screen">
      <Suspense fallback={null}><HomeStage /></Suspense>
      <HeroSection />
      <KnowledgeCoverage />
      <div className="page-container"><details className="capability-details"><summary><span>{lang === 'zh' ? '项目与研究' : 'Project and research'}</span><ChevronDown size={20} /></summary><ResearchSection /><PainPointsSection /><TechRouteSection /><ScenariosSection /><ArchitectureSection /><SimulationSection /><MultimodalSection /><ClosingSection /></details></div>
    </div></MotionConfig>
  );
}
