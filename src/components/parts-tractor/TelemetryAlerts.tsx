import React from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { useTelemetry } from '../../hooks/useTelemetry';
import { telemetryNumber, telemetryThreshold, type TelemetryLanguage } from '../../features/telemetry/presentation';
import { simulationTargetForAlert, type SimulationTarget } from './parts-simulation';

type Data = Pick<ReturnType<typeof useTelemetry>, 'catalog' | 'alerts' | 'phase' | 'connectionState' | 'retry'>;

/** Read-only stream alerts. No client threshold calculation or diagnostic conclusion. */
export function TelemetryAlerts({ data, lang, onSelect }: { data: Data; lang: TelemetryLanguage; onSelect?: (target: SimulationTarget) => void }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const entries = data.alerts.flatMap(alert => {
    const channel = data.catalog?.channels.find(item => item.id === alert.channelId);
    const device = data.catalog?.devices.find(item => item.id === alert.deviceId);
    return channel?.threshold && device && alert.source === 'simulated' && device.source === 'simulated'
      && channel.source === 'simulated' && channel.deviceId === alert.deviceId && channel.partId === alert.partId ? [{ alert, channel, device }] : [];
  });
  const inconsistent = entries.length !== data.alerts.length;
  const failed = data.phase === 'error' || inconsistent;
  const pending = !failed && (data.phase === 'loading' || !data.catalog);
  const stale = data.connectionState !== 'simulated';
  return <section className="telemetry-alerts" aria-label={t('仿真告警列表', 'Simulated alert list')} aria-live="off">
    <h4><TriangleAlert size={14} aria-hidden="true" />{t('仿真告警 · 服务范围', 'Simulated alerts · Service scope')}</h4>
    <p className="telemetry-note">{t('来自当前服务所有仿真设备的已配置演示阈值；不代表实车故障或维修依据。', 'From configured demo thresholds across this service’s simulated devices; not vehicle faults or repair evidence.')}</p>
    {pending && <p role="status">{t('正在读取仿真告警…', 'Loading simulated alerts…')}</p>}
    {failed && <div className="telemetry-message" role="alert"><p>{inconsistent
      ? t('告警与通道配置不一致，已停止展示。', 'Alerts do not match the channel configuration; display stopped.')
      : t('仿真告警读取失败，尚不能确认当前告警。', 'Simulated alerts could not be read; current alerts are unconfirmed.')}</p><button type="button" onClick={data.retry}>{t('重新读取告警', 'Reload alerts')}</button></div>}
    {stale && entries.length > 0 && !inconsistent && <p role="status">{t('以下仅为末次收到样本中的仿真告警，连接离线或样本延迟，不代表当前时刻。', 'These simulated alerts belong to the last received sample. The connection is offline or delayed; they do not describe the current moment.')}</p>}
    {!pending && !failed && entries.length === 0 && <p role="status">{data.phase === 'empty' || stale
      ? t('暂无可确认的当前仿真告警样本。', 'No current simulated alert sample can be confirmed.')
      : t('当前样本未触发已配置的演示阈值。无阈值通道不参与判定；未对实车状态作出结论。', 'This sample triggered no configured demo threshold. Channels without thresholds are not evaluated; this does not establish a vehicle’s condition.')}</p>}
    {!inconsistent && entries.length > 0 && <ul className="telemetry-alert-list">{entries.map(({ alert, channel, device }) => {
      const Icon = alert.severity === 'alarm' ? CircleAlert : TriangleAlert;
      const target = simulationTargetForAlert(alert, data.catalog);
      return <li key={alert.channelId} data-severity={alert.severity}>
        <p className="telemetry-alert-label"><Icon size={14} aria-hidden="true" /><strong>{t('仿真告警', 'Simulated alert')} · {alert.severity === 'alarm' ? t('演示告警', 'Demo alarm') : t('演示关注', 'Demo attention')}</strong></p>
        <p>{device.name[lang]} · {channel.name[lang]}<br /><strong>{telemetryNumber(alert.value, channel.precision, lang)} {channel.unit}</strong> · <time dateTime={new Date(alert.at).toISOString()}>{new Date(alert.at).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour12: false })}</time></p>
        <p className="telemetry-threshold">{telemetryThreshold(channel, lang)}<br />{t('来源：演示配置（demo）；仿真演示阈值,非厂家标准', 'Source: demo configuration (demo); simulation demo thresholds, not manufacturer standards.')}</p>
        {onSelect && (target ? <button type="button" aria-label={`${t('查看部件与资料', 'View part and sources')} · ${device.name[lang]} · ${channel.name[lang]}`} onClick={() => onSelect(target)}>{t('查看部件与资料', 'View part and sources')}</button>
          : <p>{t('结构定位待核实。', 'Structural mapping needs verification.')}</p>)}
      </li>;
    })}</ul>}
  </section>;
}
