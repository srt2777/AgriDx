import { ArrowRight, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';
import { version } from '../../../../package.json';

export default function ClosingSection() {
  const navigate = useNavigate();
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  return (
    <section className="w-full pt-16 pb-0 md:pt-20" data-home-beat="closing" data-home-side="start">
      <div className="mx-auto max-w-6xl px-4 md:px-6 lg:px-8">
        {/* CTA 区 */}
        <div className="closing-panel relative overflow-hidden rounded-2xl border border-primary/20 p-8 text-left md:p-12">
          {/* 装饰网格 */}
          <div className="pointer-events-none absolute inset-0 opacity-10">
            <div className="absolute inset-0 closing-grid" />
          </div>

          <div className="relative">
            <h2 className="font-serif text-2xl font-bold text-primary-foreground md:text-3xl">
              {pick(content.CLOSING_CTA.title, lang)}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-primary-foreground/80 md:text-base">
              {pick(content.CLOSING_CTA.desc, lang)}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigate('/chat')}
                className="gap-2 text-primary"
              >
                {pick(content.CLOSING_CTA.buttonText, lang)}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <footer className="mt-16 w-full border-t border-border/60 bg-card/50">
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
                    <circle cx="7" cy="16" r="3" />
                    <circle cx="17" cy="16" r="3" />
                    <path d="M4 16V10l8-4 8 4v6" />
                    <path d="M12 6v10" />
                  </svg>
                </div>
                <span className="font-serif text-lg font-bold text-foreground">耕知·耘诊</span>
              </div>
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                {t(
                  '耕知沉淀农机知识，耘诊连接故障与依据。从机型、组件到零部件，让诊断路径更清楚，让资料边界看得见。',
                  'Gengzhi organizes machinery knowledge; Yunzhen connects symptoms to evidence. From models and components to parts, make troubleshooting clearer and knowledge boundaries visible.',
                )}
              </p>
            </div>

            <div>
              <h4 className="mb-3 font-serif text-sm font-semibold text-foreground">{t('项目与资料', 'Project & documents')}</h4>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {content.FOOTER_REFERENCES.map((ref) => (
                  <li key={pick(ref.name, lang)}>
                    {ref.href === '#' ? (
                      <span className="text-xs text-muted-foreground">{pick(ref.name, lang)}</span>
                    ) : <a
                      href={ref.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {pick(ref.name, lang)}
                    </a>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border/50 pt-6 text-xs text-muted-foreground/70 md:flex-row">
            <div>{t('© 2026 耕知·耘诊 · 农业机械智能诊断平台', '© 2026 Gengzhi · Yunzhen · Agricultural Machinery Diagnosis')} · <Link to="/version-history" className="hover:underline">{t('更新记录', 'Version history')} · v{version}</Link></div>
            <div>{t('资料覆盖持续完善 · 现场处置请结合专业人员复核', 'Coverage is growing · review on-site actions with a qualified technician')}</div>
          </div>
        </div>
      </footer>
    </section>
  );
}
