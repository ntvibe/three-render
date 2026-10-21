import { create } from 'zustand';
import { createAssetFromCatalogItem, createNodeForAsset } from '../core/catalog';
import { fileToDataUrl } from '../core/file';
import { createId } from '../core/id';
import { subtreeHasLockedNode } from '../core/sceneHierarchy';
import { canEditMaterial, getMaterialUsages, materialUsageKey } from '../core/materialUsage';
import { PRIMITIVES, createPrimitiveAsset, createPrimitiveGeometry, normalizePrimitiveParameters } from '../core/primitives';
import { BufferGeometry } from 'three';
import { localTransformFromWorld, worldTransformForNode } from '../core/sceneTransforms';
import { moveNodeAxis, pivotForAxisPosition } from '../core/axis';
import { createLightRecord } from '../core/lights';
import {
  DEFAULT_DIFFUSE_MATERIAL_ID,
  MATERIAL_PRESETS,
  createMaterialRecord,
} from '../core/materials';
import { createDefaultProject, touchProject } from '../core/project';
import type {
  AssetRecord,
  CatalogManifest,
  InvalidationReason,
  LightRecord,
  MaterialRecord,
  MeshBindingRecord,
  ProjectDocument,
  PrimitiveType,
  PrimitiveParameters,
  RenderMode,
  RenderStatus,
  SceneNodeRecord,
  TransformMode,
  TransformRecord,
  TransformSpace,
} from '../core/types';

type LeftPanelTab = 'outliner' | 'assets';
type InspectorTab = 'object' | 'material' | 'camera' | 'render';

interface EditorHistory {
  past: ProjectDocument[];
  future: ProjectDocument[];
}

interface EngineDiscoveredMetadata {
  assetId: string;
  meshBindings: MeshBindingRecord[];
  materials: MaterialRecord[];
}

