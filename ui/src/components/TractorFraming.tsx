import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useBounds } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls } from 'three-stdlib';
import type { TractorComponent } from './tractor-model-info';
import { getComponentBounds } from './tractor-component-utils';
import { TRACTOR_VIEWS, type TractorView } from './tractor-view-config';

/** One framing controller for loading, component selection, views and resizing. */
export default function TractorFraming({ model, component, view, request, layoutRevision }: {
  model: THREE.Object3D | null;
  component: TractorComponent;
  view: TractorView;
  request: number;
  layoutRevision: number;
}) {
  const bounds = useBounds();
  const { camera, controls, size, invalidate } = useThree();
  useEffect(() => {
    if (!model || !(camera instanceof THREE.PerspectiveCamera) || !controls) return;
    model.updateWorldMatrix(true, true);
    const whole = getComponentBounds(model, 'all');
    const selected = getComponentBounds(model, component);
    const box = selected.isEmpty() ? whole : selected;
    if (box.isEmpty()) return;
    bounds.refresh(box);
    const { center, size: dimensions } = bounds.getSize();
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    // A bounding sphere fits every orientation, including tall imported models.
    const distance = dimensions.length() / 2 / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.25;
    const direction = new THREE.Vector3(...TRACTOR_VIEWS.find(item => item.id === view)!.direction).normalize();
    const position = center.clone().addScaledVector(direction, distance);
    bounds.moveTo(position).lookAt({ target: center });
    const orbit = controls as OrbitControls;
    orbit.minDistance = Math.max(.12, Math.max(dimensions.x, dimensions.y, dimensions.z) * .3);
    orbit.maxDistance = Math.max(whole.getSize(new THREE.Vector3()).length() * 4, distance * 1.8);
    invalidate();
  }, [bounds, camera, controls, model, component, view, request, layoutRevision, size.width, size.height, invalidate]);
  return null;
}
