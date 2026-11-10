import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { errorHandler } from './middleware';
import { releaseCacheControl } from './release-cache';

/** Frontend hosting is attached separately from the API and diagnostic use case. */
export async function attachFrontend(app: express.Express): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath, { setHeaders(res, filePath) {
      const relative = `/${path.relative(distPath, filePath).split(path.sep).join('/')}`;
      const cache = releaseCacheControl(relative);
      if (cache) res.setHeader('Cache-Control', cache);
    } }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const cache = releaseCacheControl(req.path);
      if (cache) res.setHeader('Cache-Control', cache);
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      try {
        const template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  }
  app.use(errorHandler);
}
