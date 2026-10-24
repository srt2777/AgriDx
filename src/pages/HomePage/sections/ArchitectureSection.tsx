import { Layers, Cpu, Network, ShieldCheck, ArrowDown } from 'lucide-react';
import { motion } from 'framer-motion';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP: Record<string, typeof Layers> = {
  Layers,
  Network,
  Cpu,
  ShieldCheck,
};

export default function ArchitectureSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return (
    <section id="architecture" className="w-full py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-8">
        {/* 标题 */}
        <div className="section-heading mb-12">
          <div className="section-eyebrow">{t('耕知 耘诊如何工作', 'How Gengzhi Yunzhen Works')}</div>
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            {t('把每条建议，连回资料依据。', 'Connect every recommendation to evidence.')}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t(
              '输入机况、检索适用知识、组织诊断建议，并区分本地证据与模型通用建议。诊断效果仍需现场与人工复核。',
              'Describe operating conditions, retrieve applicable knowledge, and organize guidance while distinguishing local evidence from general model advice. Outcomes still require on-site review.',
            )}
          </p>
        </div>

        {/* 架构图 - 纵向四层 */}
        <div className="architecture-flow mx-auto max-w-3xl space-y-4">
          {content.ARCHITECTURE_LAYERS.map((layer, i) => {
            const Icon = ICON_MAP[layer.icon] || Layers;
            const isWheat = i % 2 === 1;
            const color = isWheat ? 'bg-wheat/10 text-wheat-foreground' : 'bg-primary/10 text-primary';
            return (
              <motion.div
                key={pick(layer.name, lang)}
                initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative"
              >
                <div className="flex items-start gap-4 rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/30">
                  {/* 标号 */}
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-center">
                    <span className="font-serif text-lg font-bold text-primary">{layer.index}</span>
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-md ${color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <h3 className="font-serif text-lg font-semibold text-foreground">{pick(layer.name, lang)}</h3>
                      <span className="text-xs text-muted-foreground">{pick(layer.desc, lang)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                      {layer.points.map((p) => (
                        <div
                          key={pick(p, lang)}
                          className="flex items-center gap-1.5 rounded-md bg-accent/50 px-2.5 py-1.5 text-xs text-foreground"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                          {pick(p, lang)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 箭头连接 */}
                {i < content.ARCHITECTURE_LAYERS.length - 1 && (
                  <div className="absolute -bottom-5 left-1/2 flex h-6 -translate-x-1/2 items-center justify-center text-muted-foreground/50 z-10">
                    <ArrowDown className="h-5 w-5" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
