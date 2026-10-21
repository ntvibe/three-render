import type {
  AssetRecord,
  CatalogItem,
  CatalogManifest,
  SceneNodeRecord,
  TransformRecord,
} from './types';
import { createId } from './id';

export async function loadCatalogManifest(): Promise<CatalogManifest> {
  const response = await fetch('/catalog/catalog.json');
  if (!response.ok) {
    throw new Error(`Failed to load catalog manifest (${response.status})`);
  }
  return (await response.json()) as CatalogManifest;
}

export function createAssetFromCatalogItem(item: CatalogItem): AssetRecord {
  return {
    id: createId('asset'),
    name: item.name,
    kind: item.kind,
    sourceKind: 'catalog',
    sourceUri: item.sourceAsset,
    mimeType: item.kind === 'environment' ? (/\.hdr$/i.test(item.sourceAsset) ? 'image/vnd.radiance' : 'image/exr') : 'model/gltf+json',
    thumbnail: item.thumbnail,
    catalogItemId: item.id,
    defaultScale: item.defaultScale,
    pivotHint: item.pivotHint,
    boundingBox: item.boundingBox,
    meshBindings: [],
  };
}

export function createNodeForAsset(
  assetId: string,
  name: string,
  parentId: string | null,
  transform?: Partial<TransformRecord>,
): SceneNodeRecord {
  return {
    id: createId('node'),
    name,
    nodeType: 'asset',
    assetId,
    parentId,
    children: [],
    visible: true,
    locked: false,
    isolated: false,
    isGroup: false,
    transform: {
      position: transform?.position ?? [0, 0, 0],
      rotation: transform?.rotation ?? [0, 0, 0],
      scale: transform?.scale ?? [1, 1, 1],
    },
    materialBindings: {},
  };
}
