// Local acceptance only. Render two observers of the real hook, without modifying production sources.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import express from 'express';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = path.dirname(root), output = path.join(workspace, `telemetry-hook-qa-${Date.now()}`);
if (!output.startsWith(workspace + path.sep)) throw new Error('QA output outside task workspace');
let applied = false;
await build({ root, configFile: path.join(root, 'vite.config.ts'), build: { outDir: output, emptyOutDir: false },
  plugins: [{ name: 'telemetry-hook-acceptance', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/pages/ModelPage/ModelPage.tsx')) return;
    const replacement = code.replace('export default function ModelPage()', 'function OriginalModelPage()');
    applied = replacement !== code;
    return `import { useTelemetry as useQaTelemetry } from '@/hooks/useTelemetry';\n${replacement}\n
function TelemetryQaReadout({ name }: { name: string }) {
  const data = useQaTelemetry({ modelId: 't70', partId: 'battery_box' });
  return <section data-telemetry-qa={name} data-phase={data.phase} data-state={data.connectionState} data-run={data.runId ?? ''}
    style={{ margin: '100px 20px 20px', padding: 20, border: '3px solid #c99324', background: 'var(--background)', color: 'var(--foreground)' }}>
    <strong>仿真数据 / Simulated data</strong><h2>本地 hook 验收夹具 / Local hook acceptance fixture</h2>
    <p>{name} · {data.phase} / {data.connectionState} · sequence {data.sequence}</p>
    <p style={{ overflowWrap: 'anywhere' }}>run: {data.runId ?? '—'}</p>
    {data.series.map(row => <p key={row.channel.id} data-channel={row.channel.id} data-source={row.latest?.source ?? ''}>
      {row.channel.name.zh} / {row.channel.name.en}: {row.latest?.value ?? '—'} {row.channel.unit} · history {row.points.length} / chart {row.chartPoints.length} · {row.historyStatus}
    </p>)}
    <button type="button" style={{ minHeight: 44 }} onClick={data.retry}>重试读取 / Retry</button>
  </section>;
}
export default function ModelPage() { return <><TelemetryQaReadout name="primary"/><details><summary>第二观察者 / Second observer</summary><TelemetryQaReadout name="secondary"/></details><OriginalModelPage/></>; }
`;
  }, transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'agridx-qa-mode', content: 'telemetry-hook' }, injectTo: 'head' }] }],
});
if (!applied) throw new Error('Hook acceptance branch was not applied');
process.env.NODE_ENV = 'production'; process.env.ALLOW_EXTERNAL_AI = 'false'; process.env.DIAGNOSIS_MODE = 'knowledge_only';
process.env.TELEMETRY_MODE = 'simulated'; process.env.TELEMETRY_SEED = '2777';
process.env.MEMORY_DB_PATH = path.join(workspace, 'telemetry-hook-qa.sqlite');
const { default: app } = await import(pathToFileURL(path.join(root, 'server/index.ts')).href);
app.use(express.static(output));
app.use((req, res, next) => { if (req.method !== 'GET') return next(); res.sendFile(path.join(output, 'index.html')); });
app.listen(3143, '127.0.0.1', () => console.log(`[telemetry-hook-qa] http://localhost:3143/#/models; output=${output}`));
