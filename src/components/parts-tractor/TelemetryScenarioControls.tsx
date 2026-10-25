import React, { useId, useState } from 'react';
import { RefreshCw, RotateCcw, Users } from 'lucide-react';
import type { useTelemetry } from '../../hooks/useTelemetry';
import type { TelemetryScenario, TelemetryScenarioId } from '../../../shared/telemetry';
import type { TelemetryLanguage } from '../../features/telemetry/presentation';

type Data = Pick<ReturnType<typeof useTelemetry>, 'catalog' | 'scenario' | 'scenarioControl' | 'runId' | 'connectionState' | 'changeScenario' | 'retry'>;
type Props = { data: Data; lang: TelemetryLanguage };

/** Only the hook owns transport. A new sampled run resets this form's unpersisted draft. */
export function TelemetryScenarioControls({ data, lang }: Props) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const current = data.catalog?.scenarios.find(item => item.id === data.scenario?.id);
  return <section className="telemetry-scenarios" aria-label={t('仿真场景', 'Simulation scenarios')}>
    <h4><Users size={14} aria-hidden="true" />{t('仿真场景 · 服务共享', 'Simulation scenarios · Shared service')}</h4>
    <p className="telemetry-note">{t('切换影响当前服务的所有监测窗口，并清空旧场景曲线。仿真场景名称不表示实车状态。', 'Switching affects every monitoring window on this service and clears previous scenario curves. Scenario names do not describe a vehicle’s condition.')}</p>
    {current && data.runId && data.scenario?.revision !== undefined && data.scenario.startedAt !== undefined
      ? <ScenarioForm key={`${data.runId}:${data.scenario.revision}`} data={data} current={current} lang={lang} />
      : <p role="status">{t('等待带控制信息的仿真样本，暂不可切换场景。', 'Waiting for a simulation sample with control metadata. Switching is unavailable.')}</p>}
  </section>;
}

function ScenarioForm({ data, current, lang }: Props & { current: TelemetryScenario }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const id = useId(), scenario = data.scenario!, control = data.scenarioControl;
  const [draft, setDraft] = useState<TelemetryScenarioId>(scenario.id), [loop, setLoop] = useState(scenario.loop);
  const conflict = control.conflict;
  const waitingForStream = control.phase === 'conflict' && !!conflict && (scenario.revision! < conflict.revision
    || (scenario.revision === conflict.revision && data.runId !== conflict.runId));
  const pending = control.phase === 'pending', fresh = data.connectionState === 'simulated';
  const disabled = pending || !fresh || waitingForStream;
  const seconds = Math.floor(scenario.elapsedMs / 1000), duration = Math.ceil(current.durationMs / 1000);
  function apply(next: TelemetryScenarioId, repeat: boolean) {
    if (!disabled) void data.changeScenario(next, repeat);
  }
  return <>
    <p className="telemetry-scenario-current">{t('已收到的场景', 'Received scenario')}：<strong>{current.name[lang]}</strong> · {seconds} / {duration} {t('秒', 's')} · {scenario.loop ? t('循环', 'Looping') : t('单次', 'Once')}</p>
    <progress max={current.durationMs} value={scenario.elapsedMs} aria-label={t('已采样的场景进度', 'Sampled scenario progress')} aria-valuetext={`${seconds} / ${duration} ${t('秒', 's')}`} />
    {!scenario.loop && scenario.elapsedMs >= current.durationMs && <p>{t('本轮脚本已结束；后续采样保持该脚本的末段基线。', 'This script has ended; subsequent samples retain its final baseline.')}</p>}
    {!fresh && <p role="status">{t('连接离线或样本延迟，场景控制已停用；当前显示末次收到的场景。', 'Offline or delayed samples: controls are disabled. The last received scenario is shown.')}</p>}
    {pending && <p role="status">{t('正在请求切换…以随后收到的仿真样本为准。', 'Requesting a switch… confirmation comes from subsequent simulation samples.')}</p>}
    {control.phase === 'conflict' && <p role="alert">{waitingForStream
      ? t('场景已被其他窗口切换，正在等待对应样本。可重新读取；不会自动覆盖。', 'Another window switched the scenario. Waiting for its samples; you can reload. No automatic overwrite.')
      : t('场景已更新。请核对上方已收到的场景，再手动选择；不会自动重试。', 'The scenario changed. Review the received scenario above before choosing again. No automatic retry.')}</p>}
    {control.phase === 'error' && <p role="alert">{control.error === 'rate_limited'
      ? t('请求过于频繁，本次切换未获确认。稍后核对场景后再手动操作。', 'Too many requests. This switch is unconfirmed. Review the scenario before trying manually later.')
      : control.error === 'invalid_data'
        ? t('控制响应未通过校验，切换结果未确认。请重新读取场景后核对。', 'The control response failed validation; the switch is unconfirmed. Reload and review the scenario.')
        : t('连接或请求中断，切换结果未确认。服务可能已应用，请核对场景后再手动操作。', 'The connection or request was interrupted; the switch is unconfirmed. It may have been applied. Review the scenario before another manual action.')}</p>}
    <form onSubmit={event => { event.preventDefault(); apply(draft, loop); }}>
      <fieldset disabled={disabled} aria-describedby={`${id}-scope`}>
        <legend>{t('选择下一场景', 'Choose the next scenario')}</legend>
        <label htmlFor={`${id}-scenario`}>{t('演示场景', 'Demo scenario')}</label>
        <select id={`${id}-scenario`} value={draft} onChange={event => setDraft(event.target.value as TelemetryScenarioId)}>
          {data.catalog!.scenarios.map(item => <option key={item.id} value={item.id}>{item.name[lang]}</option>)}
        </select>
        <label className="telemetry-loop"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />{t('循环播放场景脚本', 'Loop the scenario script')}</label>
        <div className="telemetry-scenario-actions">
          <button type="submit">{t('应用场景', 'Apply scenario')}</button>
          <button type="button" onClick={() => apply('normal', false)}><RotateCcw size={14} aria-hidden="true" />{t('回到正常场景', 'Return to normal scenario')}</button>
        </div>
      </fieldset>
      <p id={`${id}-scope`} className="telemetry-note">{t('仅人工触发；选择不保存，切换须以新样本确认。', 'Manual actions only. Choices are not saved; new samples confirm a switch.')}</p>
    </form>
    {!pending && (!fresh || waitingForStream || control.phase === 'error') && <button type="button" onClick={data.retry}><RefreshCw size={14} aria-hidden="true" />{t('重新读取场景', 'Reload scenario')}</button>}
  </>;
}
