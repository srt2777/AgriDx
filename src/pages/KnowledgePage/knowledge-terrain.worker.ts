import { terrainField } from './knowledge-terrain-field';
import { terrainContours } from './knowledge-terrain-contours';
import type { TerrainPoint } from './knowledge-terrain-layout';
import type { RelationEdge } from '../../../shared/knowledge-relations';

type Request = { id: number; key: string; points: TerrainPoint[]; edges: RelationEdge[]; width: number; height: number };
const cache = new Map<string, { values: Float32Array; width: number; height: number; contours: ReturnType<typeof terrainContours>; elapsedMs: number }>();
self.onmessage = (event: MessageEvent<Request>) => {
  const { id,key,points,edges,width,height } = event.data;
  try {
    let result=cache.get(key);
    if (!result) {
      const started=performance.now(), field=terrainField(points,edges,width,height), contours=terrainContours(field,12);
      result={...field,contours,elapsedMs:performance.now()-started};cache.set(key,result);
      if(cache.size>3)cache.delete(cache.keys().next().value!);
    }
    // Do not transfer the cached array: subsequent requests reuse the same field.
    self.postMessage({id,...result});
  } catch (error) { self.postMessage({id,error:error instanceof Error ? error.message : '地形计算失败'}); }
};
