import { useReducedMotion } from 'framer-motion';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';

import { useLang } from '@/hooks/useLang';
import { TRACTOR_COMPONENTS, TRACTOR_MODEL_URL, type TractorComponent } from './tractor-model-info';
import { getComponentBounds, getComponentOwner, isTractorComponent } from './tractor-component-utils';
import { partOpacity, type StudioPresentation } from './studio-schematic';
const OFFSETS: Record<string, [number, number, number]> = {
  body: [-.1, .75, 0], cab: [.4, .8, 0], engine: [-.8, .05, 0],
  drivetrain: [0, 0, 0], hydraulics: [.6, 0, 0], electrical: [-.2, .65, 0], wheels: [0, -.2, 0],
};
function SchematicLeader({ start, end, label }: { start: [number, number, number]; end: [number, number, number]; label: string }) {
  const points = useMemo(() => [start, end], [start, end]);
  return (
    <group>
      <Line points={points} color="#7ad7ff" lineWidth={1} raycast={() => null} />
      <Html position={end} center wrapperClass="tractor-leader" zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <span className="tractor-leader-label">{label}</span>
      </Html>
    </group>
  );
}

const LEADER_OFFSETS: Record<Exclude<TractorComponent, 'all'>, [number, number, number]> = {
  body: [-0.55, 0.35, 0.2],
  cab: [0.45, 0.55, 0.15],
  engine: [-0.7, 0.25, 0.1],
  drivetrain: [0.15, -0.35, 0.45],
  hydraulics: [0.7, 0.15, -0.1],
  electrical: [-0.35, 0.55, -0.15],
  wheels: [0.55, -0.25, 0.35],
};

interface TractorModelProps {
  modelUrl?: string;
  onLoaded?: (object: THREE.Object3D) => void;
  component?: TractorComponent;
  exploded?: boolean;
  interactive?: boolean;
  showHotspots?: boolean;
  presentation?: StudioPresentation;
  leaders?: boolean;
  onComponentSelect?: (component: TractorComponent) => void;
  onLayoutSettled?: (object: THREE.Object3D) => void;
}

