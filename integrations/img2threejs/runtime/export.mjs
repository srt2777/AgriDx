import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server = await createServer({ root: process.cwd(), cacheDir: '.vite', configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__IMG2THREEJS_READY__ === true);
  for (const [angle, name] of [[0, 'render'], [90, 'right'], [180, 'rear'], [270, 'left']]) {
    await page.evaluate(a => window.setReviewAngle(a), angle);
    await page.screenshot({ path: `${name}.png` });
  }
  const base64 = await page.evaluate(() => window.exportModel());
  await writeFile('model.glb', Buffer.from(base64, 'base64'));
} finally { await browser?.close(); await server.close(); }
