import type { TerrainField } from './knowledge-terrain-field';
export interface ContourSegment { level: number; a: [number,number]; b: [number,number] }
/** Marching squares segments, including deterministic handling of saddle cells. */
export function terrainContours(field: TerrainField, levels = 12): ContourSegment[] {
  if(!Number.isInteger(levels)||levels<1||levels>64)throw new Error('Invalid contour level count');
  const out:ContourSegment[]=[], {width,height,values}=field;
  for(let step=1;step<=levels;step++){
    const level=step/(levels+1);
    for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
      const corners=[values[y*width+x],values[y*width+x+1],values[(y+1)*width+x+1],values[(y+1)*width+x]];
      const coords:[[number,number],[number,number],[number,number],[number,number]]=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
      const cuts:[number,number][]=[];
      for(const [a,b] of [[0,1],[1,2],[2,3],[3,0]]){
        if((corners[a]>=level)===(corners[b]>=level))continue;
        const t=(level-corners[a])/(corners[b]-corners[a]);
        cuts.push([(coords[a][0]+(coords[b][0]-coords[a][0])*t)/(width-1),(coords[a][1]+(coords[b][1]-coords[a][1])*t)/(height-1)]);
      }
      if(cuts.length===2)out.push({level,a:cuts[0],b:cuts[1]});
      else if(cuts.length===4){const high=(corners[0]+corners[1]+corners[2]+corners[3])/4>=level;out.push({level,a:cuts[0],b:cuts[high?3:1]},{level,a:cuts[high?1:2],b:cuts[high?2:3]});}
    }
  }
  return out;
}
