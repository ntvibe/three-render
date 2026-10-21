export type Vec3Tuple = [number, number, number];

export type AssetKind = 'model' | 'environment';
export type AssetSourceKind = 'catalog' | 'upload' | 'primitive' | 'geometry';
export type PrimitiveType = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'plane' | 'disc';
export type PrimitiveParameters = Record<string, number | boolean>;
export type RenderMode =
  | 'solid'
  | 'realtime'
  | 'live'
  | 'render';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
export type InvalidationReason =
  | 'camera'
  | 'transform'
  | 'material'
  | 'light'
  | 'environment'
  | 'topology'
  | 'settings';

export interface BoundingBoxRecord {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  tags: string[];
  thumbnail: string;
  sourceAsset: string;
  kind: AssetKind;
  pivotHint: 'floor' | 'centered' | 'tabletop';
  defaultScale: Vec3Tuple;
  boundingBox?: BoundingBoxRecord;
}

export interface CatalogManifest {
  version: number;
  title: string;
  items: CatalogItem[];
}

export interface TransformRecord {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
}

export interface MaterialRecord {
  id: string;
  name: string;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  specularIntensity: number;
  specularColor: string;
  transmission: number;
  ior: number;
  thickness: number;
  thinWalled?: boolean;
  attenuationColor: string;
  attenuationDistance: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenColor: string;
  sheenRoughness: number;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessMin: number;
  iridescenceThicknessMax: number;
  anisotropy: number;
  anisotropyRotation: number;
  dispersion: number;
  opacity: number;
  transparent: boolean;
}

export type LightType = 'area' | 'spot' | 'point' | 'sun';

export interface LightRecord {
  type: LightType;
  shape: 'rectangle' | 'circle';
  color: string;
  intensity: number;
  width: number;
  height: number;
  radius: number;
  sunAngle: number;
  angle: number;
  penumbra: number;
  distance: number;
  decay: number;
  showGizmo: boolean;
  shadowSpread?: number;
}

export interface MeshBindingRecord {
  id: string;
  label: string;
  meshPath: string;
  slot: number;
  defaultMaterialId: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  sourceKind: AssetSourceKind;
  primitive?: PrimitiveType;
  geometry?: import('three').BufferGeometryJSON;
  sourceUri: string;
  mimeType?: string;
  thumbnail?: string;
  catalogItemId?: string;
  defaultScale: Vec3Tuple;
  pivotHint: 'floor' | 'centered' | 'tabletop';
  boundingBox?: BoundingBoxRecord;
  meshBindings: MeshBindingRecord[];
}

export interface SceneNodeRecord {
  id: string;
  name: string;
  nodeType: 'asset' | 'group' | 'light';
  assetId?: string;
  parentId: string | null;
  children: string[];
  visible: boolean;
  locked: boolean;
  isolated: boolean;
  isGroup: boolean;
  light?: LightRecord;
  transform: TransformRecord;
  materialBindings: Record<string, string>;
  primitiveParameters?: PrimitiveParameters;
  /** Axis position in the original asset's local coordinates. */
  pivotOffset?: Vec3Tuple;
}

export interface CameraRecord {
  id: string;
  name: string;
  projection: 'perspective' | 'orthographic';
  position: Vec3Tuple;
  target: Vec3Tuple;
  fov: number;
  focalLength: number;
  zoom: number;
  near: number;
  far: number;
}

export interface EnvironmentRecord {
  assetId?: string;
  enabled: boolean;
  rotation: number;
  intensity: number;
  backgroundVisible: boolean;
}

export interface RenderQualitySettings {
  bounces: number;
  transmissionBounces?: number;
  renderScale: number;
  tiles: number;
  sampleLimit: number;
}

export interface DenoiseSettings {
  enabled: boolean;
  applyToLive: boolean;
  blend: number;
  maxTileSize: number;
}

export interface RendererSettings {
  mode: RenderMode;
  exposure: number;
  transparentBackground: boolean;
  live: RenderQualitySettings;
  render: RenderQualitySettings;
  denoise: DenoiseSettings;
}

export interface ProjectDocument {
  version: number;
  name: string;
  rootNodeIds: string[];
  nodes: Record<string, SceneNodeRecord>;
  assets: Record<string, AssetRecord>;
  materials: Record<string, MaterialRecord>;
  cameras: Record<string, CameraRecord>;
  activeCameraId: string;
  environment: EnvironmentRecord;
  renderer: RendererSettings;
  metadata: {
    createdAt: string;
    updatedAt: string;
    starterScene?: string;
  };
}

export interface RenderFrame {
  beauty: HTMLCanvasElement | HTMLImageElement | ImageBitmap | null;
  albedo: ImageBitmap | null;
  normal: ImageBitmap | null;
  width: number;
  height: number;
  sampleCount: number;
  metadata: {
    mode: RenderMode;
    invalidationReasons: InvalidationReason[];
  };
}

export interface PostprocessStage {
  id: string;
  name: string;
  kind: 'postprocess' | 'denoise';
  enabled: boolean;
  process: (frame: RenderFrame) => Promise<RenderFrame>;
}

export interface DenoiseStage extends PostprocessStage {
  kind: 'denoise';
}

export interface EditorProjectFile {
  project: ProjectDocument;
}

export interface RenderStatus {
  supported: boolean;
  mode: RenderMode;
  sampleCount: number;
  sampleLimit: number;
  invalidationReasons: InvalidationReason[];
  postprocessState: 'idle' | 'ready' | 'denoising' | 'done';
  warning?: string;
}
