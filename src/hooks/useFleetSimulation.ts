import { useEffect, useMemo, useState } from 'react';
import { fleetChannels, fleetDevices, fleetSeries } from '../../shared/fleet-simulation';
import { TELEMETRY_WINDOWS, type TelemetryWindow } from '../../shared/telemetry';
export function useFleetSimulation(enabled:boolean, ids:string[], window:TelemetryWindow) {
  const [at,setAt]=useState(Date.now);
  useEffect(()=>{if(!enabled)return;const timer=globalThis.setInterval(()=>{if(!document.hidden)setAt(Date.now());},1000);return()=>clearInterval(timer);},[enabled]);
  const key=ids.join('|');
  const series=useMemo(()=>enabled?fleetSeries(key?key.split('|'):[],window,at).map(({channel,points})=>({channel,windowPoints:points,historyStatus:'ready' as const})):[],[enabled,key,window,at]);
  return {catalog:{devices:fleetDevices,channels:fleetChannels,sampleMs:TELEMETRY_WINDOWS[window]/300},series,runId:'browser-fleet-seeded-v1',connectionState:'simulated' as const,error:null,retry:()=>setAt(Date.now()),retryHistory:()=>setAt(Date.now())};
}