interface EditorState {
  catalog: CatalogManifest | null;
  project: ProjectDocument | null;
  selectedNodeId: string | null;
  selectedBindingId: string | null;
  selectedMaterialId: string | null;
  sharedMaterialEditKey: string | null;
  setSharedMaterialEditing: (materialId: string | null) => void;
  makeMaterialUnique: (nodeId: string, bindingId: string) => void;
  leftPanelTab: LeftPanelTab;
  inspectorTab: InspectorTab;
  transformMode: TransformMode;
  axisEditMode: boolean;
  setAxisEditMode: (enabled: boolean) => void;
  setPivotOffset: (nodeId: string, offset: import('../core/types').Vec3Tuple) => void;
  addNull: () => void;
  transformSpace: TransformSpace;
  translateSnap: number;
  rotateSnap: number;
  scaleSnap: number;
  snapEnabled: boolean;
  transformBeforeDrag: ProjectDocument | null;
  numericEditBefore: ProjectDocument | null;
  beginNumericEdit: () => void;
  endNumericEdit: (cancel?: boolean) => void;
  history: EditorHistory;
  renderStatus: RenderStatus;
  initialize: (catalog: CatalogManifest, autosave?: ProjectDocument | null) => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  selectNode: (nodeId: string | null) => void;
  selectBinding: (nodeId: string, bindingId: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: TransformSpace) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setRenderMode: (mode: RenderMode) => void;
  setRenderStatus: (status: Partial<RenderStatus>) => void;
  insertCatalogItem: (catalogItemId: string, parentId?: string | null) => void;
  addPrimitive: (type: PrimitiveType) => void;
  updatePrimitiveParameters: (nodeId: string, partial: PrimitiveParameters) => void;
  makePrimitiveEditable: (nodeId: string) => void;
  newScene: () => void;
  renameProject: (name: string) => void;
  importFiles: (files: FileList | File[]) => Promise<void>;
  toggleNodeVisibility: (nodeId: string) => void;
  reparentNode: (nodeId: string, parentId: string | null) => void;
  moveNode: (nodeId: string, parentId: string | null, index: number) => void;
  addLightNode: (parentId?: string | null) => void;
  updateNode: (nodeId: string, partial: Partial<SceneNodeRecord>) => void;
  updateTransform: (
    nodeId: string,
    transform: Partial<TransformRecord>,
    recordHistory?: boolean,
  ) => void;
  renameSelected: (name: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  toggleSelectedVisibility: () => void;
  toggleSelectedLock: () => void;
  groupSelected: () => void;
  unparentSelected: () => void;
  isolateSelected: () => void;
  clearIsolation: () => void;
  resetSelectedTransform: () => void;
  setEnvironmentAsset: (assetId: string) => void;
  updateEnvironment: (partial: Partial<ProjectDocument['environment']>) => void;
  updateRendererSettings: (
    partial: Partial<ProjectDocument['renderer']>,
  ) => void;
  updateCamera: (partial: Partial<ProjectDocument['cameras'][string]>) => void;
  syncCameraPose: (
    partial: Pick<ProjectDocument['cameras'][string], 'position' | 'target' | 'zoom'>,
  ) => void;
  createMaterialFromPreset: (presetId: string) => void;
  assignMaterialToBinding: (
    nodeId: string,
    bindingId: string,
    materialId: string,
  ) => void;
  updateMaterial: (materialId: string, partial: Partial<MaterialRecord>) => void;
  duplicateMaterial: (materialId: string) => void;
  deleteMaterial: (materialId: string) => void;
  deleteUnassignedMaterials: () => void;
  setSelectedMaterialId: (materialId: string | null) => void;
  mergeDiscoveredMetadata: (payload: EngineDiscoveredMetadata) => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (project: ProjectDocument) => void;
}

function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

function selectionForProject(project: ProjectDocument, state: Pick<EditorState,
  'selectedNodeId' | 'selectedBindingId' | 'selectedMaterialId'>) {
  const selectedNodeId = state.selectedNodeId === null || state.selectedNodeId === '__camera__'
    || state.selectedNodeId === '__environment__' || project.nodes[state.selectedNodeId]
    ? state.selectedNodeId : project.rootNodeIds[0] ?? null;
  const node = selectedNodeId ? project.nodes[selectedNodeId] : null;
  const bindings = node?.assetId ? project.assets[node.assetId]?.meshBindings ?? [] : [];
  const binding = bindings.find((entry) => entry.id === state.selectedBindingId)
    ?? (bindings.length === 1 ? bindings[0] : null);
  return { selectedNodeId, selectedBindingId: binding?.id ?? null,
    selectedMaterialId: node && binding
      ? node.materialBindings[binding.id] ?? binding.defaultMaterialId
      : state.selectedMaterialId && project.materials[state.selectedMaterialId] ? state.selectedMaterialId : null };
}

function pushHistory(
  project: ProjectDocument,
  history: EditorHistory,
  force = false,
): EditorHistory {
  if (!force && useEditorStore.getState().numericEditBefore) return history;
  return {
    past: [...history.past.slice(-49), cloneProject(project)],
    future: [],
  };
}

function attachNode(
  project: ProjectDocument,
  node: SceneNodeRecord,
  parentId: string | null,
): void {
  project.nodes[node.id] = node;
  if (parentId) {
    project.nodes[parentId]?.children.push(node.id);
  } else {
    project.rootNodeIds.push(node.id);
  }
}

function insertNodeAt(
  project: ProjectDocument,
  node: SceneNodeRecord,
  parentId: string | null,
  index: number,
): void {
  project.nodes[node.id] = node;
  if (parentId) {
    const siblings = project.nodes[parentId]?.children ?? [];
    const nextIndex = Math.max(0, Math.min(index, siblings.length));
    siblings.splice(nextIndex, 0, node.id);
  } else {
    const nextIndex = Math.max(0, Math.min(index, project.rootNodeIds.length));
    project.rootNodeIds.splice(nextIndex, 0, node.id);
  }
}

function detachNode(project: ProjectDocument, nodeId: string): void {
  const node = project.nodes[nodeId];
  if (!node) return;
  if (node.parentId) {
    project.nodes[node.parentId].children = project.nodes[node.parentId].children.filter(
      (id) => id !== nodeId,
    );
  } else {
    project.rootNodeIds = project.rootNodeIds.filter((id) => id !== nodeId);
  }
}

function removeNodeRecursive(project: ProjectDocument, nodeId: string): void {
  const node = project.nodes[nodeId];
  if (!node) return;
  detachNode(project, nodeId);
  node.children.forEach((childId) => removeNodeRecursive(project, childId));
  delete project.nodes[nodeId];
}

function duplicateNodeRecursive(
  project: ProjectDocument,
  sourceId: string,
  parentId: string | null,
): string {
  const source = project.nodes[sourceId];
  const duplicatedId = createId('node');
  const nextNode: SceneNodeRecord = {
    ...structuredClone(source),
    id: duplicatedId,
    name: `${source.name} Copy`,
    parentId,
    children: [],
  };
  attachNode(project, nextNode, parentId);
  source.children.forEach((childId) => {
    duplicateNodeRecursive(project, childId, duplicatedId);
  });
  return duplicatedId;
}

function inferMimeType(file: File): string {
  if (file.name.endsWith('.glb')) return 'model/gltf-binary';
  if (file.name.endsWith('.gltf')) return 'model/gltf+json';
  if (file.name.endsWith('.hdr')) return 'image/vnd.radiance';
  if (file.name.endsWith('.exr')) return 'image/exr';
  return file.type || 'application/octet-stream';
}

function collectNodeMaterialIds(node: SceneNodeRecord): string[] {
  return Object.values(node.materialBindings);
}

function getMaterialFingerprint(material: Omit<MaterialRecord, 'id' | 'name'>): string {
  return JSON.stringify(material);
}

function stripMaterialIdentity(material: MaterialRecord): Omit<MaterialRecord, 'id' | 'name'> {
  const { id: _id, name: _name, ...rest } = material;
  return rest;
}

function getReferencedMaterialIds(project: ProjectDocument): Set<string> {
  const referenced = new Set<string>();

  Object.values(project.assets).forEach((asset) => {
    asset.meshBindings.forEach((binding) => {
      if (binding.defaultMaterialId && binding.defaultMaterialId !== DEFAULT_DIFFUSE_MATERIAL_ID) {
        referenced.add(binding.defaultMaterialId);
      }
    });
  });

  Object.values(project.nodes).forEach((node) => {
    Object.values(node.materialBindings).forEach((materialId) => {
      if (materialId && materialId !== DEFAULT_DIFFUSE_MATERIAL_ID) {
        referenced.add(materialId);
      }
    });
  });

  return referenced;
}

function removeMaterialAssignments(project: ProjectDocument, materialId: string): void {
  Object.values(project.assets).forEach((asset) => {
    asset.meshBindings = asset.meshBindings.map((binding) =>
      binding.defaultMaterialId === materialId
        ? {
            ...binding,
            defaultMaterialId: DEFAULT_DIFFUSE_MATERIAL_ID,
          }
        : binding,
    );
  });

  Object.values(project.nodes).forEach((node) => {
    Object.entries(node.materialBindings).forEach(([bindingId, assignedMaterialId]) => {
      if (assignedMaterialId === materialId) {
        node.materialBindings[bindingId] = DEFAULT_DIFFUSE_MATERIAL_ID;
      }
    });
  });
}

function createDefaultLight(): LightRecord {
  return createLightRecord('area');
}

function createLightNode(name: string, parentId: string | null): SceneNodeRecord {
  return {
    id: createId('node'),
    name,
    nodeType: 'light',
    parentId,
    children: [],
    visible: true,
    locked: false,
    isolated: false,
    isGroup: false,
    light: createDefaultLight(),
    transform: {
      position: [0, 1.8, 1.6],
      rotation: [-0.95, 0, 0],
      scale: [1, 1, 1],
    },
    materialBindings: {},
  };
}

function isDescendant(
  project: ProjectDocument,
  ancestorId: string,
  candidateId: string | null,
): boolean {
  if (!candidateId) return false;
  if (ancestorId === candidateId) return true;
  let currentId = project.nodes[candidateId]?.parentId ?? null;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = project.nodes[currentId]?.parentId ?? null;
  }
  return false;
}

