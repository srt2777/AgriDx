import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bot, KeyRound, Plug, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useLang } from '../hooks/useLang';
import './api-connections.css';

type ProviderId = 'deepseek' | 'gemini' | 'openai';
interface ProviderConfig { provider: ProviderId; label: string; model: string; baseUrl: string; enabled: boolean; hasKey: boolean; updatedAt: number | null; updatedBy: string | null }
interface Settings { publicEnabled: boolean; defaultProvider: ProviderId; dailyLimit: number }
interface Configuration { encryptionConfigured: boolean; allowedHosts: string[]; settings: Settings; usedToday: number; providers: ProviderConfig[] }
class ConnectionError extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dev-admin/ai${path}`, { credentials: 'same-origin', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionError(response.status, typeof data?.error === 'string' ? data.error : 'API 设置服务暂不可用。');
  return data as T;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'API 设置服务暂不可用。'; }

function ProviderCard({ config, encryptionReady, saved, failed }: { config: ProviderConfig; encryptionReady: boolean; saved: () => Promise<void>; failed: (error: unknown) => void }) {
  const lang = useLang(), t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [model, setModel] = useState(config.model), [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(''), [enabled, setEnabled] = useState(config.enabled);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = model !== config.model || baseUrl !== config.baseUrl || enabled !== config.enabled || !!apiKey;
  async function act(action: 'save' | 'test' | 'delete', event?: FormEvent) {
    event?.preventDefault(); setBusy(action); setMessage(''); setError('');
    try {
      const result = await request<{ latencyMs?: number }>(`/providers/${config.provider}${action === 'save' ? '' : `/${action}`}`, action === 'save' ? { model, baseUrl, enabled, ...(apiKey ? { apiKey } : {}) } : {});
      setApiKey(''); setConfirmDelete(false);
      if (action !== 'test') await saved();
      else setMessage(t(`连接成功 · ${result.latencyMs} ms（测试已保存的模型配置）`, `Connected · ${result.latencyMs} ms (saved model configuration)`));
    } catch (error) { setError(errorMessage(error)); failed(error); }
    finally { setBusy(''); if (action === 'save') setApiKey(''); }
  }
  return <section className="console-panel console-api-card" aria-labelledby={`api-${config.provider}-title`}>
    <div className="console-api-card-heading"><h2 id={`api-${config.provider}-title`}>{config.label}</h2><span className={`console-badge ${config.enabled && config.hasKey ? 'console-badge-good' : 'console-badge-neutral'}`}>{config.hasKey ? config.enabled ? t('已启用', 'Enabled') : t('已保存 · 已停用', 'Saved · Disabled') : t('未配置', 'Not configured')}</span></div>
    <p className="console-api-caption">{t('密钥不回显；保存不代表连接已验证。', 'Keys are never returned. Saving does not verify connectivity.')}</p>
    <form onSubmit={event => { void act('save', event); }}>
      <label htmlFor={`key-${config.provider}`}>API Key <input id={`key-${config.provider}`} type="password" autoComplete="new-password" spellCheck={false} maxLength={512} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={config.hasKey ? t('留空保留已保存的密钥', 'Leave blank to keep the saved key') : t('粘贴服务商 API 密钥', 'Paste a provider API key')} disabled={!!busy || !encryptionReady} /></label>
      <label htmlFor={`model-${config.provider}`}>{t('模型名称', 'Model name')}<input id={`model-${config.provider}`} required maxLength={120} value={model} onChange={event => setModel(event.target.value)} disabled={!!busy} /></label>
      <label htmlFor={`url-${config.provider}`}>{t('API 基础地址', 'API base URL')}<input id={`url-${config.provider}`} type="url" required maxLength={500} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={!!busy} /></label>
      <label className="console-api-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={!!busy} />{t('启用此服务商', 'Enable this provider')}</label>
      <div className="console-api-actions"><button className="console-primary" type="submit" disabled={!!busy || !encryptionReady || !model.trim() || (!config.hasKey && !apiKey.trim())}><Save size={15} />{busy === 'save' ? t('保存中…', 'Saving…') : t('保存配置', 'Save configuration')}</button><button type="button" onClick={() => { void act('test'); }} disabled={!!busy || !config.hasKey || dirty || !encryptionReady}><Plug size={15} />{busy === 'test' ? t('测试中…', 'Testing…') : t('测试连接', 'Test connection')}</button></div>
      {dirty && <p className="console-api-caption">{t('有未保存的修改。请先保存，再测试。', 'Unsaved changes. Save before testing.')}</p>}
    </form>
    {message && <p className="console-api-success" role="status">{message}</p>}{error && <p className="console-error" role="alert">{error}</p>}
    <div className="console-api-card-footer">{config.updatedAt && <small>{t('保存于', 'Saved')} {new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(config.updatedAt)} · {config.updatedBy}</small>}{config.hasKey && <button type="button" className="console-api-delete" disabled={!!busy} onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t('删除配置', 'Delete configuration')}</button>}</div>
    {confirmDelete && <div className="console-api-confirm"><p>{t('删除此服务商及其密钥？如果它是默认服务商，公开 AI 调用也会关闭。', 'Delete this provider and its key? Public AI is also disabled if this is the default provider.')}</p><button type="button" disabled={!!busy} onClick={() => { void act('delete'); }}>{t('确认删除', 'Confirm deletion')}</button><button type="button" disabled={!!busy} onClick={() => setConfirmDelete(false)}>{t('取消', 'Cancel')}</button></div>}
  </section>;
}

export default function ApiConnections({ revision, onSessionExpired }: { revision: number; onSessionExpired: () => void }) {
  const lang = useLang(), t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [data, setData] = useState<Configuration | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [publicEnabled, setPublicEnabled] = useState(false), [defaultProvider, setDefaultProvider] = useState<ProviderId>('deepseek'), [dailyLimit, setDailyLimit] = useState('100');
  const [saving, setSaving] = useState(false), [savedMessage, setSavedMessage] = useState('');
  const [debugProvider, setDebugProvider] = useState<ProviderId>('deepseek'), [prompt, setPrompt] = useState(''), [reply, setReply] = useState(''), [debugging, setDebugging] = useState(false);
  const failed = useCallback((error: unknown) => { if (error instanceof ConnectionError && error.status === 401) onSessionExpired(); }, [onSessionExpired]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const config = await request<Configuration>('', undefined, signal); if (signal?.aborted) return; setData(config); setPublicEnabled(config.settings.publicEnabled); setDefaultProvider(config.settings.defaultProvider); setDailyLimit(String(config.settings.dailyLimit)); }
    catch (error) { if (!signal?.aborted) { setError(errorMessage(error)); failed(error); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [failed]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSavedMessage('');
    try { await request('/settings', { publicEnabled, defaultProvider, dailyLimit: Number(dailyLimit) }); await load(); setSavedMessage(t('公开调用设置已保存。', 'Public access settings saved.')); }
    catch (error) { setError(errorMessage(error)); failed(error); } finally { setSaving(false); }
  }
  async function debug(event: FormEvent) {
    event.preventDefault(); setDebugging(true); setReply(''); setError('');
    try { const result = await request<{ content: string; model: string; latencyMs: number }>(`/providers/${debugProvider}/chat`, { prompt }); setReply(`${result.model} · ${result.latencyMs} ms\n\n${result.content}`); }
    catch (error) { setError(errorMessage(error)); failed(error); } finally { setDebugging(false); }
  }
  const active = data?.providers.filter(provider => provider.enabled && provider.hasKey) || [];
  return <div className="console-ai">
    <section className="console-panel"><div className="console-panel-heading"><h2><KeyRound size={19} />{t('API 接入', 'API connections')}</h2><p>{t('配置模型服务，让开发站智能诊断在需要时调用 AI；本地知识检索和来源核验继续保留。', 'Connect model services for AI-assisted diagnosis while retaining local retrieval and source checks.')}</p></div><div className="console-api-overview"><span>{t('支持 DeepSeek、Gemini 与 OpenAI 兼容接口。', 'DeepSeek, Gemini and OpenAI-compatible endpoints.')}</span><button type="button" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={15} />{t('刷新配置', 'Refresh configuration')}</button></div><p className="console-api-caption">{t('连接测试和调试会向服务商发送请求，可能产生用量。密钥只在服务端加密保存，不存入浏览器持久化存储或公开产物。', 'Connection tests and debugging send provider requests and may incur usage. Keys are encrypted on the server and excluded from browser storage and public builds.')}</p>
      {data && !data.encryptionConfigured && <p className="console-error" role="alert">{t('服务端密钥加密尚未配置，暂不能保存密钥。部署管理员需设置 DEV_AI_ENCRYPTION_KEY 后重新部署开发入口。', 'Secret encryption is not configured. A deployment administrator must set DEV_AI_ENCRYPTION_KEY and redeploy the development gateway before keys can be saved.')}</p>}
      {data && <p className="console-api-caption">{t('允许的接口主机：', 'Allowed endpoint hosts: ')}{data.allowedHosts.join(' · ')}</p>}
    </section>
    {error && <p className="console-error" role="alert">{error}</p>}{loading && !data && <p role="status">{t('正在读取 API 配置…', 'Loading API configuration…')}</p>}
    {data && <><div className="console-api-grid">{data.providers.map(config => <ProviderCard key={`${config.provider}-${config.updatedAt}`} config={config} encryptionReady={data.encryptionConfigured} saved={load} failed={failed} />)}</div>
      <section className="console-panel"><div className="console-panel-heading"><h2>{t('开发站公开调用', 'Public development access')}</h2><p>{t('开启后，全部访客都可在智能诊断中使用默认模型。仅本地模式仍不会调用 AI。', 'When enabled, all visitors may use the default model in diagnosis. Local-only mode never calls AI.')}</p></div><form className="console-api-settings" onSubmit={event => { void saveSettings(event); }}><label className="console-api-check"><input type="checkbox" checked={publicEnabled} onChange={event => setPublicEnabled(event.target.checked)} disabled={saving || !data.encryptionConfigured} />{t('允许所有访客使用 AI 辅助', 'Allow AI assistance for all visitors')}</label><label>{t('默认服务商', 'Default provider')}<select value={defaultProvider} onChange={event => setDefaultProvider(event.target.value as ProviderId)} disabled={saving}>{data.providers.map(item => <option key={item.provider} value={item.provider}>{item.label}{!item.hasKey || !item.enabled ? t('（未就绪）', ' (not ready)') : ''}</option>)}</select></label><label>{t('每日公开请求上限（上海自然日）', 'Daily public request limit (Shanghai day)')}<input type="number" min="1" max="1000" required value={dailyLimit} onChange={event => setDailyLimit(event.target.value)} disabled={saving} /></label><p>{t(`今日已计入额度 ${data.usedToday} 次。每个网络地址每分钟最多 6 次，单次输出最多 1024 tokens；失败或超额时回退本地诊断。`, `${data.usedToday} requests counted today. Up to 6 requests per network address per minute and 1024 output tokens per request; failures or limits fall back to local diagnosis.`)}</p><button className="console-primary" type="submit" disabled={saving || !Number.isInteger(Number(dailyLimit)) || Number(dailyLimit) < 1 || Number(dailyLimit) > 1000}><Save size={15} />{saving ? t('保存中…', 'Saving…') : t('保存公开调用设置', 'Save public access')}</button>{savedMessage && <p role="status" className="console-api-success">{savedMessage}</p>}</form></section>
      <section className="console-panel"><div className="console-panel-heading"><h2><Bot size={19} />{t('管理员调试', 'Administrator playground')}</h2><p>{t('用于验证已保存的服务商配置。调试结果不是经过知识库核验的维修结论。', 'Verify saved provider settings. Playground output is not a knowledge-verified repair conclusion.')}</p></div><form onSubmit={event => { void debug(event); }} className="console-api-debug"><label>{t('服务商', 'Provider')}<select value={debugProvider} onChange={event => setDebugProvider(event.target.value as ProviderId)} disabled={debugging}>{data.providers.map(item => <option key={item.provider} value={item.provider} disabled={!item.enabled || !item.hasKey}>{item.label}</option>)}</select></label><label>{t('测试问题', 'Test question')}<textarea rows={3} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t('例如：拖拉机发动机过热，先检查什么？', 'Example: What should I check first when a tractor engine overheats?')} disabled={debugging} /></label><button className="console-primary" type="submit" disabled={debugging || !data.encryptionConfigured || !prompt.trim() || !active.some(item => item.provider === debugProvider)}><Bot size={15} />{debugging ? t('正在调用…', 'Calling…') : t('发送调试请求', 'Send test request')}</button></form>{reply && <pre className="console-api-reply" aria-live="polite">{reply}</pre>}</section>
    </>}
  </div>;
}
