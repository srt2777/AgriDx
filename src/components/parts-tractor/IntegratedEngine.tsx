import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import EngineMechanism from '@/components/engine-demo/EngineMechanism';
import type { PartRecord } from './load-parts-tractor';
import { fitEngineToPart } from './engine-fit';
import type { StudioPresentation } from './parts-motion';

/** Attach in engine-local coordinates, so the tractor's existing explode transform carries it. */
export default function IntegratedEngine({ record, running, speed, explode, visible, presentation }: {
  record: PartRecord; running: boolean; speed: number; explode: number; visible: boolean; presentation: StudioPresentation;
}) {
  const { invalidate } = useThree();
  const host = useRef<THREE.Group>(null);
  const paints = useRef<THREE.MeshStandardMaterial[]>([]);
  const fit = useMemo(() => fitEngineToPart(record.object), [record]);
  useEffect(() => {
    const materials = new Set<THREE.MeshStandardMaterial>();
    host.current?.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
      }
    });
    paints.current = [...materials];
    for (const slot of record.slots) slot.material.visible = false;
    for (const edge of record.edges) edge.visible = false;
    invalidate();
    return () => { for (const slot of record.slots) slot.material.visible = true; };
  }, [record, invalidate]);
  useFrame(() => {
    // Keep selection and example-fault lighting on the replacement geometry.
    const source = record.slots.find(slot => slot.paint)?.paint;
    if (!source) return;
    for (const material of paints.current) {
      material.emissive.copy(source.emissive);
      material.emissiveIntensity = source.emissiveIntensity;
    }
  });
  return createPortal(<group ref={host} visible={visible} position={fit.position} scale={fit.scale} userData={{ integratedEngine: true }}>
    <EngineMechanism running={running} speed={speed} explode={explode} transparent={presentation !== 'solid' || running} />
  </group>, record.object);
}
