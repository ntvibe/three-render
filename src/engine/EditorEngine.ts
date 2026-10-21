import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DenoiseMaterial, PhysicalSpotLight, ShapedAreaLight, WebGLPathTracer } from 'three-gpu-pathtracer';
import { DEFAULT_DIFFUSE_MATERIAL_ID, createMaterialRecord } from '../core/materials';
import { createPrimitiveMesh, createPrimitiveGeometry, normalizePrimitiveParameters } from '../core/primitives';
import { installSpectralDispersionShader, syncSpectralDispersion } from './spectralDispersion';
import { installRealtimeGlassShader } from './realtimeGlass';
import { installAreaShadows } from './areaShadows';
import { normalizeShadowSpread } from '../core/lights';
import { getIsolationNodeIds, isObjectVisible } from '../core/sceneVisibility';
import type {
  AssetRecord,
  CameraRecord,
  InvalidationReason,
  MaterialRecord,
  MeshBindingRecord,
  ProjectDocument,
  RenderMode,
  RenderStatus,
  TransformMode,
  TransformSpace,
  Vec3Tuple,
} from '../core/types';

interface EngineSnapshot {
  project: ProjectDocument;
  selectedNodeId: string | null;
  transformMode: TransformMode;
  axisEditMode?: boolean;
  transformSpace: TransformSpace;
  snapEnabled: boolean;
  translateSnap: number;
  rotateSnap: number;
  scaleSnap: number;
}

interface RuntimeAssetTemplate {
  scene: THREE.Object3D;
  meshBindings: MeshBindingRecord[];
  materials: MaterialRecord[];
}

interface EditorEngineOptions {
  onSelectNode: (nodeId: string | null) => void;
  onTransformChange: (
    nodeId: string,
    transform: {
      position: Vec3Tuple;
      rotation: Vec3Tuple;
      scale: Vec3Tuple;
    },
    recordHistory: boolean,
  ) => void;
  onDiscoveredMetadata: (payload: {
    assetId: string;
    meshBindings: MeshBindingRecord[];
    materials: MaterialRecord[];
  }) => void;
  onRenderStatus: (status: Partial<RenderStatus>) => void;
  onCameraChange: (payload: {
    position: Vec3Tuple;
    target: Vec3Tuple;
    zoom: number;
  }) => void;
}

function toTuple(vector: THREE.Vector3 | THREE.Euler): Vec3Tuple {
  return [vector.x, vector.y, vector.z];
}

function toPhysicalMaterial(
  source: THREE.Material,
  fallbackName: string,
): THREE.MeshPhysicalMaterial {
  if (source instanceof THREE.MeshPhysicalMaterial) {
    return source.clone();
  }
  const material = new THREE.MeshPhysicalMaterial();
  const candidate = source as THREE.MeshStandardMaterial & {
    attenuationColor?: THREE.Color;
    attenuationDistance?: number;
  };
  material.name = source.name || fallbackName;
  material.color.copy(candidate.color ?? new THREE.Color('#ffffff'));
  material.roughness = candidate.roughness ?? 0.2;
  material.metalness = candidate.metalness ?? 0;
  material.map = candidate.map ?? null;
  material.normalMap = candidate.normalMap ?? null;
  material.normalScale.copy(candidate.normalScale ?? new THREE.Vector2(1, 1));
  material.emissive.copy(candidate.emissive ?? new THREE.Color('#000000'));
  material.emissiveIntensity = candidate.emissiveIntensity ?? 0;
  material.aoMap = candidate.aoMap ?? null;
  material.transparent = candidate.transparent ?? false;
  material.opacity = candidate.opacity ?? 1;
  material.side = candidate.side ?? THREE.FrontSide;
  material.flatShading = candidate.flatShading ?? false;
  material.vertexColors = candidate.vertexColors ?? false;
  material.transmission = 0;
  material.ior = 1.5;
  material.thickness = 0;
  material.clearcoat = 0;
  material.clearcoatRoughness = 0;
  material.attenuationColor = candidate.attenuationColor?.clone() ?? new THREE.Color('#ffffff');
  material.attenuationDistance = candidate.attenuationDistance ?? Infinity;
  if (material.transmission > 0.001) {
    material.transparent = true;
    material.side = THREE.DoubleSide;
  }
  return material;
}

function materialToRecord(id: string, material: THREE.MeshPhysicalMaterial): MaterialRecord {
  const attenuationDistance = Number.isFinite(material.attenuationDistance)
    ? material.attenuationDistance
    : 0;
  return createMaterialRecord({
    id,
    name: material.name || 'Material',
    color: `#${material.color.getHexString()}`,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: material.emissiveIntensity,
    roughness: material.roughness,
    metalness: material.metalness,
    specularIntensity: material.specularIntensity,
    specularColor: `#${material.specularColor.getHexString()}`,
    transmission: material.transmission,
    ior: material.ior,
    thickness: material.thickness,
    thinWalled: material.userData.threeRenderThinWalled ?? (material.thickness === 0 && material.transmission > 0),
    attenuationColor: `#${material.attenuationColor.getHexString()}`,
    attenuationDistance,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    sheen: material.sheen,
    sheenColor: `#${material.sheenColor.getHexString()}`,
    sheenRoughness: material.sheenRoughness,
    iridescence: material.iridescence,
    iridescenceIOR: material.iridescenceIOR,
    iridescenceThicknessMin: material.iridescenceThicknessRange[0],
    iridescenceThicknessMax: material.iridescenceThicknessRange[1],
    anisotropy: material.anisotropy,
    anisotropyRotation: material.anisotropyRotation,
    dispersion: material.dispersion,
    opacity: material.opacity,
    transparent: material.transparent,
  });
}

function applyRecordToMaterial(
  record: MaterialRecord,
  material: THREE.MeshPhysicalMaterial,
): void {
  material.name = record.name;
  material.color.set(record.color);
  material.emissive.set(record.emissive);
  material.emissiveIntensity = record.emissiveIntensity;
  material.roughness = record.roughness;
  material.metalness = record.metalness;
  material.specularIntensity = record.specularIntensity;
  material.specularColor.set(record.specularColor);
  material.transmission = record.transmission;
  material.ior = record.ior;
  material.thickness = record.thinWalled ? 0 : record.thickness;
  material.userData.threeRenderThinWalled = record.thinWalled ?? false;
  material.attenuationColor.set(record.attenuationColor);
  material.attenuationDistance =
    record.attenuationDistance > 0 ? record.attenuationDistance : Infinity;
  material.clearcoat = record.clearcoat;
  material.clearcoatRoughness = record.clearcoatRoughness;
  material.sheen = record.sheen;
  material.sheenColor.set(record.sheenColor);
  material.sheenRoughness = record.sheenRoughness;
  material.iridescence = record.iridescence;
  material.iridescenceIOR = record.iridescenceIOR;
  material.iridescenceThicknessRange = [
    record.iridescenceThicknessMin,
    record.iridescenceThicknessMax,
  ];
  material.anisotropy = record.anisotropy;
  material.anisotropyRotation = record.anisotropyRotation;
  material.dispersion = record.dispersion;
  material.opacity = record.opacity;
  material.transparent = record.opacity < 1 || (record.transparent && record.transmission <= 0.001);
  // Closed glass renders its front interface in raster mode. The path tracer
  // automatically packs solid transmitters as double-sided for entry/exit tracing.
  material.side = THREE.FrontSide;
  installRealtimeGlassShader(material);
  material.needsUpdate = true;
}

