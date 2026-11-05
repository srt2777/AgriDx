import HeroSection from './sections/HeroSection';
import PainPointsSection from './sections/PainPointsSection';
import MultimodalSection from './sections/MultimodalSection';
import ArchitectureSection from './sections/ArchitectureSection';
import SimulationSection from './sections/SimulationSection';
import TechRouteSection from './sections/TechRouteSection';
import ScenariosSection from './sections/ScenariosSection';
import ClosingSection from './sections/ClosingSection';
import KnowledgeCoverage from '@/components/KnowledgeCoverage';
import { ChevronDown } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './home-stage.css';

const HomeStage = lazy(() => import('./HomeStage'));

const CHAPTER_LINE = [
  '.hero-affiliation', '.hero-title', '.hero-description', '.hero-actions', '.hero-evidence-note', '.hero-stage-note',
  '.capability-item',
  '.section-heading', '.knowledge-path-step', '.knowledge-live-count', '.knowledge-preview-footer',
  '.challenge-intro', '.challenge-row',
  '.scenario-image', '.scenario-item',
  '.capability-details > summary',
  '.closing-panel',
].join(',');

/** Fade chapter copy in without touching scroll position or the fixed model stage. */
function useChapterReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.home-immersive');
    if (!root) return undefined;
    const beats = [...root.querySelectorAll<HTMLElement>('[data-home-beat]')];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      beats.forEach(beat => beat.classList.add('is-revealed'));
      return undefined;
    }
    beats.forEach(beat => {
      const matches = [...beat.querySelectorAll<HTMLElement>(CHAPTER_LINE)].filter(node => node.closest('[data-home-beat]') === beat);
      const lines = matches.filter(node => !matches.some(other => other !== node && other.contains(node)));
      lines.forEach((line, index) => {
        line.classList.add('chapter-line');
        line.style.setProperty('--chapter-i', String(index));
      });
    });
    root.setAttribute('data-chapter-motion', 'on');
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const arm = () => {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer?.unobserve(entry.target);
        });
      }, { threshold: 0.2, rootMargin: '0px 0px -6% 0px' });
      beats.forEach(beat => observer?.observe(beat));
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(arm); });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      root.removeAttribute('data-chapter-motion');
    };
  }, []);
}

export default function HomePage() {
  const location = useLocation();
  const lang = useLang();
  useChapterReveal();

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
      <div className="page-container" data-home-beat="details" data-home-side="center"><details className="capability-details"><summary><span>{lang === 'zh' ? '项目介绍' : 'About the project'}</span><ChevronDown size={20} /></summary><PainPointsSection /><TechRouteSection /><ScenariosSection /><ArchitectureSection /><SimulationSection /><MultimodalSection /><ClosingSection /></details></div>
    </div></MotionConfig>
  );
}
