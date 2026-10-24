import { Boxes, BarChart3, RefreshCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP: Record<string, typeof Boxes> = {
  Boxes,
  BarChart3,
  RefreshCcw,
};

export default function SimulationSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return (
    <section className="w-full py-16 md:py-20 bg-accent/20">
      <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-8">
        {/* 标题 */}
        <div className="section-heading mb-12">
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            {t('结构可探索，验证有边界。', 'Explore structure. Know the boundaries.')}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t(
              '三维结构展示帮助理解设备。有限元验证与数字孪生分别作为规划展示，当前模型不等同于机型专属工程模型，也未用于计算诊断结论。',
              'Interactive 3D helps explain structure. FEA and digital twins remain planned. The current visualization is not a model-specific engineering asset or a diagnostic simulation.',
            )}
          </p>
        </div>

        {/* 三卡片 */}
        <div className="grid gap-6 md:grid-cols-3">
          {content.SIMULATION_ITEMS.map((item, i) => {
            const Icon = ICON_MAP[item.icon] || Boxes;
            return (
              <motion.div
                key={pick(item.title, lang)}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Card className="h-full transition-all duration-300 hover:shadow-md hover:border-primary/30 hover:-translate-y-1">
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 font-serif text-lg font-semibold text-foreground">{pick(item.title, lang)}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{pick(item.desc, lang)}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
