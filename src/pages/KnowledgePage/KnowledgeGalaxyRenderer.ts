import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface GalaxyOrb {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
  children: number;
  centre: boolean;
}
interface OrbVisual {
  group: THREE.Group;
  surface: THREE.Mesh;
  halo: THREE.Mesh;
  stars: THREE.Points;
  orbit: THREE.Mesh;
}

/** Browser-native WebGL renderer. No UE runtime or remote streaming is involved. */
export class KnowledgeGalaxyRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private visuals = new Map<string, OrbVisual>();
  private sphere = new THREE.SphereGeometry(1, 48, 32);
  private ring = new THREE.TorusGeometry(1.24, 0.003, 6, 96);
  private field: THREE.Points;
  private starTexture = (() => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const radius = Math.hypot((x - 7.5) / 7.5, (y - 7.5) / 7.5);
        pixels.set([255, 255, 255, Math.round(Math.max(0, 1 - radius) ** 2 * 255)], (y * 16 + x) * 4);
      }
    const texture = new THREE.DataTexture(pixels, 16, 16);
    texture.needsUpdate = true;
    return texture;
  })();
  private nebula: THREE.Mesh;
  private width = 0;
  private height = 0;
  private lost: (event: Event) => void;
  readonly canvas: HTMLCanvasElement;

  constructor(host: HTMLElement, onLost: () => void) {
    this.renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'universe-webgl';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor('#020712');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.camera.position.z = 1200;
    this.scene.add(new THREE.AmbientLight('#83a5c4', 0.22));
    const key = new THREE.DirectionalLight('#e4fff7', 1.8);
    key.position.set(-350, 450, 800);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#587bf5', 1.25);
    rim.position.set(500, -100, -300);
    this.scene.add(rim);
    const warm = new THREE.PointLight('#ffc477', 65000, 2000, 2);
    warm.position.set(-300, 100, 400);
    this.scene.add(warm);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      positions[i * 3] = Math.sin(i * 127.1) * 0.5 * 2200;
      positions[i * 3 + 1] = Math.sin(i * 311.7) * 0.5 * 1300;
      positions[i * 3 + 2] = -100 - (i % 31) * 25;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.field = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: '#b5d4ff',
        map: this.starTexture,
        alphaTest: 0.01,
        size: 1.35,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.scene.add(this.field);
    this.nebula = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 1600),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { phase: { value: 0 } },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 vUv; uniform float phase;
        void main(){vec2 p=(vUv-.5)*vec2(1.6,1.);float cloud=exp(-dot(p,p)*5.);
        float folds=.5+.5*sin(p.x*12.+sin(p.y*8.+phase)*2.);vec3 c=mix(vec3(.025,.035,.16),vec3(.015,.20,.20),folds);
        gl_FragColor=vec4(c*.09,cloud*.6);}`,
      }),
    );
    this.nebula.position.z = -700;
    this.scene.add(this.nebula);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.65, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.lost = (event) => {
      event.preventDefault();
      onLost();
    };
    this.canvas.addEventListener('webglcontextlost', this.lost);
    host.insertBefore(this.canvas, host.querySelector('canvas'));
  }

  private orb(item: GalaxyOrb): OrbVisual {
    const group = new THREE.Group();
    const color = new THREE.Color(item.color);
    const surface = new THREE.Mesh(
      this.sphere,
      new THREE.MeshPhysicalMaterial({
        color: color.clone().multiplyScalar(0.55),
        metalness: 0.35,
        roughness: 0.48,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
        emissive: color.clone().multiplyScalar(0.025),
      }),
    );
    const material = surface.material as THREE.MeshPhysicalMaterial;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 galaxyPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngalaxyPosition=position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 galaxyPosition;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat bands=.82+.12*sin(galaxyPosition.y*32.+sin(galaxyPosition.x*12.)*2.);diffuseColor.rgb*=bands;',
        );
    };
    material.customProgramCacheKey = () => 'knowledge-surface-v1';
    group.add(surface);
    const halo = new THREE.Mesh(
      this.sphere,
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { tint: { value: color } },
        vertexShader:
          'varying vec3 n; void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'varying vec3 n;uniform vec3 tint;void main(){float f=pow(1.-abs(normalize(n).z),3.);gl_FragColor=vec4(tint*1.1,f*.35);}',
      }),
    );
    halo.scale.setScalar(1.025);
    group.add(halo);
    const starGeometry = new THREE.BufferGeometry();
    const count = Math.min(60, item.children),
      points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = 1 - (2 * (i + 0.5)) / count,
        r = Math.sqrt(1 - y * y),
        a = i * 2.39996;
      points.set([Math.cos(a) * r * 1.018, y * 1.018, Math.sin(a) * r * 1.018], i * 3);
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: '#d9fff8',
        map: this.starTexture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        size: item.centre ? 3.6 : 2.2,
        toneMapped: false,
      }),
    );
    group.add(stars);
    const orbit = new THREE.Mesh(
      this.ring,
      new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(1.8),
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    orbit.rotation.set(1.1, 0.25, -0.35);
    group.add(orbit);
    this.scene.add(group);
    return { group, surface, halo, stars, orbit };
  }

  render(
    width: number,
    height: number,
    items: GalaxyOrb[],
    time: number,
    yaw: number,
    pitch: number,
    reduced: boolean,
  ) {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.composer.setSize(width, height);
      this.camera.left = -width / 2;
      this.camera.right = width / 2;
      this.camera.top = height / 2;
      this.camera.bottom = -height / 2;
      this.camera.updateProjectionMatrix();
    }
    const active = new Set(items.map((item) => item.id));
    for (const [id, visual] of this.visuals)
      if (!active.has(id)) {
        this.releaseOrb(visual);
        this.visuals.delete(id);
      }
    for (const item of items) {
      const visual = this.visuals.get(item.id) ?? this.orb(item);
      this.visuals.set(item.id, visual);
      visual.group.position.set(item.x - width / 2, height / 2 - item.y, item.z * 140);
      visual.group.scale.setScalar(item.radius);
      visual.surface.rotation.set(pitch, yaw, 0.15);
      visual.stars.rotation.set(pitch, yaw, 0.15);
      visual.orbit.rotation.z = -0.35 + (reduced ? 0 : Math.sin(time * 0.00015) * 0.12);
    }
    this.field.rotation.y = yaw * 0.035;
    this.field.position.y = pitch * 20;
    (this.nebula.material as THREE.ShaderMaterial).uniforms.phase.value = reduced ? 0 : time * 0.00007;
    this.composer.render();
  }

  private releaseOrb(visual: OrbVisual) {
    this.scene.remove(visual.group);
    (visual.surface.material as THREE.Material).dispose();
    (visual.halo.material as THREE.Material).dispose();
    visual.stars.geometry.dispose();
    (visual.stars.material as THREE.Material).dispose();
    (visual.orbit.material as THREE.Material).dispose();
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    for (const visual of this.visuals.values()) this.releaseOrb(visual);
    this.visuals.clear();
    this.starTexture.dispose();
    this.sphere.dispose();
    this.ring.dispose();
    this.field.geometry.dispose();
    (this.field.material as THREE.Material).dispose();
    this.nebula.geometry.dispose();
    (this.nebula.material as THREE.Material).dispose();
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
