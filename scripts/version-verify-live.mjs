import { isMain } from './lib/process.mjs';

export async function verifyLive({ url, fetcher = fetch }) {
  const base = new URL(url);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('请提供不含凭据、查询参数或片段的 HTTP(S) 站点地址。');
  const root = base.origin;
  const requests = [
    ['开发站版本文件', `${root}/dev-preview.json`, 'json'],
    ['开发站健康接口', `${root}/api/health`, 'json'],
    ['开发站网页标识', `${root}/`, 'html'],
    ['GitHub main', 'https://api.github.com/repos/srt2777/AgriDx/commits/main', 'json'],
    ['Development preview 工作流', 'https://api.github.com/repos/srt2777/AgriDx/actions/workflows/dev-preview.yml/runs?branch=main&per_page=1', 'json'],
  ];
  const evidence = await Promise.all(requests.map(async ([label, target, kind]) => {
    try {
      const response = await fetcher(target, { headers: { 'Accept': kind === 'json' ? 'application/json' : 'text/html', 'User-Agent': 'AgriDx-version-verification' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) return { label, state: '未验证', reason: `HTTP ${response.status}` };
      const content = await response.text(); if (content.length > 1_000_000) throw new Error('响应过大');
      const value = kind === 'json' ? JSON.parse(content) : content.match(/<meta\s+[^>]*name=["']agridx-build-commit["'][^>]*content=["']([a-f0-9]{40})["']/i)?.[1];
      if (!value) throw new Error('缺少有效内容');
      return { label, state: '已读取', value };
    } catch (error) { return { label, state: '未验证', reason: error instanceof Error ? error.message : '请求失败' }; }
  }));
  const [release, health, html, main, workflow] = evidence.map(x => x.value);
  const commit = release?.commit; const sha = main?.sha; const run = workflow?.workflow_runs?.[0];
  const verified = /^[a-f0-9]{40}$/.test(commit || '') && sha === commit && health?.commit === commit && health?.version === release?.version && html === commit && run?.head_sha === commit && run?.status === 'completed' && run?.conclusion === 'success';
  return { root, evidence, verdict: verified ? '已核对一致' : '未验证或不一致' };
}
export function formatEvidence(result) {
  const lines = [`部署核对：${result.verdict}`, `站点：${result.root}`];
  for (const item of result.evidence) {
    if (item.state !== '已读取') { lines.push(`${item.label}：未验证（${item.reason}）`); continue; }
    const value = item.value;
    if (item.label === 'GitHub main') lines.push(`${item.label}：${value.sha || '未验证'}`);
    else if (item.label === 'Development preview 工作流') { const run = value.workflow_runs?.[0]; lines.push(`${item.label}：${run ? `${run.head_sha}，${run.status}/${run.conclusion || '未结束'}，${run.html_url}` : '未验证（无运行）'}`); }
    else if (item.label === '开发站网页标识') lines.push(`${item.label}：${value}`);
    else lines.push(`${item.label}：版本 ${value.version || '未验证'}，提交 ${value.commit || '未验证'}`);
  }
  return lines.join('\n');
}
if (isMain(import.meta.url)) try {
  const args = process.argv.slice(2); if (args.length !== 2 || args[0] !== '--url') throw new Error('用法：version:verify-live --url <开发站地址>');
  console.log(formatEvidence(await verifyLive({ url: args[1] })));
} catch (error) {
  console.error(`[version:verify-live] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
