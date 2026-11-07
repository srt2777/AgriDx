import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HONGHU_T70_PARTS_URL } from '@/components/tractor-model-info';
import { catalogByName } from '@/components/parts-tractor/parts-catalog';
import { loadPartsTractor, type PartRecord, type PreparedTractor } from '@/components/parts-tractor/load-parts-tractor';
import { probeWebGL } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';

export type FallbackPart = { name: string; labelZh: string };

type Props = {
  selected: string | null;
  autoOrbit: boolean;
  onParts: (parts: FallbackPart[]) => void;
  onSelect: (name: string) => void;
  onReady: () => void;
  onFailed: () => void;
  onUserInteract: () => void;
};

/**
 * Web fallback for the classic-home Pixel Streaming hero: the Honghu T70
 * parts GLB already shipped in the repo (14 exterior / wheel / sensor parts).
 * Framing is computed from the loaded model's own bounding box, so it does
 * not reuse camera numbers tuned for any other model. No depth-of-field
 * post-processing is used here. The annotation text lives outside the
 * canvas (in PixelStreamHero), never overlaid on the model.
 */
export default function T70FallbackScene({ selected, autoOrbit, onParts, onSelect, onReady, onFailed, onUserInteract }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(selected);
  const autoOrbitRef = useRef(autoOrbit);
  const focusRef = useRef<{ camera: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const roamRef = useRef({ x: 0, z: 0 });
  const apiRef = useRef<{
    records: PartRecord[];
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    applyFocus: (name: string | null) => void;
    focusPart: (name: string) => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  useEffect(() => {
    selectedRef.current = selected;
    autoOrbitRef.current = autoOrbit;
  }, [selected, autoOrbit]);

  useEffect(() => {
    const mount = mountRef.current;
    const host = canvasRef.current;
    if (!mount || !host) return undefined;
    if (!probeWebGL()) {
      onFailed();
      return undefined;
    }

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let prepared: PreparedTractor | null = null;
    let controls: OrbitControls | null = null;
    let raf = 0;
    let pmrem: THREE.PMREMGenerator | null = null;
    let environment: THREE.RenderTarget | null = null;
    const clock = new THREE.Clock();
    const downPos = { x: 0, y: 0 };
    let canvasHovered = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    const renderHost = host;

    const applyFocus = (name: string | null) => {
      const api = apiRef.current;
      if (!api) return;
      for (const record of api.records) {
        const active = name != null && record.name === name;
        for (const slot of record.slots) {
          slot.material.opacity = slot.opacity;
          slot.material.transparent = slot.transparent;
          slot.material.depthWrite = slot.depthWrite;
          if (!slot.paint || !slot.color || !slot.emissive) continue;
          slot.paint.color.copy(slot.color);
          if (name && !active) slot.paint.color.multiplyScalar(0.55);
          if (active) {
            slot.paint.emissive.set('#ffffff');
            slot.paint.emissiveIntensity = 0.12;
          } else {
            slot.paint.emissive.copy(slot.emissive);
            slot.paint.emissiveIntensity = slot.emissiveIntensity;
          }
        }
        for (const edge of record.edges) edge.visible = active;
      }
    };

    const focusPart = (name: string) => {
      const api = apiRef.current;
      if (!api) return;
      const record = api.records.find(item => item.name === name);
      if (!record) return;
      const box = new THREE.Box3().setFromObject(record.object);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dir = api.camera.position.clone().sub(api.controls.target).normalize();
      // Sphere-based distance: safe from any viewing angle, unlike an
      // axis-extent estimate, which crops diagonally viewed parts.
      const distance = Math.max(
        (sphere.radius / Math.tan(THREE.MathUtils.degToRad(api.camera.fov / 2))) * 1.3,
        0.9,
      );
      focusRef.current = { camera: center.clone().add(dir.multiplyScalar(distance)), target: center };
    };

    const resize = () => {
      if (!renderer) return;
      const width = renderHost.clientWidth;
      const height = renderHost.clientHeight;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(renderHost);

    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys typed into a form control, and only roam with the
      // keyboard while the pointer is over this canvas.
      if (!canvasHovered) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') roamRef.current.z = -1;
      else if (key === 's' || key === 'arrowdown') roamRef.current.z = 1;
      else if (key === 'a' || key === 'arrowleft') roamRef.current.x = -1;
      else if (key === 'd' || key === 'arrowright') roamRef.current.x = 1;
      else return;
      onUserInteract();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 's' || key === 'arrowup' || key === 'arrowdown') roamRef.current.z = 0;
      if (key === 'a' || key === 'd' || key === 'arrowleft' || key === 'arrowright') roamRef.current.x = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onPointerDown = (event: PointerEvent) => {
      downPos.x = event.clientX;
      downPos.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y) > 6) return;
      const api = apiRef.current;
      if (!api || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, api.camera);
      const hits = raycaster.intersectObjects(api.records.map(record => record.object), true);
      if (hits.length === 0) return;
      let current: THREE.Object3D | null = hits[0].object;
      while (current) {
        if (typeof current.userData?.part_id === 'string') {
          onSelect(current.name);
          onUserInteract();
          return;
        }
        current = current.parent;
      }
    };

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      onFailed();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setSize(renderHost.clientWidth || 320, renderHost.clientHeight || 240, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderHost.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    const onCanvasEnter = () => { canvasHovered = true; };
    const onCanvasLeave = () => { canvasHovered = false; };
    renderHost.addEventListener('pointerenter', onCanvasEnter);
    renderHost.addEventListener('pointerleave', onCanvasLeave);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2433, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(3, 5, 2);
    scene.add(sun);
    pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.55;
    room.dispose();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.4;
    controls.maxDistance = 12;
    controls.autoRotateSpeed = 1.1;
    controls.addEventListener('start', onUserInteract);

    const animate = () => {
      if (disposed || !renderer || !controls) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const move = roamRef.current;
      if ((move.x !== 0 || move.z !== 0) && controls) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 0) forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const step = new THREE.Vector3()
          .addScaledVector(forward, -move.z)
          .addScaledVector(right, move.x)
          .multiplyScalar(dt * 1.2);
        camera.position.add(step);
        controls.target.add(step);
        focusRef.current = null;
      }
      const focus = focusRef.current;
      if (focus && controls) {
        camera.position.lerp(focus.camera, 0.12);
        controls.target.lerp(focus.target, 0.12);
        if (camera.position.distanceTo(focus.camera) < 0.01) focusRef.current = null;
      }
      controls.autoRotate = autoOrbitRef.current && move.x === 0 && move.z === 0 && !focus;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    loadPartsTractor(HONGHU_T70_PARTS_URL, name => catalogByName(name, 't70'))
      .then(next => {
        if (disposed) {
          next.dispose();
          return;
        }
        prepared = next;
        const rig = new THREE.Group();
        rig.add(next.root);
        scene.add(rig);
        rig.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(rig);
        if (box.isEmpty()) throw new Error('T70 model bounds are empty');
        const center = box.getCenter(new THREE.Vector3());
        rig.position.sub(center);
        // Fit the T70's own bounding sphere to the canvas. A sphere fit is
        // direction-independent, so the body stays fully visible from the
        // 3/4 view instead of inheriting another model's camera numbers
        // or an axis-extent estimate that crops diagonally viewed bodies.
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const distance = (sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
        const dir = new THREE.Vector3(0.85, 0.42, 1.15).normalize();
        camera.position.copy(dir.multiplyScalar(distance));
        camera.lookAt(0, 0, 0);
        if (controls) {
          controls.target.set(0, 0, 0);
          controls.maxDistance = Math.max(12, distance * 3);
        }
        apiRef.current = { records: next.records, controls: controls as OrbitControls, camera, applyFocus, focusPart };
        onParts(next.records.map(record => ({ name: record.name, labelZh: record.labelZh })));
        setReady(true);
        onReady();
        resize();
        raf = requestAnimationFrame(animate);
      })
      .catch(() => {
        if (!disposed) onFailed();
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (renderer) {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
      }
      renderHost.removeEventListener('pointerenter', onCanvasEnter);
      renderHost.removeEventListener('pointerleave', onCanvasLeave);
      controls?.dispose();
      prepared?.dispose();
      if (environment) environment.dispose();
      pmrem?.dispose();
      renderer?.dispose();
      if (renderer && renderHost.contains(renderer.domElement)) renderHost.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // Mount once: selection / auto-orbit are read through refs so the
    // WebGL scene is not rebuilt when the user picks a part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    apiRef.current?.applyFocus(selected);
    if (selected) apiRef.current?.focusPart(selected);
    else focusRef.current = null;
  }, [selected, ready]);

  const setRoam = (x: number, z: number, active: boolean) => {
    if (active) {
      roamRef.current.x = x;
      roamRef.current.z = z;
      onUserInteract();
    } else if (roamRef.current.x === x && roamRef.current.z === z) {
      roamRef.current.x = 0;
      roamRef.current.z = 0;
    }
  };

  return (
    <div className="pixel-fallback-scene" ref={mountRef}>
      <div className="pixel-fallback-canvas" ref={canvasRef} />
      {ready && (
        <div className="pixel-roam-pad" aria-label={t('漫游方向', 'Roam controls')}>
          <button type="button" aria-label={t('向前', 'Forward')} onPointerDown={() => setRoam(0, -1, true)} onPointerUp={() => setRoam(0, -1, false)} onPointerLeave={() => setRoam(0, -1, false)}>▲</button>
          <button type="button" aria-label={t('向左', 'Left')} onPointerDown={() => setRoam(-1, 0, true)} onPointerUp={() => setRoam(-1, 0, false)} onPointerLeave={() => setRoam(-1, 0, false)}>◀</button>
          <button type="button" aria-label={t('向右', 'Right')} onPointerDown={() => setRoam(1, 0, true)} onPointerUp={() => setRoam(1, 0, false)} onPointerLeave={() => setRoam(1, 0, false)}>▶</button>
          <button type="button" aria-label={t('向后', 'Back')} onPointerDown={() => setRoam(0, 1, true)} onPointerUp={() => setRoam(0, 1, false)} onPointerLeave={() => setRoam(0, 1, false)}>▼</button>
        </div>
      )}
    </div>
  );
}
