import type { MeshStandardMaterial } from 'three';
import { DEMO_THRESHOLD_NOTE, TELEMETRY_WATERMARK, type TelemetryAlert, type TelemetryCatalog } from '../../../shared/telemetry';
import { resolveSelection, selectionForPart, type PartsModelId } from './parts-catalog';

export interface SimulationTarget {
  source: 'simulated';
  modelId: PartsModelId;
  partId: string;
  selection: string;
  channelId: string;
  at: number;
}

/** Only catalogue scope and an actual parts.json node may become a structural selection. */
export function simulationTargetForAlert(alert: TelemetryAlert, catalog: TelemetryCatalog | null): SimulationTarget | null {
  const channel = catalog?.channels.find(item => item.id === alert.channelId);
  const device = catalog?.devices.find(item => item.id === alert.deviceId);
  if (catalog?.source !== 'simulated' || !channel?.threshold || !device || !['diesel', 't70'].includes(device.modelId)
    || alert.source !== 'simulated' || channel.source !== 'simulated' || device.source !== 'simulated'
    || channel.deviceId !== alert.deviceId || channel.partId !== alert.partId || channel.threshold.source !== 'demo'
    || channel.threshold.note !== DEMO_THRESHOLD_NOTE || !Number.isSafeInteger(alert.at) || alert.at < 0 || alert.at > 8640000000000000) return null;
  const selection = selectionForPart(alert.partId, device.modelId), resolved = resolveSelection(selection, device.modelId);
  if (resolved?.node.partId !== alert.partId) return null;
  return { source: 'simulated', modelId: device.modelId, partId: alert.partId, selection, channelId: alert.channelId, at: alert.at };
}

/** Static emission only. Selection outlines and legacy example pulses remain separate. */
export function applySimulationHighlight(paint: Pick<MeshStandardMaterial, 'emissive' | 'emissiveIntensity'>) {
  paint.emissive.set('#ffca68');
  paint.emissiveIntensity = 0.5;
}

export function focusSimulationDetails(drawer: Pick<HTMLElement, 'scrollTop' | 'focus' | 'scrollIntoView'> | null, reduced: boolean) {
  if (!drawer) return;
  drawer.scrollTop = 0;
  drawer.focus({ preventScroll: true });
  drawer.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'nearest' });
}

/** Draw on an export copy, never on the WebGL canvas or the original model. */
export function drawStructureWatermark(context: CanvasRenderingContext2D, width: number, height: number, simulated: boolean) {
  const fontSize = Math.max(12, Math.min(24, width / 40)), padding = Math.max(4, fontSize / 2);
  const lines = ['结构示意，不代表实车 CAD', 'Structural schematic, not vehicle CAD', ...(simulated ? [TELEMETRY_WATERMARK] : [])];
  const lineHeight = fontSize * 1.3, band = padding * 2 + lineHeight * lines.length;
  context.save();
  context.fillStyle = 'rgba(0, 0, 0, 0.8)';
  context.fillRect(0, Math.max(0, height - band), width, band);
  context.fillStyle = '#ffffff';
  context.font = `600 ${fontSize}px sans-serif`;
  context.textBaseline = 'bottom';
  lines.forEach((line, index) => context.fillText(line, padding, height - padding - (lines.length - index - 1) * lineHeight, Math.max(1, width - padding * 2)));
  context.restore();
}
