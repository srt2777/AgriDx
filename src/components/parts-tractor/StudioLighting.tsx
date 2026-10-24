import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PreparedTractor } from './load-parts-tractor';
import { studioQuality, studioShadowVolume } from './studio-rendering';
import { STUDIO_LIGHT_LOOK, type StudioLight } from '@/components/studio-schematic';

export default function StudioLighting({ prepared, light, constrained }: { prepared: PreparedTractor; light: StudioLight; constrained: boolean }) {
  const { gl, scene, invalidate } = useThree();
  const look = STUDIO_LIGHT_LOOK[light];
  const quality = studioQuality(constrained);
  const volume = useMemo(() => studioShadowVolume(new THREE.Box3().setFromObject(prepared.root), prepared.records.map(record => record.dir)), [prepared]);
  const target = useMemo(() => {
    const object = new THREE.Object3D(); object.position.copy(volume.center); return object;
  }, [volume]);
  useEffect(() => {
    const previous = scene.environmentIntensity;
    scene.environmentIntensity = light === 'night' ? .35 : .7;
    const anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), quality.anisotropy);
    const textures = new Set<THREE.Texture>();
    for (const record of prepared.records) for (const slot of record.slots) {
      if (slot.paint?.map) textures.add(slot.paint.map);
      if (slot.paint?.normalMap) textures.add(slot.paint.normalMap);
      if (slot.paint?.roughnessMap) textures.add(slot.paint.roughnessMap);
    }
    for (const texture of textures) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
    invalidate();
    return () => { scene.environmentIntensity = previous; };
  }, [gl, invalidate, light, prepared, quality.anisotropy, scene]);
  const r = volume.radius, c = volume.center;
  return <>
    <primitive object={target} />
    <ambientLight intensity={look.ambient * .45} />
    <hemisphereLight args={[look.hemiSky, look.hemiGround, look.hemi * .4]} />
    <directionalLight position={[c.x + r * 2.5, c.y + r * 4, c.z + r * 2]} target={target}
      intensity={look.key * 1.8} color={look.keyColor} castShadow
      shadow-mapSize={[quality.shadowSize, quality.shadowSize]} shadow-camera-left={-volume.extent} shadow-camera-right={volume.extent}
      shadow-camera-top={volume.extent} shadow-camera-bottom={-volume.extent} shadow-camera-near={volume.near} shadow-camera-far={volume.far}
      shadow-bias={-.00015} shadow-normalBias={volume.normalBias} shadow-radius={3} />
    <directionalLight position={[c.x - r * 3, c.y + r * 1.5, c.z + r]} target={target} intensity={look.fill * .75} color={look.fillColor} />
    <directionalLight position={[c.x - r, c.y + r * 2, c.z - r * 3]} target={target} intensity={light === 'night' ? .9 : 1.5} color="#d9ebff" />
  </>;
}
