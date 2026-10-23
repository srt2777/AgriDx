import { useEffect, useMemo } from 'react';
import { createPortal, useThree } from '@react-three/fiber';
import EngineMechanism from '@/components/engine-demo/EngineMechanism';
import type { PartRecord } from './load-parts-tractor';
import { fitEngineToPart } from './engine-fit';
import type { StudioPresentation } from './parts-motion';

/** Attach in engine-local coordinates, so the tractor's existing explode transform carries it. */
export default function IntegratedEngine({ record, running, speed, explode, visible, presentation }: {
  record: PartRecord; running: boolean; speed: number; explode: number; visible: boolean; presentation: StudioPresentation;
}) {
  const { invalidate } = useThree();
  const fit = useMemo(() => fitEngineToPart(record.object), [record]);
  useEffect(() => {
    for (const slot of record.slots) slot.material.visible = false;
    for (const edge of record.edges) edge.visible = false;
    invalidate();
    return () => { for (const slot of record.slots) slot.material.visible = true; };
  }, [record, invalidate]);
  return createPortal(<group visible={visible} position={fit.position} scale={fit.scale} userData={{ integratedEngine: true }}>
    <EngineMechanism running={running} speed={speed} explode={explode} transparent={presentation !== 'solid' || running} />
  </group>, record.object);
}
