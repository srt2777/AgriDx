import { Database, Waves, GitMerge, Bot, Cpu, FileText, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP: Record<string, typeof Database> = {
  Database,
  Waves,
  GitMerge,
  Bot,
  Cpu,
  FileText,
};

export default function TechRouteSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return (
    <section id="techroute" className="w-full py-16 md:py-20" data-home-beat="techroute" data-home-side="start">
      <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-8">
        {/* 标题 */}
        <div className="section-heading mb-12">
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            {t('从“发生了什么”，走向“下一步”。', 'From “what happened” to “what comes next”.')}
          </h2>
        </div>

        {/* 横向时间轴 */}
        <div className="relative">
          {/* 桌面端时间线 */}
          <div className="hidden md:block overflow-x-auto pb-4">
            <div className="flex items-start min-w-[640px]">
              {content.TECH_ROUTE_STEPS.map((step, i) => {
                const Icon = ICON_MAP[step.icon] || Database;
                return (
                  <motion.div
                    key={pick(step.title, lang)}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                    className="relative flex flex-1 flex-col items-center text-center"
                  >
                    {/* 步骤圆点 */}
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary/30 bg-card shadow-sm z-10">
                      <Icon className="h-6 w-6 text-primary" />
                      <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                    </div>
                    {/* 连接线 */}
                    {i < content.TECH_ROUTE_STEPS.length - 1 && (
                      <div className="absolute left-1/2 top-7 h-0.5 w-full bg-gradient-to-r from-primary/40 via-border to-border" />
                    )}
                    <div className="mt-4 px-2">
                      <h3 className="font-serif text-sm font-semibold text-foreground">{pick(step.title, lang)}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{pick(step.desc, lang)}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* 移动端纵向时间线 */}
          <div className="md:hidden space-y-4">
            {content.TECH_ROUTE_STEPS.map((step, i) => {
              const Icon = ICON_MAP[step.icon] || Database;
              return (
                <motion.div
                  key={pick(step.title, lang)}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="relative flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-primary/30 bg-card">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <h3 className="font-serif text-sm font-semibold text-foreground">{pick(step.title, lang)}</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{pick(step.desc, lang)}</p>
                  </div>
                  {i < content.TECH_ROUTE_STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground/40" />}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
