import { createId } from './id';
import type {
  CameraRecord,
  CatalogManifest,
  ProjectDocument,
  RenderQualitySettings,
  RendererSettings,
} from './types';
import { createAssetFromCatalogItem, createNodeForAsset } from './catalog';
import { createMaterialRecord } from './materials';
import { createPrimitiveAsset, normalizePrimitiveParameters } from './primitives';

export function createDefaultCamera(): CameraRecord {
  return {
    id: createId('cam'),
    name: 'Main Camera',
    projection: 'perspective',
    position: [0.42, 0.27, 0.64],
    target: [0.015, 0.085, -0.015],
    fov: 45,
    focalLength: 45,
    zoom: 1,
    near: 0.001,
    far: 200,
  };
}

function createLiveSettings(): RenderQualitySettings {
  return {
    bounces: 2,
    transmissionBounces: 16,
    renderScale: 0.45,
    tiles: 2,
    sampleLimit: 12,
  };
}

function createFinalRenderSettings(): RenderQualitySettings {
  return {
    bounces: 6,
    transmissionBounces: 24,
    renderScale: 1,
    tiles: 3,
    sampleLimit: 128,
  };
}

export function createDefaultRenderer(): RendererSettings {
  return {
    mode: 'realtime',
    exposure: 1,
    transparentBackground: false,
    live: createLiveSettings(),
    render: createFinalRenderSettings(),
    denoise: {
      enabled: false,
      applyToLive: false,
      blend: 0.6,
      maxTileSize: 512,
    },
  };
}

export function createDefaultProject(
  catalog: CatalogManifest,
): ProjectDocument {
  const createdAt = new Date().toISOString();
  const camera = createDefaultCamera();

  const environmentItem = catalog.items.find(item => item.id === 'studio-hdri');
  const environment = environmentItem ? createAssetFromCatalogItem(environmentItem) : null;
  const cubeAsset = createPrimitiveAsset('cube');
  const glassAsset = createPrimitiveAsset('cube');
  glassAsset.name = 'Glass Panel';
  const cube = createNodeForAsset(cubeAsset.id, 'Cube', null, { position: [-.095, 0, 0] });
  cube.primitiveParameters = normalizePrimitiveParameters('cube', {width:.14,height:.14,depth:.14,fillet:.004});
  cube.materialBindings[cubeAsset.meshBindings[0].id] = 'starter_cube';
  const glass = createNodeForAsset(glassAsset.id, 'Glass Panel', null, {position:[.13,0,-.055],rotation:[0,-.18,0]});
  glass.primitiveParameters = normalizePrimitiveParameters('cube', {width:.16,height:.2,depth:.008,fillet:.002});
  glass.materialBindings[glassAsset.meshBindings[0].id] = 'starter_glass';
  const assets = Object.fromEntries([cubeAsset, glassAsset, ...(environment ? [environment] : [])].map(asset => [asset.id,asset]));
  const starterMaterials = [
    createMaterialRecord({id:'starter_cube',name:'Studio Ceramic',color:'#c3cbd6',roughness:.24,clearcoat:.2}),
    createMaterialRecord({id:'starter_glass',name:'Clear Glass',color:'#ffffff',transmission:1,roughness:.02,ior:1.52,thickness:.008}),
  ];
  return {
    version: 1,
    name: 'Three Render Project',
    rootNodeIds: [cube.id, glass.id],
    nodes: { [cube.id]: cube, [glass.id]: glass },
    assets,
    materials: Object.fromEntries(starterMaterials.map((material) => [material.id, material])),
    cameras: {
      [camera.id]: camera,
    },
    activeCameraId: camera.id,
    environment: {
      assetId: environment?.id,
      enabled: true,
      rotation: 0,
      intensity: 1,
      backgroundVisible: false,
    },
    renderer: createDefaultRenderer(),
    metadata: {
      createdAt,
      updatedAt: createdAt,
      starterScene: 'cube-glass-v2',
    },
  };
}

export function touchProject(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}
