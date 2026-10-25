import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { downsampleTelemetry, selectTelemetryChannels, type TelemetryScope } from '../features/telemetry/protocol';
import { getTelemetryStore } from '../features/telemetry/store';

/** Components choose channels; only this shared store owns network and sample history. */
export function useTelemetry(scope: TelemetryScope = {}) {
  const store = getTelemetryStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const key = scope.channelIds?.join('|') ?? '';
  const channels = useMemo(() => selectTelemetryChannels(state.catalog,
    { modelId: scope.modelId, partId: scope.partId, channelIds: key ? key.split('|') : [] }), [state.catalog, scope.modelId, scope.partId, key]);
  useEffect(() => { channels.forEach(channel => { void store.loadHistory(channel.id); }); }, [channels, store, state.epoch]);
  const series = useMemo(() => channels.map(channel => ({ channel, points: state.points[channel.id] ?? [],
    chartPoints: downsampleTelemetry(state.points[channel.id] ?? []), latest: state.latest[channel.id], historyStatus: state.historyStatus[channel.id] ?? 'loading' })),
  [channels, state.points, state.latest, state.historyStatus]);
  return { ...state, series, connectionState: store.connectionState(), retry: store.retry, retryHistory: store.retryHistory };
}
