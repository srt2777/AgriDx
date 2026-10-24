import * as THREE from 'three';

/** Include every endpoint of the existing part explosion in the shadow volume. */
export function studioShadowVolume(bounds: THREE.Box3, offsets: readonly THREE.Vector3[]) {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const spread = offsets.reduce((maximum, offset) => Math.max(maximum, offset.length()), 0);
  const radius = Math.max(.05, sphere.radius + spread);
  return { center: sphere.center, radius, extent: radius * 1.2, near: radius * .1, far: radius * 14, normalBias: radius * .0015 };
}

export function studioQuality(constrained: boolean) {
  return constrained
    ? { dpr: [1, 1.25] as [number, number], shadowSize: 1024, anisotropy: 4 }
    : { dpr: [1, 1.75] as [number, number], shadowSize: 2048, anisotropy: 8 };
}
