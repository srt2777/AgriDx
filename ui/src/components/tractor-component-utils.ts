import * as THREE from 'three';
import type { TractorComponent } from './tractor-model-info';

const COMPONENT_IDS: ReadonlySet<string> = new Set<Exclude<TractorComponent, 'all'>>([
  'body', 'engine', 'drivetrain', 'hydraulics', 'electrical', 'wheels', 'cab',
]);

export function isTractorComponent(value: unknown): value is Exclude<TractorComponent, 'all'> {
  return typeof value === 'string' && COMPONENT_IDS.has(value);
}

/** GLB metadata can be placed on a mesh itself or on any containing group. */
export function getComponentOwner(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (isTractorComponent(current.userData.component)) return current;
    current = current.parent;
  }
  return null;
}

export function getComponentMeshes(model: THREE.Object3D, component: TractorComponent): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh && (component === 'all' || getComponentOwner(object)?.userData.component === component)) {
      meshes.push(object);
    }
  });
  return meshes;
}

/** World-space bounds of the actual meshes, including nested and exploded transforms. */
export function getComponentBounds(model: THREE.Object3D, component: TractorComponent): THREE.Box3 {
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  for (const mesh of getComponentMeshes(model, component)) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      bounds.union(meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    }
  }
  return bounds;
}
