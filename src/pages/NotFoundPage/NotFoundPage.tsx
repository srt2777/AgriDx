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
      <div className="fluid-workspace is-collapsed flex min-h-screen items-center justify-center bg-background p-6" data-ui-version="old">
        <div className="text-center">
          <ThemeSwitch className="mx-auto mb-6" />
          <div className="classic-not-found-code font-serif text-7xl font-bold text-primary/30">404</div>
          <h1 className="mt-4 font-serif text-2xl font-bold text-foreground">{lang === 'zh' ? '页面未找到' : 'Page not found'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {lang === 'zh' ? '请检查地址，或返回首页。' : 'Check the address or return home.'}
          </p>
          <Button asChild className="mt-6 gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              {lang === 'zh' ? '返回首页' : 'Back to home'}
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
