import rawConfig from '../config/telemetry-demo.json';
import { simulateTelemetry, validateTelemetryDemoConfig } from './telemetry-simulator';
import type { TelemetryChannel, TelemetryDevice, TelemetryWindow } from './telemetry';
import { TELEMETRY_WINDOWS } from './telemetry';
const base = validateTelemetryDemoConfig(rawConfig);
/** 40 replicas of each structural template: simulated devices, never archived models. */
export const fleetDevices: TelemetryDevice[] = Array.from({length:40},(_,i) => base.devices.map(d => ({...d,id:`fleet-${d.modelId}-${String(i+1).padStart(2,'0')}`,name:{zh:`${d.modelId==='diesel'?'柴油':'电驱'}模拟设备 ${String(i+1).padStart(2,'0')}`,en:`${d.modelId} simulated unit ${i+1}`}}))).flat();
const definitions = fleetDevices.flatMap(device => {
  const template = base.devices.find(d => d.modelId===device.modelId)!;
  return base.channels.filter(c=>c.deviceId===template.id).map(c=>({...c,id:`${device.id}.${c.id}`,deviceId:device.id,threshold:null}));
});
export const fleetChannels: TelemetryChannel[] = definitions.map(({baseline:_b,noise:_n,dailyAmplitude:_d,...channel})=>channel);
export const fleetSummary = {devices:fleetDevices.length,points:fleetChannels.length,signalTypes:base.channels.length};
/** Generate only the selected points, at most 4 x 301 samples. No global thousand-point stream or unbounded history. */
export function fleetSeries(ids: readonly string[], window: TelemetryWindow, at: number) {
  if(ids.length>4 || new Set(ids).size!==ids.length || !Number.isSafeInteger(at) || at<TELEMETRY_WINDOWS['1h']) throw new RangeError('Invalid fleet selection');
  const channels=ids.map(id=>definitions.find(c=>c.id===id));
  if(channels.some(c=>!c)) throw new RangeError('Unknown simulated point');
  const config={...base,channels:channels.filter(c=>!!c)};
  const end=Math.floor(at/1000)*1000, duration=TELEMETRY_WINDOWS[window], step=duration/300;
  const batches=Array.from({length:301},(_,i)=>simulateTelemetry(config,{elapsedMs:end-duration+i*step}).points);
  return channels.map(channel=>({channel: fleetChannels.find(c=>c.id===channel!.id)!,points:batches.map(batch=>batch.find(p=>p.channelId===channel!.id)!)}));
}