function normalizeProject(project: ProjectDocument): ProjectDocument {
  const next = cloneProject(project);
  if (next.name === 'Studio Forge Project') next.name = 'Three Render Project';
  Object.values(next.assets).forEach(asset => {
    if (asset.sourceUri.endsWith('/HDRI_STUDIO_vol2_019.exr')) {
      asset.sourceUri = '/assets/studio_small_09_1k.hdr';
      asset.mimeType = 'image/vnd.radiance';
      asset.name = 'Studio Small 09 (CC0)';
    }
    if (asset.catalogItemId === 'gift-box') {
      asset.sourceKind = 'primitive'; asset.primitive = 'cube'; asset.sourceUri = 'primitive:cube';
      asset.name = 'Cube'; delete asset.catalogItemId;
      asset.meshBindings = [{id:`${asset.id}::binding::0:0`,label:'Surface',meshPath:'0',slot:0,defaultMaterialId:DEFAULT_DIFFUSE_MATERIAL_ID}];
      Object.values(next.nodes).filter(node => node.assetId === asset.id).forEach(node => {
        if (node.name === 'Gift Box') node.name = 'Cube';
        node.primitiveParameters = normalizePrimitiveParameters('cube', {width:.1,height:.08,depth:.1});
      });
    }
    if (asset.sourceKind === 'primitive' && !asset.meshBindings.length) {
      asset.meshBindings = [{id:`${asset.id}::binding::0:0`,label:'Surface',meshPath:'0',slot:0,defaultMaterialId:DEFAULT_DIFFUSE_MATERIAL_ID}];
    }
  });
  const activeCamera = next.cameras[next.activeCameraId];
  if (activeCamera.near === undefined) activeCamera.near = 0.1;
  if (activeCamera.far === undefined) activeCamera.far = 200;
  if (next.environment.enabled === undefined) next.environment.enabled = true;
  Object.values(next.nodes).forEach((node) => {
    if (!node.nodeType) {
      node.nodeType = node.isGroup ? 'group' : node.assetId ? 'asset' : 'group';
    }
    if (node.nodeType === 'group') {
      node.isGroup = true;
      delete node.light;
    }
    if (node.nodeType === 'asset') {
      node.isGroup = false;
      delete node.light;
    }
    if (node.nodeType === 'light') {
      node.isGroup = false;
      node.light = {
        ...createLightRecord(node.light?.type ?? 'area'),
        ...node.light,
      };
    }
  });
  if ((next.renderer as ProjectDocument['renderer'] & { bounces?: number }).bounces !== undefined) {
    const legacyRenderer = next.renderer as ProjectDocument['renderer'] & {
      mode: string;
      bounces?: number;
      renderScale?: number;
      denoiseEnabled?: boolean;
    };
    const legacyMode = legacyRenderer.mode as string;
    next.renderer = {
      mode:
        legacyMode === 'path-preview'
          ? 'live'
          : legacyMode === 'path-final'
            ? 'render'
            : legacyMode === 'solid'
              ? 'solid'
              : legacyMode === 'realtime'
                ? 'realtime'
                : 'realtime',
      exposure: legacyRenderer.exposure ?? 1,
      transparentBackground: legacyRenderer.transparentBackground ?? false,
      live: {
        bounces: 2,
        renderScale: 0.45,
        tiles: 2,
        sampleLimit: 12,
      },
      render: {
        bounces: legacyRenderer.bounces ?? 6,
        renderScale: legacyRenderer.renderScale ?? 1,
        tiles: 3,
        sampleLimit: 128,
      },
      denoise: {
        enabled: false,
        applyToLive: false,
        blend: 1,
        maxTileSize: 512,
      },
    };
  }
  if (next.renderer.live.tiles === undefined) next.renderer.live.tiles = 2;
  if (next.renderer.render.tiles === undefined) next.renderer.render.tiles = 3;
  if (next.renderer.denoise.blend === undefined) next.renderer.denoise.blend = 0.6;
  if (next.renderer.denoise.maxTileSize === undefined) next.renderer.denoise.maxTileSize = 512;
  next.renderer.denoise.enabled ??= false;
  next.renderer.denoise.applyToLive ??= true;
  return next;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  catalog: null,
  project: null,
  selectedNodeId: null,
  selectedBindingId: null,
  selectedMaterialId: null,
  sharedMaterialEditKey: null,
  setSharedMaterialEditing(materialId) {
    const { project } = get();
    const usages = project && materialId ? getMaterialUsages(project, materialId) : [];
    set({ sharedMaterialEditKey: materialId && usages.length > 1 && !usages.some((usage) => usage.locked)
      ? materialUsageKey(materialId, usages) : null });
  },
  leftPanelTab: 'outliner',
  inspectorTab: 'object',
  transformMode: 'translate',
  transformSpace: 'world',
  translateSnap: 0.25,
  rotateSnap: 15,
  scaleSnap: 0.1,
  snapEnabled: false,
  transformBeforeDrag: null,
  numericEditBefore: null,
  beginNumericEdit() {
    if (get().project && !get().numericEditBefore) set({ numericEditBefore: cloneProject(get().project!) });
  },
  endNumericEdit(cancel = false) {
    const { numericEditBefore, project, history } = get();
    if (!numericEditBefore || !project) return;
    set({ numericEditBefore: null,
      ...(cancel ? { project: numericEditBefore } : JSON.stringify(numericEditBefore) !== JSON.stringify(project)
        ? { history: pushHistory(numericEditBefore, history, true) } : {}),
    });
  },
  history: {
    past: [],
    future: [],
  },
  renderStatus: {
    supported: true,
    mode: 'realtime',
    sampleCount: 0,
    sampleLimit: 0,
    invalidationReasons: [],
    postprocessState: 'idle',
  },
  initialize(catalog, autosave) {
    const project = normalizeProject(autosave ?? createDefaultProject(catalog));
    set({
      catalog,
      project,
      sharedMaterialEditKey: null,
      history: { past: [], future: [] },
      transformBeforeDrag: null,
      numericEditBefore: null,
      axisEditMode: false,
      selectedNodeId: project.rootNodeIds[0] ?? null,
      selectedBindingId: null,
      renderStatus: {
        supported: true,
        mode: project.renderer.mode,
        sampleCount: 0,
        sampleLimit: project.renderer.mode === 'live'
          ? project.renderer.live.sampleLimit
          : project.renderer.mode === 'render'
            ? project.renderer.render.sampleLimit
            : 0,
        invalidationReasons: [],
        postprocessState: 'idle',
      },
    });
  },
  setLeftPanelTab(tab) {
    set({ leftPanelTab: tab });
  },
  setInspectorTab(tab) {
    set({ inspectorTab: tab, sharedMaterialEditKey: null });
  },
  selectNode(nodeId) {
    const { project } = get();
    const node = nodeId && project ? project.nodes[nodeId] : null;
    const asset = node?.assetId ? project?.assets[node.assetId] : null;
    const autoBindingId = asset?.meshBindings.length === 1 ? asset.meshBindings[0].id : null;
    set({
      selectedNodeId: nodeId,
      sharedMaterialEditKey: null,
      axisEditMode: get().axisEditMode && node?.nodeType === 'asset' && !node.locked,
      selectedBindingId: autoBindingId,
      selectedMaterialId:
        node && autoBindingId
          ? node.materialBindings[autoBindingId] ??
            asset?.meshBindings[0]?.defaultMaterialId ??
            DEFAULT_DIFFUSE_MATERIAL_ID
          : node
            ? collectNodeMaterialIds(node)[0] ?? null
            : null,
    });
  },
  selectBinding(nodeId, bindingId) {
    const { project } = get();
    if (!project || !project.nodes[nodeId]) return;
    const node = project.nodes[nodeId];
    const asset = node.assetId ? project.assets[node.assetId] : null;
    const binding = asset?.meshBindings.find((entry) => entry.id === bindingId);
    set({
      selectedNodeId: nodeId,
      sharedMaterialEditKey: null,
      selectedBindingId: bindingId,
      selectedMaterialId:
        node.materialBindings[bindingId] ?? binding?.defaultMaterialId ?? DEFAULT_DIFFUSE_MATERIAL_ID,
      inspectorTab: 'material',
    });
  },
  setTransformMode(mode) {
    set({ transformMode: mode, ...(mode !== 'translate' ? {axisEditMode: false} : {}) });
  },
  axisEditMode: false,
  setAxisEditMode(enabled) {
    const {project, selectedNodeId} = get();
    const node = selectedNodeId ? project?.nodes[selectedNodeId] : null;
    if (enabled && node?.nodeType === 'asset' && !node.locked &&
      (project?.renderer.mode === 'live' || project?.renderer.mode === 'render')) get().setRenderMode('realtime');
    set({ axisEditMode: enabled && node?.nodeType === 'asset' && !node.locked,
      ...(enabled ? {transformMode: 'translate' as const, inspectorTab: 'object' as const} : {}) });
  },
  setPivotOffset(nodeId, pivot) {
    const {project, history} = get();
    if (!project) return;
    const next = cloneProject(project);
    if (!moveNodeAxis(next, nodeId, pivot)) return;
    set({project: touchProject(next), history: pushHistory(project, history)});
  },
  addNull() {
    const {project, history} = get();
    if (!project) return;
    const next = cloneProject(project);
    const node: SceneNodeRecord = {...createNodeForAsset('', 'Null', null), nodeType: 'group', isGroup: true, assetId: undefined};
    attachNode(next, node, null);
    set({project: touchProject(next), history: pushHistory(project, history), selectedNodeId: node.id, axisEditMode: false, inspectorTab: 'object'});
  },
  setTransformSpace(space) {
    set({ transformSpace: space });
  },
  setSnapEnabled(enabled) {
    set({ snapEnabled: enabled });
  },
  setRenderMode(mode) {
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    next.renderer.mode = mode;
    const touched = touchProject(next);
    set({
      project: touched,
      history: pushHistory(project, history),
      ...(mode === 'live' || mode === 'render' ? {axisEditMode: false} : {}),
      renderStatus: {
        ...get().renderStatus,
        mode,
        sampleLimit:
          mode === 'live'
            ? next.renderer.live.sampleLimit
            : mode === 'render'
              ? next.renderer.render.sampleLimit
              : 0,
      },
    });
  },
  setRenderStatus(status) {
    if (Object.entries(status).every(([key, value]) => {
      const previous = get().renderStatus[key as keyof RenderStatus];
      return Array.isArray(value) ? JSON.stringify(previous) === JSON.stringify(value) : previous === value;
    })) return;
    set({
      renderStatus: {
        ...get().renderStatus,
        ...status,
      },
    });
  },
  renameProject(name) {
    const { project, history } = get();
    if (!project || !name.trim() || project.name === name.trim()) return;
    set({ project: touchProject({ ...project, name: name.trim() }), history: pushHistory(project, history) });
  },
  addPrimitive(type) {
    const { project, history } = get();
    if (!project) return;
    const name = PRIMITIVES.find((entry) => entry.type === type)?.name ?? 'Cube';
    const next = cloneProject(project);
    const asset = createPrimitiveAsset(type);
    next.assets[asset.id] = asset;
    const node = createNodeForAsset(asset.id, name, null);
    node.primitiveParameters = normalizePrimitiveParameters(type);
    attachNode(next, node, null);
    set({ project: touchProject(next), history: pushHistory(project, history), selectedNodeId: node.id,
      selectedBindingId: null, inspectorTab: 'object', axisEditMode: false });
  },
  updatePrimitiveParameters(nodeId, partial) {
    const { project, history } = get();
    const node = project?.nodes[nodeId];
    const asset = node?.assetId ? project?.assets[node.assetId] : null;
    if (!project || !node || node.locked || asset?.sourceKind !== 'primitive' || !asset.primitive) return;
    const parameters = normalizePrimitiveParameters(asset.primitive, { ...node.primitiveParameters, ...partial });
    if (JSON.stringify(parameters) === JSON.stringify(node.primitiveParameters)) return;
    const next = cloneProject(project);
    next.nodes[nodeId].primitiveParameters = parameters;
    set({project:touchProject(next),history:pushHistory(project,history)});
  },
  makePrimitiveEditable(nodeId) {
    const { project, history } = get();
    const node = project?.nodes[nodeId];
    const asset = node?.assetId ? project?.assets[node.assetId] : null;
    if (!project || !node || node.locked || asset?.sourceKind !== 'primitive' || !asset.primitive) return;
    const generated = createPrimitiveGeometry(asset.primitive, node.primitiveParameters);
    const baked = new BufferGeometry().copy(generated);
    const id = createId('asset');
    const bindingId = `${id}::binding::0:0`;
    const materialId = node.materialBindings[asset.meshBindings[0]?.id] ?? asset.meshBindings[0]?.defaultMaterialId ?? DEFAULT_DIFFUSE_MATERIAL_ID;
    const next = cloneProject(project);
    next.assets[id] = {id,name:node.name,kind:'model',sourceKind:'geometry',sourceUri:`geometry:${id}`,geometry:baked.toJSON(),
      defaultScale:[1,1,1],pivotHint:'floor',meshBindings:[{id:bindingId,label:'Surface',meshPath:'0',slot:0,defaultMaterialId:materialId}]};
    next.nodes[nodeId].assetId = id;
    next.nodes[nodeId].materialBindings = {[bindingId]:materialId};
    delete next.nodes[nodeId].primitiveParameters;
    generated.dispose(); baked.dispose();
    set({project:touchProject(next),history:pushHistory(project,history),selectedBindingId:bindingId});
  },
  newScene() {
    const {catalog,project,history} = get();
    if (!catalog || !project) return;
    const next = createDefaultProject(catalog);
    set({project:next,history:pushHistory(project,history),selectedNodeId:next.rootNodeIds[0],selectedBindingId:null,inspectorTab:'object',axisEditMode:false,sharedMaterialEditKey:null});
  },
  insertCatalogItem(catalogItemId, parentId = null) {
    const { catalog, project, history } = get();
    if (!catalog || !project) return;
    const item = catalog.items.find((entry) => entry.id === catalogItemId);
    if (!item) return;
    const next = cloneProject(project);
    const asset = createAssetFromCatalogItem(item);
    next.assets[asset.id] = asset;
    if (asset.kind === 'environment') {
      next.environment.assetId = asset.id;
    } else {
      const node = createNodeForAsset(asset.id, item.name, parentId, {
        position: [0, 0, 0],
      });
      attachNode(next, node, parentId);
      set({ selectedNodeId: node.id });
    }
    const touched = touchProject(next);
    set({
      project: touched,
      history: pushHistory(project, history),
    });
  },
  async importFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    const prepared = await Promise.all(list.map(async (file) => {
      if (!/\.(glb|gltf|hdr|exr)$/i.test(file.name)) {
        throw new Error(`Unsupported file: ${file.name}. Import GLB, self-contained glTF, HDR or EXR.`);
      }
      if (/\.gltf$/i.test(file.name)) {
        const gltf = JSON.parse(await file.text()) as { asset?: { version?: string }; buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
        if (gltf.asset?.version !== '2.0') throw new Error('Only glTF 2.0 models are supported.');
        const resources = [...(gltf.buffers ?? []), ...(gltf.images ?? [])];
        if (resources.some((resource) => resource.uri && !resource.uri.startsWith('data:'))) {
          throw new Error(`${file.name} references external files. Export a GLB or embed the glTF buffers and textures.`);
        }
      }
      return { file, dataUrl: await fileToDataUrl(file) };
    }));
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    let selectedNodeId = get().selectedNodeId;
    for (const { file, dataUrl } of prepared) {
      const isEnvironment = /\.(hdr|exr)$/i.test(file.name);
      const asset: AssetRecord = {
        id: createId('asset'), name: file.name.replace(/\.[^.]+$/, ''),
        kind: isEnvironment ? 'environment' : 'model', sourceKind: 'upload',
        sourceUri: dataUrl, mimeType: inferMimeType(file), defaultScale: [1, 1, 1],
        pivotHint: isEnvironment ? 'centered' : 'floor', meshBindings: [],
      };
      next.assets[asset.id] = asset;
      if (isEnvironment) {
        next.environment.assetId = asset.id;
        next.environment.enabled = true;
      } else {
        const node = createNodeForAsset(asset.id, asset.name, null);
        attachNode(next, node, null);
        selectedNodeId = node.id;
      }
    }
    set({ project: touchProject(next), history: pushHistory(project, history), selectedNodeId,
      selectedBindingId: null, inspectorTab: 'object' });
  },
  toggleNodeVisibility(nodeId) {
    const { project, history } = get();
    if (!project || !project.nodes[nodeId]) return;
    const next = cloneProject(project);
    next.nodes[nodeId].visible = !next.nodes[nodeId].visible;
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  reparentNode(nodeId, parentId) {
    const { project, history } = get();
    if (!project || !project.nodes[nodeId] || project.nodes[nodeId].locked) return;
    if (parentId && !project.nodes[parentId]) return;
    if (nodeId === parentId) return;
    if (isDescendant(project, nodeId, parentId)) return;
    const node = project.nodes[nodeId];
    if (node.parentId === parentId) return;
    const next = cloneProject(project);
    const worldTransform = worldTransformForNode(project, nodeId);
    detachNode(next, nodeId);
    next.nodes[nodeId].parentId = parentId;
    next.nodes[nodeId].transform = localTransformFromWorld(next, nodeId, worldTransform);
    attachNode(next, next.nodes[nodeId], parentId);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: nodeId,
      selectedBindingId: null,
    });
  },
  moveNode(nodeId, parentId, index) {
    const { project, history } = get();
    if (!project || !project.nodes[nodeId] || project.nodes[nodeId].locked) return;
    if (parentId && !project.nodes[parentId]) return;
    if (nodeId === parentId) return;
    if (isDescendant(project, nodeId, parentId)) return;

    const next = cloneProject(project);
    const currentNode = next.nodes[nodeId];
    const currentParentId = currentNode.parentId;
    const worldTransform = currentParentId !== parentId ? worldTransformForNode(project, nodeId) : null;
    const currentSiblings = currentParentId
      ? next.nodes[currentParentId].children
      : next.rootNodeIds;
    const currentIndex = currentSiblings.indexOf(nodeId);

    detachNode(next, nodeId);
    currentNode.parentId = parentId;
    if (worldTransform) currentNode.transform = localTransformFromWorld(next, nodeId, worldTransform);

    let nextIndex = index;
    if (currentParentId === parentId && currentIndex !== -1 && currentIndex < index) {
      nextIndex -= 1;
    }

    insertNodeAt(next, currentNode, parentId, nextIndex);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: nodeId,
    });
  },
  addLightNode(parentId = null) {
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    const lightCount = Object.values(next.nodes).filter((node) => node.nodeType === 'light').length;
    const lightNode = createLightNode(`Light ${lightCount + 1}`, parentId);
    attachNode(next, lightNode, parentId);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: lightNode.id,
      selectedBindingId: null,
      inspectorTab: 'object',
    });
  },
  updateNode(nodeId, partial) {
    const { project, history } = get();
    if (!project || !project.nodes[nodeId]) return;
    if (project.nodes[nodeId].locked && Object.keys(partial).some((key) =>
      !['name', 'locked', 'visible', 'isolated'].includes(key))) return;
    const next = cloneProject(project);
    next.nodes[nodeId] = {
      ...next.nodes[nodeId],
      ...partial,
    };
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      ...(partial.locked !== undefined ? { sharedMaterialEditKey: null } : {}),
    });
  },
  updateTransform(nodeId, transform, recordHistory = false) {
    const { project, history, transformBeforeDrag } = get();
    if (!project || !project.nodes[nodeId] || project.nodes[nodeId].locked) return;
    const next = cloneProject(project);
    if (get().axisEditMode && project.nodes[nodeId].nodeType === 'asset') {
      if (!transform.position) return;
      const pivot = pivotForAxisPosition(project.nodes[nodeId], transform.position);
      if (!pivot) return;
      moveNodeAxis(next, nodeId, pivot);
    } else next.nodes[nodeId].transform = {
      ...next.nodes[nodeId].transform,
      ...transform,
    };
    set({
      project: touchProject(next),
      history: recordHistory ? pushHistory(transformBeforeDrag ?? project, history) : history,
      transformBeforeDrag: recordHistory ? null : transformBeforeDrag ?? cloneProject(project),
    });
  },
  renameSelected(name) {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    get().updateNode(selectedNodeId, { name });
  },
  duplicateSelected() {
    const { selectedNodeId, project, history } = get();
    if (!selectedNodeId || !project?.nodes[selectedNodeId]) return;
    const selected = project.nodes[selectedNodeId];
    const next = cloneProject(project);
    const newId = duplicateNodeRecursive(next, selectedNodeId, selected.parentId);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: newId,
      selectedBindingId: null,
    });
  },
  deleteSelected() {
    const { selectedNodeId, project, history } = get();
    if (!selectedNodeId || !project?.nodes[selectedNodeId] || subtreeHasLockedNode(project, selectedNodeId)) return;
    const next = cloneProject(project);
    removeNodeRecursive(next, selectedNodeId);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: next.rootNodeIds[0] ?? null,
      selectedBindingId: null,
    });
  },
  toggleSelectedVisibility() {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    get().toggleNodeVisibility(selectedNodeId);
  },
  toggleSelectedLock() {
    const { project, selectedNodeId, history } = get();
    if (!project || !selectedNodeId || !project.nodes[selectedNodeId]) return;
    const next = cloneProject(project);
    next.nodes[selectedNodeId].locked = !next.nodes[selectedNodeId].locked;
    set({
      axisEditMode: false,
      sharedMaterialEditKey: null,
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  groupSelected() {
    const { project, selectedNodeId, history } = get();
    if (!project || !selectedNodeId || !project.nodes[selectedNodeId] || project.nodes[selectedNodeId].locked) return;
    const selected = project.nodes[selectedNodeId];
    const next = cloneProject(project);
    const groupId = createId('node');
    const group: SceneNodeRecord = {
      id: groupId,
      name: `${selected.name} Group`,
      nodeType: 'group',
      assetId: undefined,
      parentId: selected.parentId,
      children: [selected.id],
      visible: true,
      locked: false,
      isolated: false,
      isGroup: true,
      light: undefined,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      materialBindings: {},
    };

    detachNode(next, selected.id);
    attachNode(next, group, group.parentId);
    next.nodes[selected.id].parentId = groupId;
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedNodeId: groupId,
      axisEditMode: false,
    });
  },
  unparentSelected() {
    const { project, selectedNodeId, history } = get();
    if (!project || !selectedNodeId || !project.nodes[selectedNodeId] || project.nodes[selectedNodeId].locked) return;
    const node = project.nodes[selectedNodeId];
    if (!node.parentId) return;
    const next = cloneProject(project);
    const worldTransform = worldTransformForNode(project, selectedNodeId);
    detachNode(next, selectedNodeId);
    next.nodes[selectedNodeId].parentId = null;
    next.nodes[selectedNodeId].transform = worldTransform;
    attachNode(next, next.nodes[selectedNodeId], null);
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  isolateSelected() {
    const { project, selectedNodeId, history } = get();
    if (!project || !selectedNodeId || !project.nodes[selectedNodeId]) return;
    const next = cloneProject(project);
    const isolateEnabled = !next.nodes[selectedNodeId].isolated;
    Object.values(next.nodes).forEach((node) => {
      node.isolated = isolateEnabled && node.id === selectedNodeId;
    });
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  clearIsolation() {
    const { project, history } = get();
    if (!project || !Object.values(project.nodes).some((node) => node.isolated)) return;
    const next = cloneProject(project);
    Object.values(next.nodes).forEach((node) => { node.isolated = false; });
    set({ project: touchProject(next), history: pushHistory(project, history) });
  },
  resetSelectedTransform() {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    set({axisEditMode: false});
    get().updateTransform(
      selectedNodeId,
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      true,
    );
  },
  setEnvironmentAsset(assetId) {
    get().updateEnvironment({ assetId });
  },
  updateEnvironment(partial) {
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    next.environment = {
      ...next.environment,
      ...partial,
    };
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  updateRendererSettings(partial) {
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    next.renderer = {
      ...next.renderer,
      ...partial,
    };
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      renderStatus: {
        ...get().renderStatus,
        mode: next.renderer.mode,
        sampleLimit:
          next.renderer.mode === 'live'
            ? next.renderer.live.sampleLimit
            : next.renderer.mode === 'render'
              ? next.renderer.render.sampleLimit
              : 0,
      },
    });
  },
  updateCamera(partial) {
    const { project, history } = get();
    if (!project) return;
    const next = cloneProject(project);
    const activeId = next.activeCameraId;
    next.cameras[activeId] = {
      ...next.cameras[activeId],
      ...partial,
    };
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  syncCameraPose(partial) {
    const { project } = get();
    if (!project) return;
    const next = cloneProject(project);
    const activeId = next.activeCameraId;
    next.cameras[activeId] = {
      ...next.cameras[activeId],
      ...partial,
    };
    set({
      project: touchProject(next),
    });
  },
  createMaterialFromPreset(presetId) {
    const { project, history, selectedNodeId, selectedBindingId } = get();
    if (!project) return;
    const preset = MATERIAL_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const next = cloneProject(project);
    const material = createMaterialRecord({
      ...preset,
      id: createId('mat'),
      name: `${preset.name} Copy`,
    });
    next.materials[material.id] = material;
    const selectedNode = selectedNodeId ? next.nodes[selectedNodeId] : null;
    const bindings = selectedNode?.assetId ? next.assets[selectedNode.assetId]?.meshBindings : [];
    const bindingId = selectedBindingId ?? (bindings?.length === 1 ? bindings[0].id : null);
    if (selectedNode && bindingId && !selectedNode.locked) {
      selectedNode.materialBindings[bindingId] = material.id;
    }
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedMaterialId: material.id,
      selectedBindingId: bindingId,
      sharedMaterialEditKey: null,
      inspectorTab: 'material',
    });
  },
  assignMaterialToBinding(nodeId, bindingId, materialId) {
    const { project, history } = get();
    const node = project?.nodes[nodeId];
    const binding = node?.assetId ? project?.assets[node.assetId]?.meshBindings.find((entry) => entry.id === bindingId) : null;
    if (!project || !node || node.locked || !binding
      || (materialId !== DEFAULT_DIFFUSE_MATERIAL_ID && !project.materials[materialId])) return;
    if ((node.materialBindings[bindingId] ?? binding.defaultMaterialId) === materialId) return;
    const next = cloneProject(project);
    next.nodes[nodeId].materialBindings[bindingId] = materialId;
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedBindingId: bindingId,
      selectedMaterialId: materialId,
      sharedMaterialEditKey: null,
    });
  },
  makeMaterialUnique(nodeId, bindingId) {
    const { project, history } = get();
    const node = project?.nodes[nodeId];
    const binding = node?.assetId ? project?.assets[node.assetId]?.meshBindings.find((entry) => entry.id === bindingId) : null;
    if (!project || !node || node.locked || !binding) return;
    const source = project.materials[node.materialBindings[bindingId] ?? binding.defaultMaterialId];
    if (!source) return;
    const next = cloneProject(project);
    const material = createMaterialRecord({ ...source, id: createId('mat'), name: `${source.name} Copy` });
    next.materials[material.id] = material;
    next.nodes[nodeId].materialBindings[bindingId] = material.id;
    set({ project: touchProject(next), history: pushHistory(project, history),
      selectedNodeId: nodeId, selectedBindingId: bindingId, selectedMaterialId: material.id,
      sharedMaterialEditKey: null, inspectorTab: 'material' });
  },
  updateMaterial(materialId, partial) {
    const { project, history } = get();
    if (!project || !project.materials[materialId]) return;
    if (!canEditMaterial(getMaterialUsages(project, materialId), materialId, get().sharedMaterialEditKey)) return;
    const next = cloneProject(project);
    next.materials[materialId] = {
      ...next.materials[materialId],
      ...partial,
      id: materialId,
    };
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
    });
  },
  duplicateMaterial(materialId) {
    const { project, history } = get();
    if (!project || !project.materials[materialId]) return;
    const next = cloneProject(project);
    const source = next.materials[materialId];
    const duplicate = createMaterialRecord({
      ...source,
      id: createId('mat'),
      name: `${source.name} Copy`,
    });
    next.materials[duplicate.id] = duplicate;
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedMaterialId: duplicate.id,
      selectedNodeId: null,
      axisEditMode: false,
      sharedMaterialEditKey: null,
      selectedBindingId: null,
      inspectorTab: 'material',
    });
  },
  deleteMaterial(materialId) {
    const { project, history, selectedMaterialId } = get();
    if (!project || !project.materials[materialId]) return;
    if (!canEditMaterial(getMaterialUsages(project, materialId), materialId, get().sharedMaterialEditKey)) return;
    const next = cloneProject(project);
    removeMaterialAssignments(next, materialId);
    delete next.materials[materialId];
    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      sharedMaterialEditKey: null,
      selectedMaterialId:
        selectedMaterialId === materialId ? null : get().selectedMaterialId,
    });
  },
  deleteUnassignedMaterials() {
    const { project, history, selectedMaterialId } = get();
    if (!project) return;
    const referenced = getReferencedMaterialIds(project);
    const removableIds = Object.keys(project.materials).filter((materialId) => !referenced.has(materialId));
    if (removableIds.length === 0) return;

    const next = cloneProject(project);
    removableIds.forEach((materialId) => {
      delete next.materials[materialId];
    });

    set({
      project: touchProject(next),
      history: pushHistory(project, history),
      selectedMaterialId:
        selectedMaterialId && removableIds.includes(selectedMaterialId) ? null : selectedMaterialId,
    });
  },
  setSelectedMaterialId(materialId) {
    set({ selectedMaterialId: materialId, sharedMaterialEditKey: null });
  },
  mergeDiscoveredMetadata(payload) {
    const { project } = get();
    if (!project) return;
    const next = cloneProject(project);
    const asset = next.assets[payload.assetId];
    if (!asset) return;
    const materialIdMap = new Map<string, string>();
    payload.materials.forEach((material) => {
      if (next.materials[material.id]) {
        materialIdMap.set(material.id, material.id);
        return;
      }
      const fingerprint = getMaterialFingerprint(stripMaterialIdentity(material));
      const existing = Object.values(next.materials).find(
        (entry) => getMaterialFingerprint(stripMaterialIdentity(entry)) === fingerprint,
      );
      const resolvedId = existing?.id ?? material.id;
      materialIdMap.set(material.id, resolvedId);
      if (!existing) {
        next.materials[material.id] = material;
      }
    });
    asset.meshBindings = payload.meshBindings.map((binding) => ({
      ...binding,
      defaultMaterialId:
        materialIdMap.get(binding.defaultMaterialId) ?? binding.defaultMaterialId,
    }));
    Object.values(next.nodes)
      .filter((node) => node.assetId === payload.assetId)
      .forEach((node) => {
        asset.meshBindings.forEach((binding) => {
          node.materialBindings[binding.id] =
            node.materialBindings[binding.id] ?? binding.defaultMaterialId;
        });
      });
    set({ project: touchProject(next) });
  },
  undo() {
    const { history, project } = get();
    if (!project || history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    set({
      project: previous,
      sharedMaterialEditKey: null,
      transformBeforeDrag: null,
      history: {
        past: history.past.slice(0, -1),
        future: [cloneProject(project), ...history.future],
      },
      ...selectionForProject(previous, get()),
    });
  },
  redo() {
    const { history, project } = get();
    if (!project || history.future.length === 0) return;
    const nextProject = history.future[0];
    set({
      project: nextProject,
      sharedMaterialEditKey: null,
      transformBeforeDrag: null,
      history: {
        past: [...history.past, cloneProject(project)],
        future: history.future.slice(1),
      },
      ...selectionForProject(nextProject, get()),
    });
  },
  replaceProject(project) {
    const normalized = normalizeProject(project);
    set({
      project: normalized,
      sharedMaterialEditKey: null,
      axisEditMode: false,
      transformBeforeDrag: null,
      selectedNodeId: normalized.rootNodeIds[0] ?? null,
      selectedBindingId: null,
      history: {
        past: [],
        future: [],
      },
      renderStatus: {
        ...get().renderStatus,
        mode: normalized.renderer.mode,
        sampleLimit:
          normalized.renderer.mode === 'live'
            ? normalized.renderer.live.sampleLimit
            : normalized.renderer.mode === 'render'
              ? normalized.renderer.render.sampleLimit
              : 0,
        invalidationReasons: [] as InvalidationReason[],
      },
    });
  },
}));
