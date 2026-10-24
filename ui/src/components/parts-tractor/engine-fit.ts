import * as THREE from 'three';

/** Fit in part-local coordinates; neither model quantization nor exploded position changes the fit. */
export function fitEngineToPart(part: THREE.Object3D) {
  part.updateWorldMatrix(true, true);
  const inverse = part.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  part.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.computeBoundingBox();
    if (child.geometry.boundingBox) bounds.union(child.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(child.matrixWorld)));
  });
  if (bounds.isEmpty()) throw new Error('Engine part has no geometry');
  const size = bounds.getSize(new THREE.Vector3());
  const scale = Math.min(size.x / 4.8, size.y / 2.6, size.z / 1.3) * .95;
  const center = bounds.getCenter(new THREE.Vector3());
  return { scale, position: [center.x, center.y - .45 * scale, center.z] as [number, number, number] };
}
