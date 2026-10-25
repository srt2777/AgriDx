import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { downsampleTelemetry, selectTelemetryChannels, telemetryWindowPoints, type TelemetryScope } from '../features/telemetry/protocol';
import { getTelemetryStore } from '../features/telemetry/store';
import type { TelemetryWindow } from '../../shared/telemetry';

/** Components choose channels; only this shared store owns network and sample history. */
export function useTelemetry(scope: TelemetryScope & { window?: TelemetryWindow } = {}) {
  const store = getTelemetryStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const key = scope.channelIds?.join('|') ?? '';
  const channels = useMemo(() => selectTelemetryChannels(state.catalog,
    { modelId: scope.modelId, partId: scope.partId, channelIds: key ? key.split('|') : [] }), [state.catalog, scope.modelId, scope.partId, key]);
  useEffect(() => { channels.forEach(channel => { void store.loadHistory(channel.id); }); }, [channels, store, state.epoch]);
  const window = scope.window ?? '1h';
  const windowEnd = Math.max(0, ...channels.map(channel => state.latest[channel.id]?.at ?? 0));
  const series = useMemo(() => channels.map(channel => {
    const points = state.points[channel.id] ?? [], windowPoints = telemetryWindowPoints(points, window, windowEnd);
    return { channel, points, windowPoints, chartPoints: downsampleTelemetry(windowPoints), latest: state.latest[channel.id], historyStatus: state.historyStatus[channel.id] ?? 'loading' };
  }), [channels, state.points, state.latest, state.historyStatus, window, windowEnd]);
  return { ...state, series, window, windowEnd, connectionState: store.connectionState(), retry: store.retry, retryHistory: store.retryHistory, changeScenario: store.changeScenario };
}
