import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeSwitch from '@/components/ThemeSwitch';
import { SiteStatusBar } from '@/components/SiteStatusBar';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';
import { COMMAND_ROUTES, notFoundCopy } from '@/lib/command-routes';
import './not-found.css';

export default function NotFoundPage() {
  const version = useUiVersion();
  const lang = useLang();
  if (version !== 'new') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center">
          <ThemeSwitch className="mx-auto mb-6" />
          <div className="font-serif text-7xl font-bold text-primary/30">404</div>
          <h1 className="mt-4 font-serif text-2xl font-bold text-foreground">页面未找到</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            抱歉，您访问的页面不存在或已被移除。
          </p>
          <Button asChild className="mt-6 gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  const copy = notFoundCopy(lang);
  return (
    <div className="new-version-shell not-found-page" data-ui-version="new">
      <main id="main-content" className="not-found-main">
        <ThemeSwitch />
        <section className="not-found-card" aria-labelledby="not-found-title">
          <p>{copy.kicker}</p>
          <strong>404</strong>
          <h1 id="not-found-title">{copy.title}</h1>
          <span className="wheat-line" aria-hidden="true" />
          <p>{copy.note}</p>
          <nav aria-label={lang === 'zh' ? '可前往的页面' : 'Available pages'}>
            {COMMAND_ROUTES.map((item) => (
              <Link key={item.id} to={item.path}>{lang === 'zh' ? item.zh : item.en}</Link>
            ))}
          </nav>
        </section>
      </main>
      <SiteStatusBar />
    </div>
  );
}
