import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/** Loaded only on wide screens that allow motion, so the postprocessing chunk stays off the low-end path. */
export function HallGlow() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} resolutionScale={0.7}>
      <Bloom luminanceThreshold={0.42} luminanceSmoothing={0.2} intensity={0.72} mipmapBlur radius={0.48} levels={4} />
      <Vignette eskil={false} offset={0.18} darkness={0.42} />
    </EffectComposer>
  );
}

export function CampusGlow() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={0.28} mipmapBlur radius={0.35} levels={4} />
      <Vignette eskil={false} offset={0.25} darkness={0.28} />
    </EffectComposer>
  );
}
