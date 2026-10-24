import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { EffectComposer, Outline, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Object3D } from 'three';
import type { TractorComponent } from './tractor-model-info';
import { getComponentMeshes } from './tractor-component-utils';

/** Loaded only when an identified schematic component needs an outline. */
export default function TractorOutline({ model, component }: { model: Object3D; component: TractorComponent }) {
  const selection = useMemo(() => getComponentMeshes(model, component), [model, component]);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    invalidate();
    return () => { invalidate(); };
  }, [selection, invalidate]);
  return <EffectComposer autoClear={false} multisampling={0} enableNormalPass={false}>
    <Outline selection={selection} visibleEdgeColor={0x30b67a} hiddenEdgeColor={0x30b67a}
      edgeStrength={3} resolutionScale={.75} xRay={false} blur={false} />
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  </EffectComposer>;
}