function createDefaultDiffuseMaterial(label: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    name: `${label} Default`,
    color: new THREE.Color('#c6c8cb'),
    roughness: 1,
    metalness: 0,
    specularIntensity: 0.2,
  });
}

export class EditorEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly controls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly gltfLoader = new GLTFLoader();
  private readonly exrLoader = new EXRLoader();
  private readonly hdrLoader = new HDRLoader();
  private readonly cameraPerspective = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private readonly cameraOrthographic = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 200);
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly runtimeRoot = new THREE.Group();
  private readonly grid = new THREE.GridHelper(20, 200, 0x454a50, 0x30353a);
  private readonly solidOverrideMaterial = new THREE.MeshNormalMaterial();
  private readonly options: EditorEngineOptions;
  private readonly nodeObjects = new Map<string, THREE.Object3D>();
  private readonly assetTemplates = new Map<string, Promise<RuntimeAssetTemplate>>();
  private readonly environmentCache = new Map<string, Promise<THREE.Texture>>();
  private readonly pathTracer: WebGLPathTracer | null;
  private readonly denoiseMaterial = new DenoiseMaterial({ sigma: 2, kSigma: 2, threshold: 0.35 });
  private readonly denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
  private readonly denoiseTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private presentPathTrace: (() => void) | null = null;
  private lastPresentationSignature = '';
  private lastTopologySignature = '';
  private lastTransformSignature = '';
  private lastMaterialSignature = '';
  private lastLightSignature = '';
  private lastEnvironmentSignature = '';
  private lastAppliedCameraSignature = '';
  private lastRenderSignature = '';
  private renderSampleCount = 0;
  private invalidationReasons = new Set<InvalidationReason>();
  private latestSnapshot: EngineSnapshot | null = null;
  private transformSessionNodeId: string | null = null;
  private pointerDown = false;
  private pointerMoved = false;
  private pointerDownScreen = new THREE.Vector2();
  private cameraMovedDuringPointer = false;
  private suppressPointerSelection = false;
  private pathTracerRuntimeFailed = false;
  private pathTracerSceneReady = false;
  private navigationKey: string | null = null;
  private animationFrame = 0;
  private disposed = false;
  private readonly pendingCompiles = new Set<Promise<unknown>>();
  private syncRunning = false;
  private pendingSync: InvalidationReason | null = null;
  private isolationNodeIds: Set<string> | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options: EditorEngineOptions,
  ) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      canvas,
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearAlpha(1);
    // Three's parallel shader polling still reads renderer properties until it
    // resolves. Retain GPU resources during an unmount/hot reload until then.
    const compileAsync = this.renderer.compileAsync.bind(this.renderer);
    this.renderer.compileAsync = (...args) => {
      const promise = compileAsync(...args);
      this.pendingCompiles.add(promise);
      void promise.then(() => this.pendingCompiles.delete(promise), () => this.pendingCompiles.delete(promise));
      return promise;
    };
    RectAreaLightUniformsLib.init();
    this.activeCamera = this.cameraPerspective;
    this.cameraPerspective.position.set(0, 1.4, 4.2);
    this.cameraOrthographic.position.copy(this.cameraPerspective.position);
    this.cameraOrthographic.zoom = 90;

    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = false;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 0.01;
    this.controls.target.set(0, 0.65, 0);
    this.controls.addEventListener('change', () => {
      if (this.pointerDown && this.controls.enabled) {
        this.cameraMovedDuringPointer = true;
      }
      this.invalidate('camera');
    });
    this.controls.addEventListener('end', () => {
      this.options.onCameraChange({
        position: toTuple(this.activeCamera.position),
        target: toTuple(this.controls.target),
        zoom:
          this.activeCamera instanceof THREE.OrthographicCamera
            ? this.activeCamera.zoom
            : 1,
      });
    });

    this.transformControls = new TransformControls(this.activeCamera, canvas);
    this.overlayScene.add(this.transformControls.getHelper());
    this.transformControls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.controls.enabled = !dragging;
      if (dragging) {
        this.transformSessionNodeId = this.getAttachedNodeId();
        this.suppressPointerSelection = true;
      } else if (this.transformSessionNodeId) {
        this.syncNodeTransformFromObject(this.transformSessionNodeId, true);
        this.transformSessionNodeId = null;
      }
    });
    this.transformControls.addEventListener('objectChange', () => {
      const nodeId = this.getAttachedNodeId();
      if (!nodeId) return;
      this.syncNodeTransformFromObject(nodeId, false);
      this.invalidate('transform');
    });

    this.grid.position.y = 0;
    this.scene.add(this.runtimeRoot, this.grid);
    this.scene.backgroundBlurriness = 0;

    try {
      this.pathTracer = new WebGLPathTracer(this.renderer);
      this.pathTracer.renderToCanvas = true;
      this.pathTracer.multipleImportanceSampling = true;
      installSpectralDispersionShader(this.pathTracer);
      installAreaShadows(this.pathTracer);
      this.denoiseMaterial.uniforms.denoiseBlend = { value: 0.6 };
      this.denoiseMaterial.fragmentShader = this.denoiseMaterial.fragmentShader
        .replace('uniform float opacity;', 'uniform float opacity;\n uniform float denoiseBlend;')
        .replace('gl_FragColor = smartDeNoise( map, vec2( vUv.x, vUv.y ), sigma, kSigma, threshold );', `
          vec4 raw = texture2D( map, vUv );
          raw.rgb *= raw.a;
          gl_FragColor = mix( raw, smartDeNoise( map, vUv, sigma, kSigma, threshold ), denoiseBlend );
          if (gl_FragColor.a > 0.0) gl_FragColor.rgb /= gl_FragColor.a;`);
      const presentRaw = this.pathTracer.renderToCanvasCallback;
      this.pathTracer.renderToCanvasCallback = (target, renderer, quad) => {
        this.presentPathTrace = () => {
          const settings = this.latestSnapshot?.project.renderer;
          const original = quad.material;
          const display = original as THREE.ShaderMaterial;
          const originalMap = display.uniforms.map.value;
          const denoise = settings?.denoise.enabled &&
            (settings.mode === 'render' || settings.denoise.applyToLive) && original.opacity >= 1;
          try {
            if (denoise) {
              this.denoiseMaterial.map = target.texture;
              this.denoiseMaterial.uniforms.denoiseBlend.value = settings.denoise.blend;
              this.denoiseTarget.setSize(target.width, target.height);
              const renderTarget = renderer.getRenderTarget();
              const toneMapping = renderer.toneMapping;
              const autoClear = renderer.autoClear;
              try {
                renderer.setRenderTarget(this.denoiseTarget);
                renderer.toneMapping = THREE.NoToneMapping;
                renderer.autoClear = true;
                this.denoiseQuad.render(renderer);
              } finally {
                renderer.setRenderTarget(renderTarget);
                renderer.toneMapping = toneMapping;
                renderer.autoClear = autoClear;
              }
              // Preserve the renderer's original tone mapping and interpolation.
              display.uniforms.map.value = this.denoiseTarget.texture;
            }
            presentRaw(target, renderer, quad);
          } finally {
            display.uniforms.map.value = originalMap;
          }
          this.lastPresentationSignature = this.getPresentationSignature();
        };
        this.presentPathTrace();
      };
    } catch {
      this.pathTracer = null;
    }

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('keydown', this.handleNavigationKeyDown);
    window.addEventListener('keyup', this.handleNavigationKeyUp);
    window.addEventListener('blur', this.resetNavigation);

    this.handleResize();
    this.animate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('keydown', this.handleNavigationKeyDown);
    window.removeEventListener('keyup', this.handleNavigationKeyUp);
    window.removeEventListener('blur', this.resetNavigation);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.controls.dispose();
    this.transformControls.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.solidOverrideMaterial.dispose();
    this.presentPathTrace = null;
    const releaseGpu = () => {
      this.pathTracer?.dispose(); this.denoiseQuad.dispose(); this.denoiseMaterial.dispose();
      this.denoiseTarget.dispose(); this.renderer.dispose();
    };
    if (this.pendingCompiles.size) void Promise.allSettled([...this.pendingCompiles]).then(releaseGpu);
    else releaseGpu();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.invalidate('settings');
  }

  frameSelection(all = false): void {
    this.runtimeRoot.updateMatrixWorld(true);
    const selectedId = this.latestSnapshot?.selectedNodeId;
    const selected = selectedId ? this.nodeObjects.get(selectedId) : null;
    const bounds = new THREE.Box3();
    if (!all && selected) bounds.setFromObject(selected);
    else {
      this.nodeObjects.forEach((object, id) => {
        const node = this.latestSnapshot?.project.nodes[id];
        const asset = node?.assetId ? this.latestSnapshot?.project.assets[node.assetId] : null;
        if (node?.nodeType === 'asset' && object.visible && asset?.catalogItemId !== 'backdrop'
          && asset?.primitive !== 'plane') bounds.union(new THREE.Box3().setFromObject(object));
      });
      if (bounds.isEmpty()) bounds.setFromObject(this.runtimeRoot);
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const direction = this.activeCamera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 0.7, 1).normalize();
    if (this.activeCamera instanceof THREE.PerspectiveCamera) {
      const halfFov = THREE.MathUtils.degToRad(this.activeCamera.getEffectiveFOV() / 2);
      const angle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.activeCamera.aspect));
      this.activeCamera.position.copy(center).addScaledVector(direction, radius / Math.sin(angle) * 1.25);
    } else {
      this.activeCamera.zoom = Math.min(
        (this.activeCamera.right - this.activeCamera.left) / Math.max(size.x, size.z, 0.01),
        (this.activeCamera.top - this.activeCamera.bottom) / Math.max(size.y, size.z, 0.01),
      ) / 1.5;
      this.activeCamera.position.copy(center).addScaledVector(direction, radius * 4);
      this.activeCamera.updateProjectionMatrix();
    }
    this.controls.target.copy(center);
    this.controls.update();
    this.publishCameraPose();
  }

  setView(view: 'perspective' | 'front' | 'back' | 'top' | 'right'): void {
    const distance = Math.max(this.activeCamera.position.distanceTo(this.controls.target), 0.1);
    const direction = view === 'front' ? new THREE.Vector3(0, 0, 1)
      : view === 'back' ? new THREE.Vector3(0, 0, -1)
      : view === 'top' ? new THREE.Vector3(0, 1, 0.0001)
      : view === 'right' ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(1, 0.7, 1).normalize();
    this.activeCamera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.controls.update();
    this.publishCameraPose();
  }

  private publishCameraPose(): void {
    this.options.onCameraChange({ position: toTuple(this.activeCamera.position),
      target: toTuple(this.controls.target), zoom: this.activeCamera.zoom });
    this.invalidate('camera');
  }

  handleResize = (): void => {
    const width = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || window.innerWidth;
    const height =
      this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.cameraPerspective.aspect = width / height;
    this.cameraPerspective.updateProjectionMatrix();
    const frustum = 8;
    this.cameraOrthographic.left = (-frustum * width) / height;
    this.cameraOrthographic.right = (frustum * width) / height;
    this.cameraOrthographic.top = frustum;
    this.cameraOrthographic.bottom = -frustum;
    this.cameraOrthographic.updateProjectionMatrix();
    this.invalidate('camera');
  };

  exportImage(): void {
    const link = document.createElement('a');
    link.href = this.renderer.domElement.toDataURL('image/png');
    link.download = 'three-render.png';
    link.click();
  }

  async exportScene(): Promise<void> {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const exportRoot = new THREE.Group();
    exportRoot.name = this.latestSnapshot?.project.name ?? 'Three Render';
    const copyObject = (source: THREE.Object3D): THREE.Object3D | null => {
      if (!source.visible || source instanceof THREE.Light || source instanceof THREE.Line) return null;
      const destination = source instanceof THREE.Mesh
        ? new THREE.Mesh(source.geometry, source.material) : new THREE.Group();
      destination.name = source.name;
      destination.position.copy(source.position);
      destination.quaternion.copy(source.quaternion);
      destination.scale.copy(source.scale);
      source.children.forEach((child) => {
        if (child === source.userData.lightHelper) return;
        const copy = copyObject(child);
        if (copy) destination.add(copy);
      });
      return destination;
    };
    this.runtimeRoot.children.forEach((child) => {
      const copy = copyObject(child);
      if (copy) exportRoot.add(copy);
    });
    exportRoot.add(this.activeCamera.clone());
    const buffer = await new GLTFExporter().parseAsync(exportRoot, { binary: true });
    const url = URL.createObjectURL(new Blob([buffer as ArrayBuffer], { type: 'model/gltf-binary' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportRoot.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.glb`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  sync(snapshot: EngineSnapshot): void {
    this.latestSnapshot = snapshot;
    const cameraRecord = snapshot.project.cameras[snapshot.project.activeCameraId];
    const cameraSignature = JSON.stringify(cameraRecord);
    if (cameraSignature !== this.lastAppliedCameraSignature) {
      this.applyCamera(cameraRecord);
      this.lastAppliedCameraSignature = cameraSignature;
    }
    this.renderer.toneMappingExposure = snapshot.project.renderer.exposure;
    this.renderer.setClearAlpha(snapshot.project.renderer.transparentBackground ? 0 : 1);
    if (snapshot.project.renderer.transparentBackground) this.scene.background = null;
    else if (!snapshot.project.environment.enabled || !snapshot.project.environment.backgroundVisible) {
      this.scene.background = new THREE.Color('#25282b');
    }
    this.transformControls.setMode(snapshot.axisEditMode ? 'translate' : snapshot.transformMode);
    this.transformControls.space = snapshot.transformSpace;
    this.transformControls.setTranslationSnap(
      snapshot.snapEnabled ? snapshot.translateSnap : null,
    );
    this.transformControls.setRotationSnap(
      snapshot.snapEnabled ? THREE.MathUtils.degToRad(snapshot.rotateSnap) : null,
    );
    this.transformControls.setScaleSnap(snapshot.snapEnabled ? snapshot.scaleSnap : null);

    const nextEnvironmentSignature = this.getEnvironmentSignature(snapshot.project);
    if (nextEnvironmentSignature !== this.lastEnvironmentSignature) {
      this.lastEnvironmentSignature = nextEnvironmentSignature;
      void this.syncEnvironment(snapshot.project).catch((error: unknown) => {
        if (!this.disposed) this.options.onRenderStatus({ warning: `Environment could not load: ${error instanceof Error ? error.message : String(error)}` });
      });
    }

    const nextTopologySignature = this.getTopologySignature(snapshot.project);
    const nextTransformSignature = this.getTransformSignature(snapshot.project);
    const nextMaterialSignature = this.getMaterialSignature(snapshot.project);
    const nextLightSignature = this.getLightSignature(snapshot.project);
    if (nextTopologySignature !== this.lastTopologySignature) {
      this.lastTopologySignature = nextTopologySignature;
      this.lastTransformSignature = nextTransformSignature;
      this.lastMaterialSignature = nextMaterialSignature;
      this.lastLightSignature = nextLightSignature;
      void this.syncNodes(snapshot.project, snapshot.selectedNodeId, 'topology');
    } else if (nextTransformSignature !== this.lastTransformSignature) {
      this.lastTransformSignature = nextTransformSignature;
      void this.syncNodes(snapshot.project, snapshot.selectedNodeId, 'transform');
    } else if (nextMaterialSignature !== this.lastMaterialSignature) {
      this.lastMaterialSignature = nextMaterialSignature;
      void this.syncNodes(snapshot.project, snapshot.selectedNodeId, 'material');
    } else if (nextLightSignature !== this.lastLightSignature) {
      this.lastLightSignature = nextLightSignature;
      void this.syncNodes(snapshot.project, snapshot.selectedNodeId, 'light');
    } else {
      this.updateSelection(snapshot.selectedNodeId);
    }

    const nextRenderSignature = this.getRenderSignature(snapshot.project);
    if (nextRenderSignature !== this.lastRenderSignature) {
      this.lastRenderSignature = nextRenderSignature;
      this.invalidate('settings');
    }

    this.options.onRenderStatus({
      mode: snapshot.project.renderer.mode,
      supported:
        snapshot.project.renderer.mode === 'live' || snapshot.project.renderer.mode === 'render'
          ? Boolean(this.pathTracer) && !this.pathTracerRuntimeFailed
          : true,
      sampleLimit:
        snapshot.project.renderer.mode === 'live'
          ? snapshot.project.renderer.live.sampleLimit
          : snapshot.project.renderer.mode === 'render'
            ? snapshot.project.renderer.render.sampleLimit
            : 0,
      warning: (
        snapshot.project.renderer.mode === 'live' || snapshot.project.renderer.mode === 'render'
      )
        ? !this.pathTracer || this.pathTracerRuntimeFailed
          ? this.pathTracerRuntimeFailed
            ? 'GPU path tracing failed for the current scene. Falling back to realtime.'
            : 'GPU path tracing is unavailable in this browser/GPU configuration.'
          : undefined
        : undefined,
    });
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const snapshot = this.latestSnapshot;
    if (!snapshot) return;

    const mode = snapshot.project.renderer.mode;
    if (mode === 'solid') {
      this.scene.overrideMaterial = this.solidOverrideMaterial;
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.activeCamera);
      this.scene.overrideMaterial = null;
    } else if (mode === 'realtime' || !this.pathTracer || this.pathTracerRuntimeFailed) {
      this.scene.overrideMaterial = null;
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.activeCamera);
      if (mode === 'realtime') {
        this.pathTracerSceneReady = false;
      }
    } else {
      const quality =
        mode === 'live'
          ? snapshot.project.renderer.live
          : snapshot.project.renderer.render;

      this.pathTracer.bounces = quality.bounces;
      this.pathTracer.transmissiveBounces = Math.max(1, Math.min(64, quality.transmissionBounces ?? 16));
      this.pathTracer.renderScale = quality.renderScale;
      this.pathTracer.tiles.set(quality.tiles, quality.tiles);

      if (this.renderSampleCount < quality.sampleLimit) {
        try {
          this.pathTracer.renderSample();
          this.renderSampleCount = this.pathTracer.samples;
        } catch {
          this.pathTracerRuntimeFailed = true;
          this.options.onRenderStatus({
            warning: 'GPU path tracing failed for the current scene. Falling back to realtime.',
          });
        }
      }
      // Denoising is a display pass. Toggle completed renders without discarding
      // their samples, and keep the raw accumulation available for switching back.
      if (this.presentPathTrace && this.lastPresentationSignature !== this.getPresentationSignature()) {
        this.presentPathTrace();
      }
    }

    // WebGLPathTracer owns the shared WebGL program state while path tracing. Rendering
    // TransformControls over that output corrupts its shader bindings on some drivers,
    // so render helpers only in raster modes.
    const isPathTracing = mode === 'live' || mode === 'render';
    this.transformControls.getHelper().visible = !isPathTracing;
    if (!isPathTracing) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlayScene, this.activeCamera);
    }
    this.options.onRenderStatus({
      sampleCount: this.renderSampleCount,
      sampleLimit:
        mode === 'live'
          ? snapshot.project.renderer.live.sampleLimit
          : mode === 'render'
            ? snapshot.project.renderer.render.sampleLimit
            : 0,
      invalidationReasons: [...this.invalidationReasons],
      postprocessState: mode === 'live' || mode === 'render' ? 'ready' : 'idle',
    });
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = true;
    this.pointerMoved = false;
    this.cameraMovedDuringPointer = false;
    this.pointerDownScreen.set(event.clientX, event.clientY);
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private handleNavigationKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (event.metaKey || event.ctrlKey || event.altKey || target.matches('input,textarea,select') || target.isContentEditable) return;
    if (!['1','2','3'].includes(event.key)) return;
    this.navigationKey = event.key;
    this.controls.mouseButtons.LEFT = event.key === '1' ? THREE.MOUSE.PAN : event.key === '2' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
  };

  private handleNavigationKeyUp = (event: KeyboardEvent): void => {
    if (event.key === this.navigationKey) this.resetNavigation();
  };

  private resetNavigation = (): void => {
    this.navigationKey = null;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    if (Math.hypot(
      event.clientX - this.pointerDownScreen.x,
      event.clientY - this.pointerDownScreen.y,
    ) > 4) {
      this.pointerMoved = true;
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    if (event.button !== 0 || this.navigationKey) return;
    const shouldSuppressSelection =
      this.pointerMoved || this.suppressPointerSelection || this.cameraMovedDuringPointer;
    this.pointerMoved = false;
    this.cameraMovedDuringPointer = false;
    this.suppressPointerSelection = false;
    if ((event.target as HTMLElement)?.closest('[data-overlay-ui]')) return;
    if (this.controls.enabled === false) return;
    if (shouldSuppressSelection) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const intersections = this.raycaster.intersectObjects(this.runtimeRoot.children, true);
    const match = intersections.find((entry: THREE.Intersection) =>
      entry.object.userData.nodeId && isObjectVisible(entry.object));
    this.options.onSelectNode(match?.object.userData.nodeId ?? null);
  };

  private getTopologySignature(project: ProjectDocument): string {
    return JSON.stringify({
      roots: project.rootNodeIds,
      nodes: Object.values(project.nodes).map((node) => ({
        id: node.id,
        nodeType: node.nodeType,
        assetId: node.assetId,
        parentId: node.parentId,
        children: node.children,
        visible: node.visible,
        isolated: node.isolated,
        materialBindings: node.materialBindings,
        primitiveParameters: node.primitiveParameters,
      })),
      assets: Object.values(project.assets).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        sourceUri: asset.sourceUri,
        meshBindings: asset.meshBindings,
      })),
    });
  }

  private getTransformSignature(project: ProjectDocument): string {
    return JSON.stringify(
      Object.values(project.nodes)
        .filter((node) => node.nodeType !== 'light')
        .map((node) => ({ id: node.id, transform: node.transform, pivotOffset: node.pivotOffset })),
    );
  }

  private getMaterialSignature(project: ProjectDocument): string {
    return JSON.stringify(project.materials);
  }

  private getLightSignature(project: ProjectDocument): string {
    return JSON.stringify(
      Object.values(project.nodes)
        .filter((node) => node.nodeType === 'light')
        .map((node) => ({
          id: node.id,
          visible: node.visible,
          transform: node.transform,
          light: node.light,
        })),
    );
  }

  private getEnvironmentSignature(project: ProjectDocument): string {
    const environmentAsset = project.environment.assetId
      ? project.assets[project.environment.assetId]
      : null;
    return JSON.stringify({
      environment: project.environment,
      asset: environmentAsset
        ? {
            id: environmentAsset.id,
            sourceUri: environmentAsset.sourceUri,
          }
        : null,
    });
  }

  private getRenderSignature(project: ProjectDocument): string {
    const { denoise: _denoise, ...settings } = project.renderer;
    return JSON.stringify(settings);
  }

  private getPresentationSignature(): string {
    return JSON.stringify(this.latestSnapshot?.project.renderer.denoise);
  }

  private getAttachedNodeId(): string | null {
    return this.transformControls.object?.userData.nodeId ?? null;
  }

  private syncNodeTransformFromObject(nodeId: string, recordHistory: boolean): void {
    const object = this.nodeObjects.get(nodeId);
    if (!object) return;
    this.options.onTransformChange(
      nodeId,
      {
        position: toTuple(object.position),
        rotation: toTuple(object.rotation),
        scale: toTuple(object.scale),
      },
      recordHistory,
    );
  }

  private applyCamera(cameraRecord: CameraRecord): void {
    const isPerspective = cameraRecord.projection === 'perspective';
    this.activeCamera = isPerspective ? this.cameraPerspective : this.cameraOrthographic;
    this.transformControls.camera = this.activeCamera;
    this.controls.object = this.activeCamera;
    this.activeCamera.position.set(...cameraRecord.position);
    this.activeCamera.near = cameraRecord.near;
    this.activeCamera.far = cameraRecord.far;
    this.controls.target.set(...cameraRecord.target);
    if (isPerspective) {
      this.cameraPerspective.fov = cameraRecord.fov;
      this.cameraPerspective.setFocalLength(cameraRecord.focalLength);
      this.cameraPerspective.updateProjectionMatrix();
    } else {
      this.cameraOrthographic.zoom = cameraRecord.zoom;
      this.cameraOrthographic.updateProjectionMatrix();
    }
    this.activeCamera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate('camera');
  }

  private async syncEnvironment(project: ProjectDocument): Promise<void> {
    const assetId = project.environment.assetId;
    const asset = assetId ? project.assets[assetId] : null;
    if (!asset || !project.environment.enabled) {
      this.scene.environment = null;
      this.scene.background = project.renderer.transparentBackground ? null : new THREE.Color('#25282b');
      this.scene.backgroundIntensity = 1;
      this.invalidate('environment');
      return;
    }
    const texture = await this.loadEnvironmentTexture(asset);
    if (this.disposed || this.latestSnapshot?.project.environment.assetId !== assetId) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = texture;
    this.scene.background = project.environment.backgroundVisible ? texture
      : project.renderer.transparentBackground ? null : new THREE.Color('#25282b');
    this.scene.backgroundIntensity = project.environment.intensity;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(project.environment.rotation);
    this.scene.backgroundRotation.y = THREE.MathUtils.degToRad(project.environment.rotation);
    this.scene.environmentIntensity = project.environment.intensity;
    this.invalidate('environment');
  }

  private async syncNodes(
    project: ProjectDocument,
    selectedNodeId: string | null,
    reason: InvalidationReason,
  ): Promise<void> {
    this.pendingSync = reason;
    if (this.syncRunning || this.disposed) return;
    this.syncRunning = true;
    try {
      while (this.pendingSync && !this.disposed) {
        const pendingReason = this.pendingSync;
        this.pendingSync = null;
        await this.syncNodeSnapshot(this.latestSnapshot?.project ?? project,
          this.latestSnapshot ? this.latestSnapshot.selectedNodeId : selectedNodeId, pendingReason);
      }
    } catch (error) {
      this.options.onRenderStatus({ warning: `Scene could not load: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.syncRunning = false;
    }
  }

  private async syncNodeSnapshot(project: ProjectDocument, selectedNodeId: string | null,
    reason: InvalidationReason): Promise<void> {
    this.isolationNodeIds = getIsolationNodeIds(project);
    if (reason === 'topology') this.transformControls.detach();
    const nodeIds = new Set(Object.keys(project.nodes));
    for (const existingId of [...this.nodeObjects.keys()]) {
      if (!nodeIds.has(existingId)) {
        const object = this.nodeObjects.get(existingId);
        if (object) {
          object.removeFromParent();
        }
        this.nodeObjects.delete(existingId);
      }
    }

    for (const rootNodeId of project.rootNodeIds) {
      if (this.disposed) return;
      await this.ensureNode(project, rootNodeId, this.runtimeRoot);
    }

    this.updateSelection(this.latestSnapshot ? this.latestSnapshot.selectedNodeId : selectedNodeId);
    this.invalidate(reason);
  }

  private async ensureNode(
    project: ProjectDocument,
    nodeId: string,
    parentObject: THREE.Object3D,
  ): Promise<void> {
    const node = project.nodes[nodeId];
    if (!node) return;

    let object = this.nodeObjects.get(nodeId);
    if (!object) {
      object = await this.createRuntimeObject(project, node);
      object.userData.nodeId = nodeId;
      object.traverse((child: THREE.Object3D) => {
        child.userData.nodeId = nodeId;
      });
      this.nodeObjects.set(nodeId, object);
    }
    const asset = node.assetId ? project.assets[node.assetId] : null;
    const content = (object.userData.assetContent as THREE.Object3D | undefined) ?? object;
    if (asset?.sourceKind === 'primitive' && asset.primitive && content instanceof THREE.Mesh) {
      const signature = JSON.stringify(normalizePrimitiveParameters(asset.primitive, node.primitiveParameters));
      if (content.userData.primitiveSignature !== signature) {
        const previous = content.geometry;
        content.geometry = createPrimitiveGeometry(asset.primitive, node.primitiveParameters);
        content.userData.primitiveSignature = signature;
        previous.dispose();
      }
    }
    if (object.userData.assetId !== node.assetId && node.nodeType === 'asset' && object.parent) {
      const parent = object.parent;
      this.transformControls.detach(); object.removeFromParent(); this.nodeObjects.delete(nodeId);
      await this.ensureNode(project, nodeId, parent);
      return;
    }

    if (object.parent !== parentObject) {
      parentObject.add(object);
    }

    object.name = node.name;
    object.visible = node.visible && (!this.isolationNodeIds || this.isolationNodeIds.has(node.id));
    object.position.set(...node.transform.position);
    object.rotation.set(...node.transform.rotation);
    object.scale.set(...node.transform.scale);
    if (object.userData.assetContent) content.position.fromArray(node.pivotOffset ?? [0, 0, 0]).negate();
    this.syncRuntimeLight(node, object);
    this.applyNodeMaterials(project, node, object);

    for (const childId of node.children) {
      await this.ensureNode(project, childId, object);
    }
  }

  private updateSelection(selectedNodeId: string | null): void {
    this.updateLightHelperVisibility(selectedNodeId);
    if (!selectedNodeId) {
      this.transformControls.detach();
      return;
    }
    const object = this.nodeObjects.get(selectedNodeId);
    const node = this.latestSnapshot?.project.nodes[selectedNodeId];
    if (!object || !object.parent || !node || node.locked || !isObjectVisible(object)) {
      this.transformControls.detach();
      return;
    }
    this.transformControls.attach(object);
  }

  private async createRuntimeObject(
    project: ProjectDocument,
    node: ProjectDocument['nodes'][string],
  ): Promise<THREE.Object3D> {
    if (node.nodeType === 'light') {
      return this.createRuntimeLightObject(node);
    }
    if (node.isGroup || !node.assetId) {
      return new THREE.Group();
    }
    const asset = project.assets[node.assetId];
    const wrap = (content: THREE.Object3D) => {
      const root = new THREE.Group();
      // Previously the imported scene root received the node transform directly.
      // Keep that behavior while giving its content a separate pivot offset.
      content.position.set(0, 0, 0); content.rotation.set(0, 0, 0); content.scale.set(1, 1, 1);
      root.userData.assetId = asset.id; root.userData.assetContent = content;
      root.add(content);
      return root;
    };
    if (asset.sourceKind === 'primitive' && asset.primitive) {
      const mesh = createPrimitiveMesh(asset.primitive, node.primitiveParameters);
      mesh.userData.assetId = asset.id;
      mesh.userData.primitiveSignature = JSON.stringify(normalizePrimitiveParameters(asset.primitive,node.primitiveParameters));
      return wrap(mesh);
    }
    if (asset.sourceKind === 'geometry' && asset.geometry) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometryLoader().parse(asset.geometry), new THREE.MeshPhysicalMaterial());
      mesh.userData.assetId = asset.id;
      return wrap(mesh);
    }
    const template = await this.getAssetTemplate(asset);
    const instance = cloneSkeleton(template.scene);
    instance.userData.assetId = asset.id;
    instance.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => toPhysicalMaterial(material, child.name))
          : toPhysicalMaterial(child.material, child.name);
      }
    });
    return wrap(instance);
  }

  getAxisTarget(target: 'center' | 'base' | 'origin'): Vec3Tuple | null {
    const id = this.latestSnapshot?.selectedNodeId;
    const node = id ? this.latestSnapshot?.project.nodes[id] : null;
    const object = id ? this.nodeObjects.get(id) : null;
    const content = object?.userData.assetContent as THREE.Object3D | undefined;
    if (!node || !object || !content || node.locked) return null;
    if (target === 'origin') return [0, 0, 0];
    object.updateWorldMatrix(true, true);
    if (Math.abs(object.matrixWorld.determinant()) < 1e-12) return null;
    const inverse = object.matrixWorld.clone().invert();
    const bounds = new THREE.Box3();
    content.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) bounds.union(child.geometry.boundingBox.clone()
        .applyMatrix4(inverse.clone().multiply(child.matrixWorld)));
    });
    if (bounds.isEmpty()) return null;
    const point = bounds.getCenter(new THREE.Vector3());
    if (target === 'base') point.y = bounds.min.y;
    return point.add(new THREE.Vector3(...(node.pivotOffset ?? [0, 0, 0]))).toArray() as Vec3Tuple;
  }

  private applyNodeMaterials(
    project: ProjectDocument,
    node: ProjectDocument['nodes'][string],
    object: THREE.Object3D,
  ): void {
    if (node.nodeType !== 'asset' || !node.assetId) return;
    const asset = project.assets[node.assetId];
    if (!asset?.meshBindings.length) return;

    const meshMap = new Map<string, THREE.Mesh>();
    let meshIndex = 0;
    object.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        meshMap.set(String(meshIndex), child);
        meshIndex += 1;
      }
    });

    asset.meshBindings.forEach((binding) => {
      const mesh = meshMap.get(binding.meshPath);
      if (!mesh) return;
      const materialId =
        node.materialBindings[binding.id] ?? binding.defaultMaterialId;
      const materialRecord = project.materials[materialId];
      const sourceMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const nextMaterials = [...sourceMaterials];
      let baseMaterial =
        nextMaterials[binding.slot] instanceof THREE.MeshPhysicalMaterial
          ? (nextMaterials[binding.slot] as THREE.MeshPhysicalMaterial)
          : toPhysicalMaterial(nextMaterials[binding.slot], binding.label);
      if (materialId === DEFAULT_DIFFUSE_MATERIAL_ID) {
        baseMaterial = createDefaultDiffuseMaterial(binding.label);
      } else if (materialRecord) {
        applyRecordToMaterial(materialRecord, baseMaterial);
      }
      if (node.assetId) mesh.castShadow = mesh.receiveShadow = true;
      nextMaterials[binding.slot] = baseMaterial;
      mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
    });
  }

  private getAssetTemplate(asset: AssetRecord): Promise<RuntimeAssetTemplate> {
    const cached = this.assetTemplates.get(asset.id);
    if (cached) return cached;

    const next = (async () => {
      const gltf = asset.sourceKind === 'primitive' && asset.primitive
        ? { scene: createPrimitiveMesh(asset.primitive) }
        : await this.gltfLoader.loadAsync(asset.sourceUri);
      let meshIndex = 0;
      const meshBindings: MeshBindingRecord[] = [];
      const materials: MaterialRecord[] = [];
      gltf.scene.traverse((child: THREE.Object3D) => {
        if (!(child instanceof THREE.Mesh)) return;
        const list = Array.isArray(child.material)
          ? child.material
          : [child.material];
        list.forEach((material: THREE.Material, slot: number) => {
          const physical = toPhysicalMaterial(material, `${child.name || 'Mesh'} ${slot + 1}`);
          const recordId = `${asset.id}::mat::${meshIndex}:${slot}`;
          const bindingId = `${asset.id}::binding::${meshIndex}:${slot}`;
          materials.push(materialToRecord(recordId, physical));
          meshBindings.push({
            id: bindingId,
            label: `${child.name || 'Mesh'} / Slot ${slot + 1}`,
            meshPath: String(meshIndex),
            slot,
            defaultMaterialId: recordId,
          });
        });
        meshIndex += 1;
      });

      if (!this.disposed) this.options.onDiscoveredMetadata({
        assetId: asset.id,
        meshBindings,
        materials,
      });
      return {
        scene: gltf.scene,
        meshBindings,
        materials,
      };
    })();

    this.assetTemplates.set(asset.id, next);
    return next;
  }

  private loadEnvironmentTexture(asset: AssetRecord): Promise<THREE.Texture> {
    const cached = this.environmentCache.get(asset.id);
    if (cached) return cached;
    const promise = (asset.mimeType === 'image/exr' || /\.exr$/i.test(asset.sourceUri)
      ? this.exrLoader.loadAsync(asset.sourceUri)
      : this.hdrLoader.loadAsync(asset.sourceUri)).then((texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        return texture;
      });
    this.environmentCache.set(asset.id, promise);
    return promise;
  }

  private createRuntimeLightObject(
    node: ProjectDocument['nodes'][string],
  ): THREE.Object3D {
      const group = new THREE.Group();
      group.userData.lightKind = '';
      this.syncRuntimeLight(node, group);
      return group;
  }

  private syncRuntimeLight(
    node: ProjectDocument['nodes'][string],
    object: THREE.Object3D,
  ): void {
    if (node.nodeType !== 'light' || !(object instanceof THREE.Group)) return;
    const lightRecord = node.light;
    if (!lightRecord) return;

    const nextLightKind = `${lightRecord.type}:${lightRecord.shape}`;
    if (object.userData.lightKind !== nextLightKind) {
      object.clear();
      object.userData.lightKind = nextLightKind;
      const runtimeLight = this.createThreeLight(lightRecord);
      const helper = this.createLightHelper(lightRecord);
      object.add(runtimeLight, helper);
      if (runtimeLight instanceof THREE.SpotLight || runtimeLight instanceof THREE.DirectionalLight) {
        runtimeLight.target.position.set(0, 0, -1);
        object.add(runtimeLight.target);
        object.userData.lightTarget = runtimeLight.target;
      } else {
        object.userData.lightTarget = null;
      }
      object.userData.lightRef = runtimeLight;
      object.userData.lightHelper = helper;
      object.traverse((child: THREE.Object3D) => {
        child.userData.nodeId = node.id;
      });
    }

    const light = object.userData.lightRef as THREE.Light | undefined;
    if (!light) return;
    light.color.set(lightRecord.color);
    light.intensity = lightRecord.intensity;
    light.visible = node.visible;

    if (light instanceof ShapedAreaLight) {
      light.userData.studioShadowSpread = normalizeShadowSpread(lightRecord.shadowSpread);
      light.width = lightRecord.width;
      light.height = lightRecord.height;
      light.intensity = lightRecord.intensity;
      light.isCircular = lightRecord.shape === 'circle';
    } else if (lightRecord.type === 'sun' && light instanceof PhysicalSpotLight) {
      this.updateSunApproxLight(object, light, lightRecord);
    } else if (light instanceof PhysicalSpotLight) {
      light.distance = lightRecord.distance;
      light.angle = THREE.MathUtils.degToRad(lightRecord.angle);
      light.penumbra = lightRecord.penumbra;
      light.decay = lightRecord.decay;
      light.radius = lightRecord.radius;
    } else if (light instanceof THREE.PointLight) {
      light.distance = lightRecord.distance;
      light.decay = lightRecord.decay;
    } else if (light instanceof THREE.DirectionalLight) {
      light.intensity = lightRecord.intensity;
    }

    const helper = object.userData.lightHelper as THREE.Group | undefined;
    if (helper) {
      this.updateLightHelperGeometry(helper, lightRecord);
      helper.visible =
        lightRecord.showGizmo ||
        this.latestSnapshot?.selectedNodeId === node.id;
    }
  }

  private createThreeLight(
    lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>,
  ): THREE.Light {
    if (lightRecord.type === 'spot') {
      const light = new PhysicalSpotLight(
        lightRecord.color,
        lightRecord.intensity,
        lightRecord.distance,
        THREE.MathUtils.degToRad(lightRecord.angle),
        lightRecord.penumbra,
        lightRecord.decay,
      );
      light.radius = lightRecord.radius;
      return light;
    }

    if (lightRecord.type === 'point') {
      return new THREE.PointLight(
        lightRecord.color,
        lightRecord.intensity,
        lightRecord.distance,
        lightRecord.decay,
      );
    }

    if (lightRecord.type === 'sun') {
      const light = new PhysicalSpotLight(
        lightRecord.color,
        lightRecord.intensity,
        0,
        Math.PI / 3,
        0,
        0,
      );
      light.radius = lightRecord.radius;
      light.userData.sunApprox = true;
      return light;
    }

    const rectLight = new ShapedAreaLight(
      lightRecord.color,
      lightRecord.intensity,
      lightRecord.width,
      lightRecord.height,
    );
    rectLight.isCircular = lightRecord.shape === 'circle';
    rectLight.position.set(0, 0, 0);
    rectLight.lookAt(0, 0, -1);
    return rectLight;
  }

  private createLightHelper(lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>): THREE.Group {
    const helper = new THREE.Group();
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffdd93,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });
    helper.userData.lineMaterial = lineMaterial;
    this.updateLightHelperGeometry(helper, lightRecord);
    return helper;
  }

  private updateLightHelperGeometry(
    helper: THREE.Group,
    lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>,
  ): void {
    helper.children.forEach((child) => {
      const line = child as THREE.Line | THREE.LineSegments;
      line.geometry?.dispose();
    });
    helper.clear();
    const lineMaterial = helper.userData.lineMaterial as THREE.LineBasicMaterial | undefined;
    if (!lineMaterial) return;

    if (lightRecord.type === 'spot') {
      this.buildSpotLightHelper(helper, lineMaterial, lightRecord);
      return;
    }

    if (lightRecord.type === 'point') {
      this.buildPointLightHelper(helper, lineMaterial, lightRecord);
      return;
    }

    if (lightRecord.type === 'sun') {
      this.buildSunLightHelper(helper, lineMaterial);
      return;
    }

    const halfWidth = lightRecord.width / 2;
    const halfHeight = lightRecord.height / 2;
    const outlinePoints: THREE.Vector3[] = [];

    if (lightRecord.shape === 'rectangle') {
      outlinePoints.push(
        new THREE.Vector3(-halfWidth, -halfHeight, 0),
        new THREE.Vector3(halfWidth, -halfHeight, 0),
        new THREE.Vector3(halfWidth, halfHeight, 0),
        new THREE.Vector3(-halfWidth, halfHeight, 0),
      );
    } else {
      const segments = 32;
      for (let index = 0; index < segments; index += 1) {
        const angle = (index / segments) * Math.PI * 2;
        outlinePoints.push(
          new THREE.Vector3(
            Math.cos(angle) * halfWidth,
            Math.sin(angle) * halfHeight,
            0,
          ),
        );
      }
    }

    helper.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outlinePoints), lineMaterial));

    const arrowAnchors = [
      new THREE.Vector3(-halfWidth, -halfHeight, 0),
      new THREE.Vector3(halfWidth, -halfHeight, 0),
      new THREE.Vector3(halfWidth, halfHeight, 0),
      new THREE.Vector3(-halfWidth, halfHeight, 0),
    ];
    const arrowLength = Math.max(lightRecord.width, lightRecord.height) * 0.18;
    const arrowInset = Math.max(lightRecord.width, lightRecord.height) * 0.05;

    arrowAnchors.forEach((origin) => {
      const tip = new THREE.Vector3(origin.x * 0.92, origin.y * 0.92, -arrowLength);
      const left = tip.clone().add(new THREE.Vector3(-arrowInset, 0, arrowInset));
      const right = tip.clone().add(new THREE.Vector3(arrowInset, 0, arrowInset));
      helper.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
        origin,
        tip,
        tip,
        left,
        tip,
        right,
      ]), lineMaterial));
    });
  }

  private buildSpotLightHelper(
    helper: THREE.Group,
    material: THREE.LineBasicMaterial,
    lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>,
  ): void {
    const sourceRadius = Math.max(lightRecord.radius, 0.03);
    const coneLength = Math.max(sourceRadius * 2, 1.2);
    const coneRadius = Math.tan(THREE.MathUtils.degToRad(lightRecord.angle)) * coneLength;
    const ringPoints: THREE.Vector3[] = [];
    const conePoints: THREE.Vector3[] = [];
    const ringSegments = 24;

    for (let index = 0; index < ringSegments; index += 1) {
      const angle = (index / ringSegments) * Math.PI * 2;
      ringPoints.push(
        new THREE.Vector3(Math.cos(angle) * sourceRadius, Math.sin(angle) * sourceRadius, 0),
      );
    }

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      conePoints.push(
        new THREE.Vector3(Math.cos(angle) * sourceRadius, Math.sin(angle) * sourceRadius, 0),
        new THREE.Vector3(Math.cos(angle) * coneRadius, Math.sin(angle) * coneRadius, -coneLength),
      );
    }

    helper.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints), material));
    helper.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(conePoints), material));
  }

  private buildPointLightHelper(
    helper: THREE.Group,
    material: THREE.LineBasicMaterial,
    lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>,
  ): void {
    const radius = Math.max(lightRecord.radius, 0.12);
    const segments = 28;
    const buildRing = (plane: 'xy' | 'xz' | 'yz') => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < segments; index += 1) {
        const angle = (index / segments) * Math.PI * 2;
        const cos = Math.cos(angle) * radius;
        const sin = Math.sin(angle) * radius;
        if (plane === 'xy') points.push(new THREE.Vector3(cos, sin, 0));
        if (plane === 'xz') points.push(new THREE.Vector3(cos, 0, sin));
        if (plane === 'yz') points.push(new THREE.Vector3(0, cos, sin));
      }
      helper.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material));
    };

    buildRing('xy');
    buildRing('xz');
    buildRing('yz');
  }

  private buildSunLightHelper(
    helper: THREE.Group,
    material: THREE.LineBasicMaterial,
  ): void {
    const points = [
      new THREE.Vector3(-0.32, 0.22, 0),
      new THREE.Vector3(-0.32, 0.22, -0.7),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -0.9),
      new THREE.Vector3(0.32, -0.22, 0),
      new THREE.Vector3(0.32, -0.22, -0.7),
    ];
    helper.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material));
  }

  private updateSunApproxLight(
    object: THREE.Group,
    light: PhysicalSpotLight,
    lightRecord: NonNullable<ProjectDocument['nodes'][string]['light']>,
  ): void {
    const { center, radius } = this.getSceneContentBounds();
    const virtualDistance = Math.max(radius * 8, 2);
    const coneAngle = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(Math.atan((radius * 1.25) / virtualDistance)) * 2,
      5,
      85,
    );

    object.position.copy(center);
    light.position.set(0, 0, virtualDistance);
    light.target.position.set(0, 0, 0);
    light.distance = 0;
    light.decay = 0;
    light.angle = THREE.MathUtils.degToRad(coneAngle);
    light.penumbra = 0;
    light.radius = Math.tan(THREE.MathUtils.degToRad(lightRecord.sunAngle) * 0.5) * virtualDistance;
    light.intensity = lightRecord.intensity;
  }

  private getSceneContentBounds(): { center: THREE.Vector3; radius: number } {
    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    let hasContent = false;

    Object.entries(this.latestSnapshot?.project.nodes ?? {}).forEach(([nodeId, node]) => {
      if (node.nodeType === 'light') return;
      const object = this.nodeObjects.get(nodeId);
      if (!object) return;
      object.traverse((child: THREE.Object3D) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry;
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        if (!geometry.boundingBox) return;
        const worldBounds = geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
        if (!hasContent) {
          bounds.copy(worldBounds);
          hasContent = true;
        } else {
          bounds.union(worldBounds);
        }
      });
    });

    if (!hasContent) {
      center.set(0, 0, 0);
      return { center, radius: 2 };
    }

    bounds.getCenter(center);
    return {
      center,
      radius: Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.5, 0.5),
    };
  }

  private updateLightHelperVisibility(selectedNodeId: string | null): void {
    if (!this.latestSnapshot) return;
    Object.entries(this.latestSnapshot.project.nodes).forEach(([nodeId, node]) => {
      if (node.nodeType !== 'light') return;
      const object = this.nodeObjects.get(nodeId);
      const helper = object?.userData.lightHelper as THREE.Group | undefined;
      if (!helper || !node.light) return;
      helper.visible = node.light.showGizmo || selectedNodeId === nodeId;
    });
  }

  private invalidate(reason: InvalidationReason): void {
    if (this.disposed) return;
    this.presentPathTrace = null;
    this.invalidationReasons.add(reason);
    this.renderSampleCount = 0;
    if (!this.latestSnapshot) return;
    const mode = this.latestSnapshot.project.renderer.mode;
    if ((mode === 'live' || mode === 'render') && this.pathTracer && !this.pathTracerRuntimeFailed) {
      try {
        const requiresFullSceneSync =
          !this.pathTracerSceneReady ||
          reason === 'topology' ||
          reason === 'transform';

        if (requiresFullSceneSync) {
          this.pathTracer.setScene(this.scene, this.activeCamera);
          this.pathTracerSceneReady = true;
        } else if (reason === 'camera') {
          this.pathTracer.updateCamera();
        } else if (reason === 'material') {
          this.pathTracer.updateMaterials();
        } else if (reason === 'light') {
          this.pathTracer.updateLights();
        } else if (reason === 'environment') {
          this.pathTracer.updateEnvironment();
        } else if (reason === 'settings') {
          this.pathTracer.reset();
        } else {
          this.pathTracer.setScene(this.scene, this.activeCamera);
          this.pathTracerSceneReady = true;
        }
        syncSpectralDispersion(this.pathTracer);
      } catch {
        this.pathTracerRuntimeFailed = true;
        this.options.onRenderStatus({
          warning: 'GPU path tracing failed for the current scene. Falling back to realtime.',
        });
      }
    }
  }
}
