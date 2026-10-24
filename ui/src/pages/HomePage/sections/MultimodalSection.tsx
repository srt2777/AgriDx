import { Activity, Volume2, Camera, Gauge, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

const ICON_MAP: Record<string, typeof Activity> = {
  Activity,
  Volume2,
  Camera,
  Gauge,
};

export default function MultimodalSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  return (
    <section id="multimodal" className="w-full py-16 md:py-20 bg-accent/30">
      <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-8">
        {/* 标题 */}
        <div className="section-heading mb-12">
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            {t('下一步，听见与看见机器。', 'Next, hear and see the machine.')}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t(
              '当前先把文本、机型与资料依据打通。声音、振动、视觉和运行参数是后续研究方向，接入与效果须逐项验证。',
              'Today, symptoms, machine identity and documents form the starting point. Sound, vibration, vision and telemetry are research directions; integration and outcomes require validation.',
            )}
          </p>
        </div>

        {/* 四卡片 */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {content.MULTIMODAL_SIGNALS.map((signal, i) => {
            const Icon = ICON_MAP[signal.icon] || Activity;
            const isWheat = signal.icon === 'Volume2' || signal.icon === 'Gauge';
            const color = isWheat ? 'text-wheat' : 'text-primary';
            const bg = isWheat ? 'bg-wheat/10' : 'bg-primary/10';
            return (
              <motion.div
                key={pick(signal.name, lang)}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Card className="group h-full transition-all duration-300 hover:shadow-md hover:border-primary/30 hover:-translate-y-1">
                  <CardContent className="p-6">
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-md ${bg} ${color}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 font-serif text-lg font-semibold text-foreground">{pick(signal.name, lang)}</h3>
                    <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{pick(signal.desc, lang)}</p>
                    <div className="flex items-center gap-1.5 border-t border-border/50 pt-3 text-xs text-primary">
                      <Zap className="h-3.5 w-3.5" />
                      {pick(signal.value, lang)}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* 融合价值说明 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-10 rounded-xl border border-border/60 bg-card p-6 text-center shadow-sm md:p-8"
        >
          <div className="mb-3 text-sm font-medium text-wheat">{t('当前能力与边界', 'Current capability & boundaries')}</div>
          <p className="font-serif text-lg font-semibold text-foreground md:text-xl">
            {t(
              '当前版本以故障文本诊断为主：本地知识库分块检索 + 大模型推理，多模态感知为规划方向',
              'Current version focuses on text diagnosis: local KB chunk retrieval + LLM inference; multimodal sensing is a planned direction.',
            )}
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            {t(
              '技术链路：Markdown 知识库按章节切块 → 中文关键词召回（top-K）→ 注入系统提示约束模型仅依据知识库作答 → 结构化输出诊断建议。暂无传感器接入、无注意力/图卷积等模型，相关指标以实测为准。',
              'Pipeline: Markdown KB chunking → Chinese keyword top-K retrieval → system-prompt grounding → structured diagnosis output. No sensors, attention, or GCN yet; metrics are TBD by real evaluation.',
            )}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
