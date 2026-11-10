import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import app from './server/index';
import { attachFrontend } from './server/http/frontend';
import { startHttpServer } from './server/http/listen';

async function startServer(): Promise<void> {
  await attachFrontend(app);
  startHttpServer(app);
}

// 入口可能是软链接（例如部署脚本的 current 软链接）：argv[1] 仍是链接
// 路径，而 import.meta.url 已解析为真实路径。先 realpath 再比较，否则
// 经过软链接启动时 guard 恒为 false、服务静默不监听。
function isMainEntry(): boolean {
  if (!process.argv[1] || process.env.NODE_ENV === 'test') return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  startServer().catch((error) => {
    console.error('[server] failed to start:', error);
    process.exit(1);
  });
}

export default app;