/** Original schematic GLB. Cache geometry is shared; all changed materials are cloned. */
export default function TractorModel({ onLoaded, component = 'all', exploded = false, modelUrl = TRACTOR_MODEL_URL, interactive = false, showHotspots = false, presentation = 'solid', leaders = false, onComponentSelect, onLayoutSettled }: TractorModelProps) {
  const lang = useLang();
  const reducedMotion = useReducedMotion();
  const invalidate = useThree(state => state.invalidate);
  const originalModel = modelUrl === TRACTOR_MODEL_URL;
  const callbacks = useRef({ onLoaded, onLayoutSettled });
  const pendingLayout = useRef(false);
  useEffect(() => {
    callbacks.current = { onLoaded, onLayoutSettled };
  }, [onLoaded, onLayoutSettled]);
  const { scene } = useGLTF(modelUrl);
  const model = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    cloned.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const copies = materials.map(material => {
        const copy = material.clone();
        copy.userData = { ...copy.userData, baseOpacity: material.opacity, baseTransparent: material.transparent, baseDepthWrite: material.depthWrite };
        if (copy instanceof THREE.MeshStandardMaterial) {
          copy.envMapIntensity = Math.max(copy.envMapIntensity, 1.25);
          copy.roughness = THREE.MathUtils.clamp(copy.roughness, 0.2, 0.88);
        }
        return copy;
      });
      node.material = Array.isArray(node.material) ? copies : copies[0];
      node.castShadow = true;
      node.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (box.isEmpty() || !Number.isFinite(maxDimension) || maxDimension <= 0) {
      throw new Error('GLB contains no visible geometry');
    }
    cloned.scale.setScalar(2.8 / maxDimension);
    cloned.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(cloned);
    const center = scaled.getCenter(new THREE.Vector3());
    cloned.position.set(-center.x, -scaled.min.y - .4, -center.z);
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [scene]);

  const componentGroups = useMemo(() => {
    const groups: { id: Exclude<TractorComponent, 'all'>; object: THREE.Object3D; basePosition: THREE.Vector3; target: THREE.Vector3 }[] = [];
    if (originalModel) model.traverse(object => {
      if (isTractorComponent(object.userData.component)) {
        groups.push({ id: object.userData.component, object, basePosition: object.position.clone(), target: object.position.clone() });
      }
    });
    return groups;
  }, [model, originalModel]);

  const leaderMarks = useMemo(() => componentGroups.map(({ id, object }) => {
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return null;
    const start = object.worldToLocal(bounds.getCenter(new THREE.Vector3()));
    const end = start.clone().add(new THREE.Vector3(...LEADER_OFFSETS[id]));
    return {
      id,
      object,
      start: start.toArray() as [number, number, number],
      end: end.toArray() as [number, number, number],
    };
  }).filter(item => item !== null), [componentGroups]);

  const hotspots = useMemo(() => componentGroups.map(({ id, object }) => {
    const bounds = getComponentBounds(model, id);
    if (bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3());
    const anchor = bounds.getCenter(new THREE.Vector3());
    // Keep anchors on the visible outer edge of the real component bounds.
    anchor.z = bounds.max.z + Math.max(size.z * .04, .04);
    if (id === 'cab') anchor.y = bounds.max.y + .04;
    else if (id === 'body') anchor.x = bounds.min.x + size.x * .18;
    else if (id === 'electrical') anchor.x = bounds.min.x;
    else if (id === 'wheels') anchor.x = bounds.max.x - size.x * .22;
    return { id, object, position: object.worldToLocal(anchor).toArray() as [number, number, number] };
  }).filter(item => item !== null), [model, componentGroups]);

  // Keep component separation fluid when switching between overview and exploded
  // views. The previous implementation snapped every group to its offset, which
  // made the structure feel disconnected and could briefly occlude the chassis.
  useEffect(() => {
    componentGroups.forEach(group => {
      group.target.copy(group.basePosition);
      if (exploded) group.target.add(new THREE.Vector3(...OFFSETS[group.id]));
    });
    pendingLayout.current = true;
    invalidate();
  }, [componentGroups, exploded, invalidate]);

  useFrame((state, delta) => {
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 8);
    let geometryMoving = false;
    let materialMoving = false;
    componentGroups.forEach(({ object, target }) => {
      object.position.lerp(target, alpha);
      if (object.position.distanceToSquared(target) > 0.0004) geometryMoving = true;
      else object.position.copy(target);
    });
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        const targetOpacity = material.userData.targetOpacity as number | undefined;
        if (targetOpacity === undefined) return;
        material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, alpha);
        if (Math.abs(material.opacity - targetOpacity) > 0.002) materialMoving = true;
        else {
          material.opacity = targetOpacity;
          if (targetOpacity === material.userData.baseOpacity) {
            if (material.transparent !== material.userData.baseTransparent) material.needsUpdate = true;
            material.transparent = material.userData.baseTransparent;
            material.depthWrite = material.userData.baseDepthWrite;
          }
        }
      });
    });
    if (geometryMoving || materialMoving) state.invalidate();
    if (!geometryMoving && pendingLayout.current) {
      pendingLayout.current = false;
      model.updateWorldMatrix(true, true);
      callbacks.current.onLayoutSettled?.(model);
    }
  });

  useEffect(() => () => model.traverse(node => {
    if (node instanceof THREE.Mesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => material.dispose());
    }
  }), [model]);

  useEffect(() => {
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const owner = getComponentOwner(node)?.userData.component;
      const selected = !originalModel || component === 'all' || owner === component;
      const viewingAll = !originalModel || component === 'all';
      const mode = originalModel ? presentation : 'solid';
      node.castShadow = selected && mode !== 'xray';
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        const targetOpacity = partOpacity(mode, selected, viewingAll, material.userData.baseOpacity ?? 1);
        material.userData.targetOpacity = targetOpacity;
        material.transparent = true;
        material.depthWrite = targetOpacity > 0.5 ? material.userData.baseDepthWrite : false;
        material.needsUpdate = true;
      });
    });
    invalidate();
  }, [model, component, originalModel, presentation, invalidate]);

  useEffect(() => {
    model.updateWorldMatrix(true, true);
    callbacks.current.onLoaded?.(model);
  }, [model]);

  const handleMeshClick = (event: ThreeEvent<MouseEvent>) => {
    if (!originalModel || !interactive || event.delta > 4) return;
    const owner = getComponentOwner(event.object);
    if (!owner) return;
    event.stopPropagation();
    onComponentSelect?.(owner.userData.component as TractorComponent);
  };

  return <>
    <primitive object={model} onClick={originalModel && interactive ? handleMeshClick : undefined} dispose={null} />
    {originalModel && interactive && showHotspots && hotspots.map(({ id, object, position }, index) => {
      const info = TRACTOR_COMPONENTS.find(item => item.id === id)!;
      const label = lang === 'zh' ? info.zh : info.en;
      const selected = component === id;
      return <Fragment key={id}>{createPortal(
        <Html position={position} center wrapperClass="tractor-hotspot-anchor" zIndexRange={[12, 1]}>
          <button
            type="button"
            className="tractor-hotspot"
            style={{ minWidth: 36, minHeight: 36 }}
            aria-label={lang === 'zh' ? `选择${label}` : `Select ${label}`}
            aria-pressed={selected}
            title={label}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onComponentSelect?.(id); }}
          >
            <span className="tractor-hotspot-dot" aria-hidden="true">{index + 1}</span>
            {selected && <span className="tractor-hotspot-label">{label}</span>}
          </button>
        </Html>, object,
      )}</Fragment>;
    })}
    {originalModel && leaders && leaderMarks.map(({ id, object, start, end }) => {
      if (presentation === 'isolate' && component !== 'all' && component !== id) return null;
      const info = TRACTOR_COMPONENTS.find(item => item.id === id)!;
      const label = lang === 'zh' ? info.zh : info.en;
      return <Fragment key={`leader-${id}`}>{createPortal(
        <SchematicLeader start={start} end={end} label={label} />, object,
      )}</Fragment>;
    })}
  </>;
}
