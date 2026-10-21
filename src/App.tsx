import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  Box,
  Axis3D,
  Focus,
  Camera,
  ChevronDown,
  ChevronRight,
  Folder,
  Layers3,
  Search,
  Globe2,
  Lightbulb,
  Lock,
  Unlock,
  Magnet,
  Maximize2,
  Minimize2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Rotate3D,
  Scaling,
  Undo2,
  Upload,
} from './icons';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { Viewport, viewportDragMime, type ViewportCommands } from './components/Viewport';
import { EditorMenuBar, ShortcutDialog } from './components/EditorMenuBar';
import { AssetShelf } from './components/AssetShelf';
import { PRIMITIVES } from './core/primitives';
import { NumericField as NumericScrubInput } from './components/NumericField';
import { PrimitiveEditor } from './components/PrimitiveEditor';
import { PrimitiveIcon } from './components/PrimitiveIcon';
import { ObjectPalette } from './components/ObjectPalette';
import { AxisEditor } from './components/AxisEditor';
import { MaterialUsagePanel } from './components/MaterialUsagePanel';
import { canEditMaterial, getMaterialUsages, materialUsageKey } from './core/materialUsage';
import { subtreeHasLockedNode } from './core/sceneHierarchy';
import { localTransformFromWorld, worldTransformForNode } from './core/sceneTransforms';
import { loadCatalogManifest } from './core/catalog';
import { publicAssetUrl } from './core/publicAssets';
import {
  downloadProjectFile,
  loadAutosave,
  readProjectFile,
  saveAutosave,
} from './core/persistence';
import { createLightRecord } from './core/lights';
import { DEFAULT_DIFFUSE_MATERIAL_ID } from './core/materials';
import { abbeToDispersion, dispersionToAbbe } from './engine/glassOptics';
import type {
  CatalogItem,
  LightRecord,
  LightType,
  MeshBindingRecord,
  MaterialRecord,
  RenderQualitySettings,
  SceneNodeRecord,
} from './core/types';
import { useEditorStore } from './state/editorStore';

const ENVIRONMENT_NODE_ID = '__environment__';
const CAMERA_NODE_ID = '__camera__';
const NODE_DRAG_MIME = 'application/x-studio-node';

function formatMode(mode: string): string {
  if (mode === 'live') return 'Live';
  if (mode === 'render') return 'Render';
  return mode[0].toUpperCase() + mode.slice(1);
}

function buildOutlinerRows(
  nodes: Record<string, SceneNodeRecord>,
  ids: string[],
  collapsedIds: Set<string>,
  depth = 0,
): Array<{ node: SceneNodeRecord; depth: number; hasChildren: boolean; expanded: boolean }> {
  return ids.flatMap((id) => {
    const node = nodes[id];
    if (!node) return [];
    const hasChildren = node.children.length > 0;
    const expanded = !collapsedIds.has(node.id);
    return [
      { node, depth, hasChildren, expanded },
      ...(hasChildren && expanded
        ? buildOutlinerRows(nodes, node.children, collapsedIds, depth + 1)
        : []),
    ];
  });
}

function getPrimaryMaterial(
  materials: Record<string, MaterialRecord>,
  node: SceneNodeRecord,
): MaterialRecord | null {
  const firstMaterialId = Object.values(node.materialBindings)[0];
  return firstMaterialId ? materials[firstMaterialId] ?? null : null;
}

export default function App() {
  const catalog = useEditorStore((state) => state.catalog);
  const project = useEditorStore((state) => state.project);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const selectedBindingId = useEditorStore((state) => state.selectedBindingId);
  const selectedMaterialId = useEditorStore((state) => state.selectedMaterialId);
  const sharedMaterialEditKey = useEditorStore((state) => state.sharedMaterialEditKey);
  const setSharedMaterialEditing = useEditorStore((state) => state.setSharedMaterialEditing);
  const makeMaterialUnique = useEditorStore((state) => state.makeMaterialUnique);
  const leftPanelTab = useEditorStore((state) => state.leftPanelTab);
  const inspectorTab = useEditorStore((state) => state.inspectorTab);
  const transformMode = useEditorStore((state) => state.transformMode);
  const axisEditMode = useEditorStore(state => state.axisEditMode);
  const setAxisEditMode = useEditorStore(state => state.setAxisEditMode);
  const setPivotOffset = useEditorStore(state => state.setPivotOffset);
  const addNull = useEditorStore(state => state.addNull);
  const transformSpace = useEditorStore((state) => state.transformSpace);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const translateSnap = useEditorStore((state) => state.translateSnap);
  const rotateSnap = useEditorStore((state) => state.rotateSnap);
  const scaleSnap = useEditorStore((state) => state.scaleSnap);
  const renderStatus = useEditorStore((state) => state.renderStatus);
  const history = useEditorStore((state) => state.history);

  const initialize = useEditorStore((state) => state.initialize);
  const addPrimitive = useEditorStore((state) => state.addPrimitive);
  const updatePrimitiveParameters = useEditorStore((state) => state.updatePrimitiveParameters);
  const makePrimitiveEditable = useEditorStore((state) => state.makePrimitiveEditable);
  const newScene = useEditorStore((state) => state.newScene);
  const renameProject = useEditorStore((state) => state.renameProject);
  const setLeftPanelTab = useEditorStore((state) => state.setLeftPanelTab);
  const setInspectorTab = useEditorStore((state) => state.setInspectorTab);
  const selectNode = useEditorStore((state) => state.selectNode);
  const selectBinding = useEditorStore((state) => state.selectBinding);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const setTransformSpace = useEditorStore((state) => state.setTransformSpace);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const setRenderMode = useEditorStore((state) => state.setRenderMode);
  const setRenderStatus = useEditorStore((state) => state.setRenderStatus);
  const insertCatalogItem = useEditorStore((state) => state.insertCatalogItem);
  const importFiles = useEditorStore((state) => state.importFiles);
  const toggleNodeVisibility = useEditorStore((state) => state.toggleNodeVisibility);
  const reparentNode = useEditorStore((state) => state.reparentNode);
  const moveNode = useEditorStore((state) => state.moveNode);
  const addLightNode = useEditorStore((state) => state.addLightNode);
  const updateNode = useEditorStore((state) => state.updateNode);
  const renameSelected = useEditorStore((state) => state.renameSelected);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const toggleSelectedVisibility = useEditorStore((state) => state.toggleSelectedVisibility);
  const toggleSelectedLock = useEditorStore((state) => state.toggleSelectedLock);
  const groupSelected = useEditorStore((state) => state.groupSelected);
  const unparentSelected = useEditorStore((state) => state.unparentSelected);
  const isolateSelected = useEditorStore((state) => state.isolateSelected);
  const clearIsolation = useEditorStore((state) => state.clearIsolation);
  const resetSelectedTransform = useEditorStore((state) => state.resetSelectedTransform);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateEnvironment = useEditorStore((state) => state.updateEnvironment);
  const updateRendererSettings = useEditorStore((state) => state.updateRendererSettings);
  const updateCamera = useEditorStore((state) => state.updateCamera);
  const syncCameraPose = useEditorStore((state) => state.syncCameraPose);
  const createMaterialFromPreset = useEditorStore((state) => state.createMaterialFromPreset);
  const assignMaterialToBinding = useEditorStore((state) => state.assignMaterialToBinding);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const duplicateMaterial = useEditorStore((state) => state.duplicateMaterial);
  const deleteMaterial = useEditorStore((state) => state.deleteMaterial);
  const deleteUnassignedMaterials = useEditorStore((state) => state.deleteUnassignedMaterials);
  const setSelectedMaterialId = useEditorStore((state) => state.setSelectedMaterialId);
  const mergeDiscoveredMetadata = useEditorStore((state) => state.mergeDiscoveredMetadata);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const replaceProject = useEditorStore((state) => state.replaceProject);

  const [sceneSearch, setSceneSearch] = useState('');
  const [shelfCollapsed, setShelfCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  const [error, setError] = useState<string | null>(null);
  const viewportCommands = useRef<ViewportCommands | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const deferredAssetSearch = useDeferredValue(assetSearch);
  const [exportImage, setExportImage] = useState<() => void>(() => () => {});
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string | null;
    position: 'before' | 'after' | 'inside' | 'root-end';
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const openProjectRef = useRef<HTMLInputElement | null>(null);
  const environmentInputRef = useRef<HTMLInputElement | null>(null);
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [viewportOnly, setViewportOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadedCatalog, autosave] = await Promise.all([
          loadCatalogManifest(), loadAutosave().catch(() => null),
        ]);
        if (cancelled) return;
        initialize(loadedCatalog, autosave);
        const loaded = useEditorStore.getState().project;
        if (loaded) {
          setCollapsedIds(new Set(Object.values(loaded.nodes).filter((node) => node.nodeType === 'asset').map((node) => node.id)));
          const subject = Object.values(loaded.nodes).find((node) => node.name === 'Cube');
          if (subject) selectNode(subject.id);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The editor could not load.');
      }
    })();
    return () => { cancelled = true; };
  }, [initialize, selectNode]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      void saveAutosave(project).then(() => {
        if (!cancelled) setSaveState('saved');
      }).catch(() => {
        if (!cancelled) setSaveState('error');
      });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [project]);

  const ready = Boolean(project && catalog);
  useEffect(() => {
    if (!ready || window.innerWidth >= 900) return;
    leftPanelRef.current?.collapse();
    rightPanelRef.current?.collapse();
    setLeftCollapsed(true);
    setRightCollapsed(true);
    setShelfCollapsed(window.innerWidth < 600);
  }, [ready]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable || showShortcuts) return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && key === 's') {
        event.preventDefault();
        const current = useEditorStore.getState().project;
        if (current) downloadProjectFile(current);
      } else if (modifier && key === 'o') {
        event.preventDefault(); openProjectRef.current?.click();
      } else if (modifier && key === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo();
      } else if (modifier && key === 'd') {
        event.preventDefault(); duplicateSelected();
      } else if (!modifier && !event.altKey) {
        if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelected(); }
        if (key === 'w') setTransformMode('translate');
        if (key === 'e') setTransformMode('rotate');
        if (key === 'r') setTransformMode('scale');
        if (key === 'l' && !event.repeat) {
          event.preventDefault();
          const state = useEditorStore.getState(); state.setAxisEditMode(!state.axisEditMode);
        }
        if (key === 'f') { event.preventDefault(); viewportCommands.current?.frame(event.shiftKey); }
        if (key === 'escape') { selectNode(null); setEditingItemId(null); }
        if (key === 'f2') {
          event.preventDefault();
          const state = useEditorStore.getState();
          const node = state.selectedNodeId ? state.project?.nodes[state.selectedNodeId] : null;
          if (node) { setEditingItemId(node.id); setEditingName(node.name); }
        }
        if (key === '?') setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [deleteSelected, duplicateSelected, redo, selectNode, setTransformMode, showShortcuts, undo]);

  const selectedEnvironment = selectedNodeId === ENVIRONMENT_NODE_ID;
  const selectedCamera = selectedNodeId === CAMERA_NODE_ID;
  const selectedNode =
    project && selectedNodeId && !selectedEnvironment ? project.nodes[selectedNodeId] : null;
  const selectedAsset =
    project && selectedNode?.assetId ? project.assets[selectedNode.assetId] : null;
  const selectedBindings = selectedAsset?.meshBindings ?? [];
  const selectedBinding =
    selectedNode && selectedBindingId
      ? selectedBindings.find((binding) => binding.id === selectedBindingId) ?? null
      : null;
  const activeBinding =
    selectedBinding ??
    (selectedBindings.length === 1 ? selectedBindings[0] : null);
  const assignedMaterialId =
    selectedNode && activeBinding
      ? selectedNode.materialBindings[activeBinding.id] ??
        activeBinding.defaultMaterialId ??
        DEFAULT_DIFFUSE_MATERIAL_ID
      : null;
  const effectiveMaterialId = assignedMaterialId ?? selectedMaterialId;
  const selectedMaterial =
    project && effectiveMaterialId && effectiveMaterialId !== DEFAULT_DIFFUSE_MATERIAL_ID
      ? project.materials[effectiveMaterialId] ?? null
      : null;
  const activeCamera = project ? project.cameras[project.activeCameraId] : null;
  const selectionHasLockedNodes = !!project && !!selectedNode && subtreeHasLockedNode(project, selectedNode.id);
  const materialUsages = useMemo(() => project && selectedMaterial
    ? getMaterialUsages(project, selectedMaterial.id) : [], [project, selectedMaterial]);
  const sharedMaterialEditing = !!selectedMaterial && materialUsages.length > 1
    && sharedMaterialEditKey === materialUsageKey(selectedMaterial.id, materialUsages);
  const materialEditable = !!selectedMaterial
    && canEditMaterial(materialUsages, selectedMaterial.id, sharedMaterialEditKey);
  const environmentAsset =
    project && project.environment.assetId
      ? project.assets[project.environment.assetId]
      : null;

  const envAssets = useMemo(
    () =>
      project
        ? Object.values(project.assets).filter((asset) => asset.kind === 'environment')
        : [],
    [project],
  );
  const materialOptions = useMemo(
    () =>
      project
        ? Object.values(project.materials).sort((left, right) =>
            left.name.localeCompare(right.name),
          )
        : [],
    [project],
  );
  const unusedMaterialCount = useMemo(() => {
    if (!project) return 0;
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
    return Object.keys(project.materials).filter((materialId) => !referenced.has(materialId)).length;
  }, [project]);
  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    const query = deferredAssetSearch.trim().toLowerCase();
    if (!query) return catalog.items;
    return catalog.items.filter((item) => {
      const haystack = `${item.name} ${item.category} ${item.tags.join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [catalog, deferredAssetSearch]);
  const flattenedNodes = useMemo(() => {
    if (!project) return [];
    const rows = buildOutlinerRows(project.nodes, project.rootNodeIds, sceneSearch ? new Set() : collapsedIds);
    const query = sceneSearch.trim().toLowerCase();
    if (!query) return rows;
    const visible = new Set<string>();
    Object.values(project.nodes).filter((node) => node.name.toLowerCase().includes(query)).forEach((node) => {
      let current: SceneNodeRecord | undefined = node;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = current.parentId ? project.nodes[current.parentId] : undefined;
      }
    });
    return rows.filter(({ node }) => visible.has(node.id));
  }, [collapsedIds, project, sceneSearch]);
  const sampleStatus =
    renderStatus.sampleLimit > 0
      ? `${Math.floor(Math.min(renderStatus.sampleCount, renderStatus.sampleLimit))}/${renderStatus.sampleLimit}`
      : '';

  const togglePanel = (
    panel: MutableRefObject<PanelImperativeHandle | null>,
    setCollapsed: (value: boolean) => void,
  ) => {
    if (!panel.current) return;
    if (panel.current.isCollapsed()) {
      if (window.innerWidth < 900) {
        const other = panel === leftPanelRef ? rightPanelRef : leftPanelRef;
        other.current?.collapse();
      }
      panel.current.expand();
      setCollapsed(false);
    } else {
      panel.current.collapse();
      setCollapsed(true);
    }
  };

  const toggleViewportOnly = () => {
    if (viewportOnly) {
      leftPanelRef.current?.expand();
      rightPanelRef.current?.expand();
      setLeftCollapsed(false);
      setRightCollapsed(false);
    } else {
      leftPanelRef.current?.collapse();
      rightPanelRef.current?.collapse();
      setLeftCollapsed(true);
      setRightCollapsed(true);
    }
    setViewportOnly((current) => !current);
  };

  if (!project || !catalog || !activeCamera) {
    return <div className="loading"><Box /><strong>Three Render</strong><span>{error ?? 'Preparing your workspace…'}</span>
      {error ? <button onClick={() => window.location.reload()}>Retry</button> : null}</div>;
  }

  const selectObject = (nodeId: string | null) => {
    selectNode(nodeId);
    if (nodeId) {
      setInspectorTab('object');
    }
  };

  const openEnvironmentInspector = () => {
    selectNode(ENVIRONMENT_NODE_ID);
    setInspectorTab('object');
  };

  const openCameraInspector = () => {
    selectNode(CAMERA_NODE_ID);
    setInspectorTab('camera');
  };

  const openNodeMaterial = (
    node: SceneNodeRecord,
    material: MaterialRecord,
    bindingId?: string,
  ) => {
    if (bindingId) {
      selectBinding(node.id, bindingId);
    } else {
      selectNode(node.id);
    }
    setSelectedMaterialId(material.id);
    setInspectorTab('material');
  };

  const handleTreeDrop = async (
    event: DragEvent<HTMLDivElement>,
    parentId: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedNodeId = event.dataTransfer.getData(NODE_DRAG_MIME);
    if (draggedNodeId) {
      reparentNode(draggedNodeId, parentId);
      setDropIndicator(null);
      return;
    }
    const catalogItemId = event.dataTransfer.getData(viewportDragMime);
    if (catalogItemId) {
      insertCatalogItem(catalogItemId, parentId);
      setDropIndicator(null);
      return;
    }
    if (event.dataTransfer.files.length > 0) {
      try { await importFiles(event.dataTransfer.files); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    setDropIndicator(null);
  };

  const handleEnvironmentUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try { await importFiles(files); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    openEnvironmentInspector();
  };

  const toggleCollapsed = (nodeId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const startInlineRename = (itemId: string, currentName: string) => {
    setEditingItemId(itemId);
    setEditingName(currentName);
  };

  const commitInlineRename = () => {
    const nextName = editingName.trim();
    const itemId = editingItemId;
    if (!itemId) return;
    if (itemId === CAMERA_NODE_ID) {
      if (nextName) {
        updateCamera({ name: nextName });
      }
    } else if (project.nodes[itemId] && nextName) {
      updateNode(itemId, { name: nextName });
    }
    setEditingItemId(null);
    setEditingName('');
  };

  const cancelInlineRename = () => {
    setEditingItemId(null);
    setEditingName('');
  };

  const assignMaterialToSelection = (materialId: string) => {
    if (!selectedNode || !activeBinding) return;
    assignMaterialToBinding(selectedNode.id, activeBinding.id, materialId);
    setSelectedMaterialId(materialId);
    setInspectorTab('material');
  };

  const moveNodeRelative = (
    nodeId: string,
    targetId: string | null,
    position: 'before' | 'after' | 'inside' | 'root-end',
  ) => {
    if (!project.nodes[nodeId]) return;
    if (position === 'root-end' || !targetId) {
      moveNode(nodeId, null, project.rootNodeIds.length);
      return;
    }
    if (targetId === CAMERA_NODE_ID || targetId === ENVIRONMENT_NODE_ID) {
      moveNode(nodeId, null, 0);
      return;
    }
    const targetNode = project.nodes[targetId];
    if (!targetNode) return;

    if (position === 'inside') {
      moveNode(nodeId, targetId, targetNode.children.length);
      return;
    }

    const parentId = targetNode.parentId;
    const siblings = parentId ? project.nodes[parentId].children : project.rootNodeIds;
    const targetIndex = siblings.indexOf(targetId);
    const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
    moveNode(nodeId, parentId, insertionIndex);
  };

  const handleRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const position =
      offsetY < rect.height * 0.25
        ? 'before'
        : offsetY > rect.height * 0.75
          ? 'after'
          : 'inside';
    setDropIndicator({
      targetId,
      position,
    });
    event.dataTransfer.dropEffect = 'move';
  };

  const handleRowDrop = async (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedNodeId = event.dataTransfer.getData(NODE_DRAG_MIME);
    if (draggedNodeId && dropIndicator) {
      moveNodeRelative(draggedNodeId, targetId, dropIndicator.position);
      setDropIndicator(null);
      return;
    }

    const catalogItemId = event.dataTransfer.getData(viewportDragMime);
    if (catalogItemId) {
      if (
        dropIndicator?.position === 'inside' &&
        targetId !== CAMERA_NODE_ID &&
        targetId !== ENVIRONMENT_NODE_ID
      ) {
        insertCatalogItem(catalogItemId, targetId);
      } else {
        insertCatalogItem(catalogItemId, null);
      }
    } else if (event.dataTransfer.files.length > 0) {
      try { await importFiles(event.dataTransfer.files); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    setDropIndicator(null);
  };

  const handleTreeBackgroundClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.tree__item')) return;
    selectNode(null);
    setEditingItemId(null);
    setDropIndicator(null);
  };

  const axisTarget = (target: 'center' | 'base' | 'origin') => {
    if (!selectedNode || selectedNode.locked) return;
    const pivot = target === 'origin' ? [0,0,0] as [number,number,number] : viewportCommands.current?.axisTarget(target);
    if (pivot) setPivotOffset(selectedNode.id, pivot);
  };
  const canEditAxis = selectedNode?.nodeType === 'asset' && !selectedNode.locked;

  return (
    <div className={`shell ${shelfCollapsed || viewportOnly ? 'shell--shelf-collapsed' : ''}`}>
      <EditorMenuBar name={project.name} onRename={renameProject} saveState={saveState} onExport={exportImage}
        menus={{
          File: [
            { label: 'New studio scene', action: newScene },
            { label: 'Open project…', shortcut: '⌘ O', action: () => openProjectRef.current?.click() },
            { label: 'Save project file', shortcut: '⌘ S', action: () => downloadProjectFile(project) },
            { label: 'Import models / HDRI…', action: () => importInputRef.current?.click() },
            { label: 'Export image (PNG)', action: exportImage },
            { label: 'Export scene (GLB)', action: () => { void viewportCommands.current?.exportScene().catch((cause: unknown) => setError(String(cause))); } },
          ],
          Edit: [
            { label: 'Undo', shortcut: '⌘ Z', action: undo, disabled: history.past.length === 0 },
            { label: 'Redo', shortcut: '⇧ ⌘ Z', action: redo, disabled: history.future.length === 0 },
            { label: 'Duplicate', shortcut: '⌘ D', action: duplicateSelected, disabled: !selectedNode },
            { label: 'Group selection', action: groupSelected, disabled: !selectedNode || selectedNode.locked },
            { label: 'Move to scene root', action: unparentSelected, disabled: !selectedNode?.parentId },
            { label: 'Delete', shortcut: 'Delete', action: deleteSelected, disabled: !selectedNode || selectionHasLockedNodes },
          ],
          Create: [
            ...PRIMITIVES.map((item) => ({ label: item.name, action: () => addPrimitive(item.type) })),
            { label: 'Area light', action: () => addLightNode() },
            { label: 'Null', action: addNull },
          ],
          Tools: [
            {label: axisEditMode ? 'Finish axis editing' : 'Adjust axis', shortcut:'L', action:()=>setAxisEditMode(!axisEditMode), disabled:!canEditAxis},
            {label:'Axis to object center', action:()=>axisTarget('center'), disabled:!canEditAxis},
            {label:'Axis to object base', action:()=>axisTarget('base'), disabled:!canEditAxis},
            {label:'Restore original axis', action:()=>axisTarget('origin'), disabled:!canEditAxis},
            {label:'Make editable', action:()=>selectedNode && makePrimitiveEditable(selectedNode.id), disabled:selectedAsset?.sourceKind!=='primitive' || !canEditAxis},
            {label:'Reset position, rotation and scale', action:resetSelectedTransform, disabled:!selectedNode || selectedNode.locked},
          ],
          View: [
            { label: 'Frame selection', shortcut: 'F', action: () => viewportCommands.current?.frame(false) },
            { label: 'Frame scene', shortcut: '⇧ F', action: () => viewportCommands.current?.frame(true) },
            { label: 'Toggle scene panel', action: () => togglePanel(leftPanelRef, setLeftCollapsed) },
            { label: 'Toggle inspector', action: () => togglePanel(rightPanelRef, setRightCollapsed) },
            { label: 'Toggle library', action: () => setShelfCollapsed((value) => !value) },
            { label: 'Focus viewport', action: toggleViewportOnly },
          ],
          Help: [{ label: 'Keyboard & navigation', shortcut: '?', action: () => setShowShortcuts(true) }],
        }} />
      <header className="topbar" aria-label="Editor tools">
        <div className="topbar__groups">
          <div className="topbar__group">
            <ToolbarButton icon={<Undo2 />} label="Undo" onClick={undo} disabled={history.past.length === 0} className="toolbar-icon" />
            <ToolbarButton icon={<Redo2 />} label="Redo" onClick={redo} disabled={history.future.length === 0} className="toolbar-icon" />
          </div>
          <div className="topbar__group topbar__group--tabs">
            <button
              className={transformMode === 'translate' ? 'active' : ''}
              onClick={() => setTransformMode('translate')}
              title="Move (W)"
              aria-label="Move"
              aria-pressed={transformMode === 'translate'}
            >
              <Move />
              <span>Move</span>
            </button>
            <button
              className={transformMode === 'rotate' ? 'active' : ''}
              onClick={() => setTransformMode('rotate')}
              title="Rotate (E)"
              aria-label="Rotate"
              aria-pressed={transformMode === 'rotate'}
            >
              <Rotate3D />
              <span>Rotate</span>
            </button>
            <button
              className={transformMode === 'scale' ? 'active' : ''}
              onClick={() => setTransformMode('scale')}
              title="Scale (R)"
              aria-label="Scale"
              aria-pressed={transformMode === 'scale'}
            >
              <Scaling />
              <span>Scale</span>
            </button>
          </div>
          <div className="topbar__group topbar__group--tabs">
            <button className={!axisEditMode?'active':''} aria-label="Object mode" aria-pressed={!axisEditMode}
              title="Transform the object" onClick={()=>setAxisEditMode(false)}><Box/><span>Object</span></button>
            <button className={axisEditMode?'active':''} aria-label="Axis mode" aria-pressed={axisEditMode} disabled={!canEditAxis}
              title="Adjust object axis (L)" onClick={()=>setAxisEditMode(!axisEditMode)}><Axis3D/><span>Axis</span></button>
            <ToolbarButton icon={<Focus/>} label="Center axis" disabled={!canEditAxis} className="toolbar-icon"
              onClick={()=>axisTarget('center')}/>
          </div>
          <div className="topbar__group topbar__group--tabs">
            <button
              className={snapEnabled ? 'active' : ''}
              onClick={() => setSnapEnabled(!snapEnabled)}
              title="Toggle snapping"
              aria-label="Snap"
              aria-pressed={snapEnabled}
            >
              <Magnet />
              <span>Snap</span>
            </button>
            <button
              className={transformSpace === 'world' ? 'active' : ''}
              onClick={() => setTransformSpace('world')}
              title="World transform space"
              aria-label="World"
              aria-pressed={transformSpace === 'world'}
            >
              <Globe2 />
              <span>World</span>
            </button>
            <button
              className={transformSpace === 'local' ? 'active' : ''}
              onClick={() => setTransformSpace('local')}
              aria-label="Local"
              aria-pressed={transformSpace === 'local'}
            >
              Local
            </button>
          </div>
          <div className="topbar__group create-tools">
            <ToolbarButton icon={<Box />} label="Add cube" onClick={() => addPrimitive('cube')} />
            <ToolbarButton icon={<Lightbulb />} label="Add light" onClick={() => addLightNode()} />
            <ToolbarButton icon={<Upload />} label="Import" onClick={() => importInputRef.current?.click()} />
          </div>
        </div>
        <div className="topbar__side">
          <ToolbarButton
            icon={leftCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            label="Explorer"
            className="topbar__panelControl"
            onClick={() => togglePanel(leftPanelRef, setLeftCollapsed)}
          />
          <ToolbarButton
            icon={viewportOnly ? <Minimize2 /> : <Maximize2 />}
            label="Viewport only"
            className="topbar__panelControl"
            onClick={toggleViewportOnly}
          />
          <ToolbarButton
            icon={rightCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
            label="Inspector"
            className="topbar__panelControl"
            onClick={() => togglePanel(rightPanelRef, setRightCollapsed)}
          />

        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".glb,.gltf,.hdr,.exr"
          multiple
          hidden
          onChange={(event) => {
            if (!event.target.files?.length) return;
            void importFiles(event.target.files).catch((cause: unknown) => setError(String(cause)));
            event.target.value = '';
          }}
        />
        <input
          ref={openProjectRef}
          type="file"
          accept=".json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void (async () => {
              try {
                const loaded = await readProjectFile(file);
                replaceProject(loaded);
                setCollapsedIds(new Set(Object.keys(loaded.nodes)));
                setError(null);
              } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
            })();
            event.target.value = '';
          }}
        />
        <input
          ref={environmentInputRef}
          type="file"
          accept=".hdr,.exr"
          hidden
          onChange={(event) => {
            void handleEnvironmentUpload(event.target.files);
            event.target.value = '';
          }}
        />
      </header>

      <PanelGroup orientation="horizontal" className="workspace" id="studio-workspace">
        <Panel
          id="explorer"
          panelRef={leftPanelRef}
          defaultSize="250px"
          minSize="180px"
          maxSize="460px"
          collapsible
          collapsedSize="0px"
          onResize={(size) => setLeftCollapsed(size.inPixels < 80)}
        >
          <aside className="panel panel--left">
          <div className="panel__tabs">
            <button
              className={`panel__tab ${leftPanelTab === 'outliner' ? 'active' : ''}`}
              onClick={() => setLeftPanelTab('outliner')}
            >
              Scene
            </button>
            <button
              className={`panel__tab ${leftPanelTab === 'assets' ? 'active' : ''}`}
              onClick={() => setLeftPanelTab('assets')}
            >
              Assets
            </button>
          </div>
          <div className="panel__body">
            {leftPanelTab === 'outliner' ? (
              <div className="panel__section">
                <ObjectPalette onPrimitive={addPrimitive} onNull={addNull} onLight={()=>addLightNode()} />
                <div className="panel__sectionHeader">
                  <h2><Layers3 />Scene collection</h2>
                  <div className="panel__chips">
                    <button onClick={groupSelected} disabled={!selectedNode || selectedNode.locked}>Group</button>
                    <button onClick={unparentSelected}>Root</button>
                  </div>
                </div>
                <label className="scene-search"><Search /><input aria-label="Search scene" placeholder="Search scene…" value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} /></label>
                <div
                  className="tree"
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (event.target === event.currentTarget) {
                      setDropIndicator({
                        targetId: null,
                        position: 'root-end',
                      });
                    }
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragLeave={(event) => {
                    if (event.target === event.currentTarget) {
                      setDropIndicator(null);
                    }
                  }}
                  onDrop={(event) => {
                    const draggedNodeId = event.dataTransfer.getData(NODE_DRAG_MIME);
                    if (draggedNodeId) {
                      moveNodeRelative(draggedNodeId, null, 'root-end');
                      setDropIndicator(null);
                      return;
                    }
                    void handleTreeDrop(event, null);
                  }}
                  onClick={handleTreeBackgroundClick}
                >
                  <OutlinerRow
                    id={CAMERA_NODE_ID}
                    label={activeCamera.name}
                    kind="camera"
                    depth={0}
                    selected={selectedCamera}
                    visible
                    isEditing={editingItemId === CAMERA_NODE_ID}
                    editingValue={editingName}
                    dropPosition={
                      dropIndicator?.targetId === CAMERA_NODE_ID ? dropIndicator.position : null
                    }
                    onSelect={openCameraInspector}
                    onStartRename={() => startInlineRename(CAMERA_NODE_ID, activeCamera.name)}
                    onEditingChange={setEditingName}
                    onCommitRename={commitInlineRename}
                    onCancelRename={cancelInlineRename}
                    onDragOver={(event) => handleRowDragOver(event, CAMERA_NODE_ID)}
                    onDrop={(event) => void handleRowDrop(event, CAMERA_NODE_ID)}
                  />
                  <OutlinerRow
                    id={ENVIRONMENT_NODE_ID}
                    label={environmentAsset?.name ?? 'Environment'}
                    kind="environment"
                    depth={0}
                    selected={selectedEnvironment}
                    visible={project.environment.enabled}
                    dropPosition={
                      dropIndicator?.targetId === ENVIRONMENT_NODE_ID ? dropIndicator.position : null
                    }
                    onSelect={openEnvironmentInspector}
                    onToggleVisibility={() =>
                      updateEnvironment({
                        enabled: !project.environment.enabled,
                      })
                    }
                    onDragOver={(event) => handleRowDragOver(event, ENVIRONMENT_NODE_ID)}
                    onDrop={(event) => void handleRowDrop(event, ENVIRONMENT_NODE_ID)}
                  />
                  {flattenedNodes.map(({ node, depth, hasChildren, expanded }) => {
                    const nodeMaterial = getPrimaryMaterial(project.materials, node);
                    const assetBindings =
                      node.assetId && node.nodeType === 'asset'
                        ? project.assets[node.assetId]?.meshBindings ?? []
                        : [];
                    return (
                      <div key={node.id}>
                        <OutlinerRow
                          id={node.id}
                          label={node.name}
                          kind={node.nodeType}
                          primitive={node.assetId ? project.assets[node.assetId]?.primitive : undefined}
                          depth={depth}
                          selected={selectedNodeId === node.id && !selectedBindingId}
                          visible={node.visible}
                          material={nodeMaterial}
                          hasChildren={hasChildren || assetBindings.length > 0}
                          expanded={expanded}
                          isEditing={editingItemId === node.id}
                          editingValue={editingName}
                          dropPosition={
                            dropIndicator?.targetId === node.id ? dropIndicator.position : null
                          }
                          draggable={!node.locked}
                          locked={node.locked}
                          onToggleLock={() => updateNode(node.id, { locked: !node.locked })}
                          onSelect={() => selectObject(node.id)}
                          onToggleExpand={() => toggleCollapsed(node.id)}
                          onToggleVisibility={() => toggleNodeVisibility(node.id)}
                          onOpenMaterial={(material) => openNodeMaterial(node, material)}
                          onStartRename={() => startInlineRename(node.id, node.name)}
                          onEditingChange={setEditingName}
                          onCommitRename={commitInlineRename}
                          onCancelRename={cancelInlineRename}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(NODE_DRAG_MIME, node.id);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            handleRowDragOver(event, node.id);
                          }}
                          onDrop={(event) => void handleRowDrop(event, node.id)}
                        />
                        {expanded && assetBindings.length > 0
                          ? assetBindings.map((binding) => {
                              const bindingMaterialId =
                                node.materialBindings[binding.id] ??
                                binding.defaultMaterialId ??
                                DEFAULT_DIFFUSE_MATERIAL_ID;
                              const bindingMaterial =
                                bindingMaterialId !== DEFAULT_DIFFUSE_MATERIAL_ID
                                  ? project.materials[bindingMaterialId] ?? null
                                  : null;
                              return (
                                <OutlinerRow
                                  key={`${node.id}:${binding.id}`}
                                  id={`${node.id}:${binding.id}`}
                                  label={binding.label}
                                  kind="element"
                                  depth={depth + 1}
                                  selected={
                                    selectedNodeId === node.id && selectedBindingId === binding.id
                                  }
                                  visible={node.visible}
                                  material={bindingMaterial}
                                  onSelect={() => selectBinding(node.id, binding.id)}
                                  onOpenMaterial={
                                    bindingMaterial
                                      ? () => openNodeMaterial(node, bindingMaterial, binding.id)
                                      : undefined
                                  }
                                />
                              );
                            })
                          : null}
                      </div>
                    );
                  })}
                  {dropIndicator?.position === 'root-end' ? <div className="tree__dropLine" /> : null}
                </div>
              </div>
            ) : (
              <div className="panel__section">
                <div className="panel__sectionHeader">
                  <h2>Library</h2>
                  <span className="badge">{filteredCatalog.length}</span>
                </div>
                <input
                  className="search"
                  placeholder="Search"
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                />
                <div className="assetGrid">
                  {filteredCatalog.map((item) => (
                    <AssetCard
                      key={item.id}
                      item={item}
                      onInsert={() => insertCatalogItem(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          </aside>
        </Panel>
        <PanelResizeHandle className="panelResizeHandle" />

        <Panel id="viewport" minSize="140px">
          <section className="workspace__viewport">
            <Viewport
            project={project}
            isolatedNodeName={Object.values(project.nodes).find((node) => node.isolated)?.name}
            onExitIsolation={clearIsolation}
            selectedNodeId={selectedEnvironment || selectedCamera ? null : selectedNodeId}
            axisEditMode={axisEditMode}
            transformMode={transformMode}
            transformSpace={transformSpace}
            snapEnabled={snapEnabled}
            translateSnap={translateSnap}
            rotateSnap={rotateSnap}
            scaleSnap={scaleSnap}
            sampleCount={renderStatus.sampleCount}
            sampleLimit={renderStatus.sampleLimit}
            invalidationReasons={renderStatus.invalidationReasons}
            onSelectNode={selectObject}
            onTransformChange={updateTransform}
            onDiscoveredMetadata={mergeDiscoveredMetadata}
            onRenderStatus={setRenderStatus}
            onCameraChange={syncCameraPose}
            onInsertCatalogItem={insertCatalogItem}
            onImportFiles={importFiles}
            onExportReady={(handler) => setExportImage(() => handler)}
            onToolsReady={(commands) => { viewportCommands.current = commands; }}
            onError={setError}
            onRenderModeChange={setRenderMode}
            />
          </section>
        </Panel>
        <PanelResizeHandle className="panelResizeHandle" />

        <Panel
          id="inspector"
          panelRef={rightPanelRef}
          defaultSize="300px"
          minSize="230px"
          maxSize="520px"
          collapsible
          collapsedSize="0px"
          onResize={(size) => setRightCollapsed(size.inPixels < 80)}
        >
          <aside className="panel panel--right">
          <div className="panel__tabs">
            <button
              className={`panel__tab ${inspectorTab === 'object' ? 'active' : ''}`}
              onClick={() => setInspectorTab('object')}
            >
              Object
            </button>
            <button
              className={`panel__tab ${inspectorTab === 'material' ? 'active' : ''}`}
              onClick={() => setInspectorTab('material')}
            >
              Material
            </button>
            <button
              className={`panel__tab ${inspectorTab === 'camera' ? 'active' : ''}`}
              onClick={() => setInspectorTab('camera')}
            >
              Camera
            </button>
            <button
              className={`panel__tab ${inspectorTab === 'render' ? 'active' : ''}`}
              onClick={() => setInspectorTab('render')}
            >
              Render
            </button>
          </div>
          <div className="panel__body">
            {inspectorTab === 'object' ? (
              <div className="panel__section">
                <div className="panel__sectionHeader">
                  <h2>
                    {selectedEnvironment
                      ? 'Environment'
                      : selectedNode
                        ? selectedNode.name
                        : 'Object'}
                  </h2>
                  {selectedNode ? (
                    <span className="badge">{selectedNode.nodeType}</span>
                  ) : selectedEnvironment ? (
                    <span className="badge">hdri</span>
                  ) : null}
                </div>
                {selectedEnvironment ? (
                  <EnvironmentObjectEditor
                    assetName={environmentAsset?.name ?? 'None'}
                    assets={envAssets}
                    environment={project.environment}
                    onLoadCustom={() => environmentInputRef.current?.click()}
                    onChange={(partial) => updateEnvironment(partial)}
                  />
                ) : selectedNode ? (
                  <>
                    <label>
                      Name
                      <input
                        value={selectedNode.name}
                        onChange={(event) => renameSelected(event.target.value)}
                      />
                    </label>
                    <div className="inlineControls">
                      <button onClick={toggleSelectedVisibility}>
                        {selectedNode.visible ? 'Hide' : 'Show'}
                      </button>
                      <button onClick={toggleSelectedLock}>
                        {selectedNode.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button onClick={isolateSelected} aria-pressed={selectedNode.isolated}>
                        {selectedNode.isolated ? 'Exit Isolate' : 'Isolate'}
                      </button>
                    </div>
                    {selectedAsset?.sourceKind === 'primitive' && selectedAsset.primitive ? <PrimitiveEditor
                      key={selectedNode.id} type={selectedAsset.primitive} parameters={selectedNode.primitiveParameters}
                      disabled={selectedNode.locked} onChange={parameters=>updatePrimitiveParameters(selectedNode.id,parameters)}
                      onMakeEditable={()=>makePrimitiveEditable(selectedNode.id)} /> : selectedAsset?.sourceKind === 'geometry'
                        ? <p className="fieldHint">Editable mesh · primitive parameters are baked into the geometry.</p> : null}
                    {selectedNode.nodeType === 'asset' ? <AxisEditor key={`axis-${selectedNode.id}`} node={selectedNode} active={axisEditMode}
                      onMode={setAxisEditMode} onTarget={axisTarget} onChange={pivot=>setPivotOffset(selectedNode.id,pivot)}/> : null}
                    {selectedNode.nodeType === 'light' && selectedNode.light ? (
                      <fieldset className="object-properties" aria-label="Light properties" disabled={selectedNode.locked}>
                      <LightEditor
                        light={selectedNode.light}
                        onChange={(partial) => {
                          const baseLight = selectedNode.light as LightRecord;
                          const nextType = partial.type ?? baseLight.type;
                          const nextLight: LightRecord =
                            nextType !== baseLight.type
                              ? {
                                  ...createLightRecord(nextType),
                                  color: partial.color ?? baseLight.color,
                                  intensity: partial.intensity ?? createLightRecord(nextType).intensity,
                                  showGizmo: partial.showGizmo ?? baseLight.showGizmo,
                                }
                              : {
                                  ...baseLight,
                                  ...partial,
                                };
                          updateNode(selectedNode.id, {
                            light: nextLight,
                            transform:
                              nextLight.type === 'sun'
                                ? {
                                    ...selectedNode.transform,
                                    position: [0, 0, 0],
                                  }
                                : selectedNode.transform,
                          });
                        }}
                      />
                      </fieldset>
                    ) : null}
                    {!axisEditMode ? <TransformEditor
                      node={transformSpace === 'world' ? { ...selectedNode, transform: worldTransformForNode(project, selectedNode.id) } : selectedNode}
                      sections={
                        selectedNode.nodeType === 'light' && selectedNode.light?.type === 'sun'
                          ? ['rotation']
                          : selectedNode.nodeType === 'light'
                            ? ['position', 'rotation']
                            : ['position', 'rotation', 'scale']
                      }
                      onChange={(axis, section, value) => {
                        if (selectedNode.locked) return;
                        const transform = transformSpace === 'world' ? worldTransformForNode(project, selectedNode.id) : selectedNode.transform;
                        const current = transform[section];
                        const next = [...current] as [number, number, number];
                        next[axis] = value;
                        updateTransform(
                          selectedNode.id,
                          transformSpace === 'world'
                            ? localTransformFromWorld(project, selectedNode.id, { ...transform, [section]: next })
                            : { [section]: next },
                          true,
                        );
                      }}
                    /> : null}
                    <div className="inlineControls">
                      <button onClick={duplicateSelected}>Duplicate</button>
                      <button onClick={resetSelectedTransform}>Reset PSR</button>
                      <button onClick={deleteSelected} disabled={selectionHasLockedNodes}
                        title={selectionHasLockedNodes ? 'Unlock this object and its descendants before deleting' : 'Delete selected object'}>Delete</button>
                    </div>
                    {selectedBindings.length > 0 ? <section className="object-materials">
                      <div className="panel__sectionHeader"><h2>Material assignment</h2><button onClick={() => setInspectorTab('material')}>Edit</button></div>
                      <label>Element<select aria-label="Object material element" value={activeBinding?.id ?? ''}
                        onChange={(event) => selectBinding(selectedNode.id, event.target.value)}>
                        {!activeBinding ? <option value="">Choose an element…</option> : null}
                        {selectedBindings.map((binding) => <option key={binding.id} value={binding.id}>{binding.label}</option>)}
                      </select></label>
                      {activeBinding ? <label>Material<select aria-label="Assigned material" disabled={selectedNode.locked} value={effectiveMaterialId ?? DEFAULT_DIFFUSE_MATERIAL_ID}
                        onChange={(event) => assignMaterialToSelection(event.target.value)}>
                        <option value={DEFAULT_DIFFUSE_MATERIAL_ID}>Default diffuse</option>
                        {materialOptions.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
                      </select></label> : <p className="fieldHint">Select a mesh element to assign a material.</p>}
                    </section> : null}

                  </>
                ) : (
                  <p className="muted">Select an object, light, or environment.</p>
                )}
              </div>
            ) : null}

            {inspectorTab === 'material' ? (
              <div className="panel__section">
                <div className="panel__sectionHeader">
                  <h2>Material</h2>
                  <div className="panel__chips">
                    <button onClick={deleteUnassignedMaterials} disabled={unusedMaterialCount === 0}>
                      Delete Unused
                    </button>
                    {selectedMaterial ? (
                      <>
                        <button onClick={() => duplicateMaterial(selectedMaterial.id)}>Duplicate</button>
                        <button onClick={() => deleteMaterial(selectedMaterial.id)} disabled={!materialEditable}
                          title={`Delete material and reset ${materialUsages.length} assigned elements to default diffuse`}>Delete</button>
                      </>
                    ) : null}
                  </div>
                </div>
                {selectedNode ? (
                  <div className="transformGroup">
                    <span className="transformGroup__title">SELECTION</span>
                    <span className="muted">
                      {selectedNode.name}
                      {activeBinding ? ` / ${activeBinding.label}` : ''}
                    </span>
                    {selectedBindings.length > 1 && !selectedBinding ? (
                      <div className="materialElementList">
                        {selectedBindings.map((binding) => (
                          <button
                            key={binding.id}
                            className="materialElementButton"
                            onClick={() => selectBinding(selectedNode.id, binding.id)}
                          >
                            {binding.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {activeBinding ? (
                      <div className="inlineControls">
                        <button disabled={selectedNode.locked} onClick={() => assignMaterialToSelection(DEFAULT_DIFFUSE_MATERIAL_ID)}>
                          Clear
                        </button>
                        <span className="muted">
                          {effectiveMaterialId === DEFAULT_DIFFUSE_MATERIAL_ID
                            ? 'Default diffuse'
                            : selectedMaterial?.name ?? 'None'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted">Select an object or object element in the outliner.</p>
                )}
                <label>Material<select aria-label="Material library assignment"
                  disabled={!!activeBinding && selectedNode?.locked}
                  value={effectiveMaterialId ?? DEFAULT_DIFFUSE_MATERIAL_ID}
                  onChange={(event) => {
                    if (activeBinding) assignMaterialToSelection(event.target.value);
                    else setSelectedMaterialId(event.target.value);
                  }}>
                  <option value={DEFAULT_DIFFUSE_MATERIAL_ID}>Default diffuse</option>
                  {materialOptions.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
                </select></label>
                {selectedMaterial ? (
                  <>
                    <MaterialUsagePanel usages={materialUsages} sharedEditing={sharedMaterialEditing}
                      canMakeUnique={!!selectedNode && !!activeBinding && !selectedNode.locked}
                      onMakeUnique={() => { if (selectedNode && activeBinding) makeMaterialUnique(selectedNode.id, activeBinding.id); }}
                      onSharedEditing={() => setSharedMaterialEditing(sharedMaterialEditing ? null : selectedMaterial.id)}
                      onSelect={selectBinding} />
                    <fieldset className="material-properties" aria-label="Material properties" disabled={!materialEditable}>
                      <MaterialEditor
                        key={selectedMaterial.id}
                        material={selectedMaterial}
                        onChange={(partial) => updateMaterial(selectedMaterial.id, partial)}
                      />
                    </fieldset>
                  </>
                ) : effectiveMaterialId === DEFAULT_DIFFUSE_MATERIAL_ID ? (
                  <p className="muted">No material assigned. The object uses the default gray diffuse material.</p>
                ) : (
                  <p className="muted">Select an object element to edit its material.</p>
                )}
              </div>
            ) : null}

            {inspectorTab === 'camera' ? (
              <div className="panel__section">
                <div className="panel__sectionHeader">
                  <h2>Camera</h2>
                  <span className="badge">{activeCamera.projection}</span>
                </div>
                <label>
                  Projection
                  <select
                    value={activeCamera.projection}
                    onChange={(event) =>
                      updateCamera({
                        projection: event.target.value as typeof activeCamera.projection,
                      })
                    }
                  >
                    <option value="perspective">Perspective</option>
                    <option value="orthographic">Orthographic</option>
                  </select>
                </label>
                <label>
                  Focal Length
                  <input
                    type="range"
                    min="18"
                    max="120"
                    value={activeCamera.focalLength}
                    onChange={(event) =>
                      updateCamera({
                        focalLength: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Near Clip (cm)
                  <NumericScrubInput
                    value={activeCamera.near}
                    min={0.001}
                    max={Math.max(0.01, activeCamera.far - 0.01)}
                    step={0.001}
                    displayScale={100}
                    onChange={(value) =>
                      updateCamera({
                        near: value,
                      })
                    }
                  />
                </label>
                <label>
                  Far Clip (cm)
                  <NumericScrubInput
                    value={activeCamera.far}
                    min={Math.max(0.02, activeCamera.near + 0.01)}
                    step={0.01}
                    displayScale={100}
                    onChange={(value) =>
                      updateCamera({
                        far: value,
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            {inspectorTab === 'render' ? (
              <div className="panel__section">
                <div className="panel__sectionHeader">
                  <h2>Render</h2>
                  <span className="badge">{formatMode(project.renderer.mode)}</span>
                </div>
                <label>
                  Exposure
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={project.renderer.exposure}
                    onChange={(event) =>
                      updateRendererSettings({
                        exposure: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={project.renderer.transparentBackground}
                    onChange={(event) =>
                      updateRendererSettings({
                        transparentBackground: event.target.checked,
                      })
                    }
                  />
                  Transparent background
                </label>
                <RenderQualityEditor
                  title="Live"
                  settings={project.renderer.live}
                  onChange={(nextSettings) =>
                    updateRendererSettings({
                      live: nextSettings,
                    })
                  }
                />
                <RenderQualityEditor
                  title="Render"
                  settings={project.renderer.render}
                  onChange={(nextSettings) =>
                    updateRendererSettings({
                      render: nextSettings,
                    })
                  }
                />
                <div className="transformGroup">
                  <span className="transformGroup__title">Postprocess</span>
                  <label className="checkbox">
                    <input type="checkbox" checked={project.renderer.denoise.enabled}
                      onChange={event => updateRendererSettings({ denoise: {
                        ...project.renderer.denoise, enabled: event.target.checked, applyToLive: true,
                      } })} />
                    Denoise
                  </label>
                  <p className="fieldHint">GPU edge-preserving filter for Live and Render. PNG exports include the displayed result. Toggle off to view the original samples.</p>
                </div>
                {renderStatus.warning ? <p className="muted">{renderStatus.warning}</p> : null}
              </div>
            ) : null}
          </div>
          </aside>
        </Panel>
      </PanelGroup>
      <AssetShelf items={catalog.items} materials={materialOptions} selectedMaterialId={effectiveMaterialId}
        onMaterial={(materialId) => {
          if (activeBinding) assignMaterialToSelection(materialId);
          else { setSelectedMaterialId(materialId); setInspectorTab('material'); }
        }} onPreset={createMaterialFromPreset} onInsert={insertCatalogItem} onPrimitive={addPrimitive}
        onImport={() => importInputRef.current?.click()} collapsed={shelfCollapsed || viewportOnly}
        onToggle={() => { if (viewportOnly) toggleViewportOnly(); setShelfCollapsed((value) => !value); }} />
      <footer className="statusbar">
        <span className={`status-dot ${renderStatus.warning ? 'status-dot--warning' : ''}`} />
        <span>{renderStatus.warning ? 'Renderer warning' : axisEditMode ? 'Axis editing' : 'Ready'}</span>
        <span className="status-selection">{selectedNode ? `Selected: ${selectedNode.name}` : selectedCamera ? activeCamera.name : selectedEnvironment ? 'Environment' : 'No selection'}</span>
        <span className="statusbar__spacer" />
        <span>{Object.keys(project.nodes).length} objects</span>
        <span>WebGL · {formatMode(project.renderer.mode)}</span>
        {sampleStatus ? <span>{sampleStatus} samples</span> : null}
        <span className="status-local">Local project</span>
      </footer>
      {error || renderStatus.warning ? <div className="error-notice" role="alert">
        <span>{error ?? renderStatus.warning}</span>
        {error ? <button aria-label="Dismiss error" onClick={() => setError(null)}>Dismiss</button> : null}
      </div> : null}
      {showShortcuts ? <ShortcutDialog onClose={() => setShowShortcuts(false)} /> : null}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  className = '',
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`toolButton ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AssetCard({
  item,
  onInsert,
}: {
  item: CatalogItem;
  onInsert: () => void;
}) {
  return (
    <button
      className="assetCard"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(viewportDragMime, item.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onInsert}
    >
      <img src={publicAssetUrl(item.thumbnail)} alt={item.name} />
      <strong>{item.name}</strong>
      <span>{item.category}</span>
    </button>
  );
}

function OutlinerRow({
  id,
  label,
  kind,
  primitive,
  depth,
  selected,
  visible,
  material,
  hasChildren = false,
  expanded = true,
  isEditing = false,
  editingValue = '',
  dropPosition = null,
  draggable = false,
  onSelect,
  onToggleExpand,
  onToggleVisibility,
  locked,
  onToggleLock,
  onOpenMaterial,
  onStartRename,
  onEditingChange,
  onCommitRename,
  onCancelRename,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  id: string;
  label: string;
  kind: 'asset' | 'group' | 'light' | 'environment' | 'camera' | 'element';
  primitive?: import('./core/types').PrimitiveType;
  depth: number;
  selected: boolean;
  visible: boolean;
  material?: MaterialRecord | null;
  hasChildren?: boolean;
  expanded?: boolean;
  isEditing?: boolean;
  editingValue?: string;
  dropPosition?: 'before' | 'after' | 'inside' | 'root-end' | null;
  draggable?: boolean;
  onSelect: () => void;
  onToggleExpand?: () => void;
  onToggleVisibility?: () => void;
  locked?: boolean;
  onToggleLock?: () => void;
  onOpenMaterial?: (material: MaterialRecord) => void;
  onStartRename?: () => void;
  onEditingChange?: (value: string) => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`tree__item ${selected ? 'is-selected' : ''}`}
      data-drop-position={dropPosition ?? undefined}
      draggable={draggable}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="tree__main">
        <span className="tree__guides" aria-hidden="true">
          {Array.from({ length: depth }).map((_, index) => (
            <span key={`${id}-guide-${index}`} className="tree__guide" />
          ))}
          {depth > 0 ? <span className="tree__branch" /> : null}
        </span>
        {hasChildren ? (
          <button
            className="tree__expander"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.();
            }}
            aria-label={expanded ? 'Collapse node' : 'Expand node'}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : (
          <span className="tree__branchSpacer" />
        )}
        <span className={`tree__type tree__type--${kind}`} title={primitive ?? kindLabel(kind)}>{primitive ? <PrimitiveIcon type={primitive}/> : kind === 'camera' ? <Camera /> : kind === 'environment' ? <Globe2 /> : kind === 'light' ? <Lightbulb /> : kind === 'group' ? <Folder /> : kind === 'element' ? <Layers3 /> : <Box />}</span>
        {isEditing ? (
          <input
            className="tree__nameInput"
            value={editingValue}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onEditingChange?.(event.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onCommitRename?.();
              }
              if (event.key === 'Escape') {
                onCancelRename?.();
              }
            }}
          />
        ) : (
          <button
            className="tree__name"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onStartRename?.();
            }}
          >
            {label}
          </button>
        )}
      </div>
      <div className="tree__actions">
        {onToggleLock ? <button className="iconButton tree-lock" title={locked ? 'Unlock object' : 'Lock object'}
          aria-label={locked ? 'Unlock object' : 'Lock object'} onClick={(event) => { event.stopPropagation(); onToggleLock(); }}>
          {locked ? <Lock /> : <Unlock />}
        </button> : null}
        {material && onOpenMaterial ? (
          <MaterialDotButton material={material} onClick={() => onOpenMaterial(material)} />
        ) : (
          <span className="tree__actionSpacer" />
        )}
        {onToggleVisibility ? (
          <button
            className="iconButton"
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisibility();
            }}
            aria-label={visible ? 'Hide object' : 'Show object'}
          >
            <EyeIcon visible={visible} />
          </button>
        ) : (
          <span className="tree__actionSpacer" />
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: 'asset' | 'group' | 'light' | 'environment' | 'camera' | 'element'): string {
  if (kind === 'group') return 'GRP';
  if (kind === 'light') return 'LGT';
  if (kind === 'environment') return 'ENV';
  if (kind === 'camera') return 'CAM';
  if (kind === 'element') return 'ELM';
  return 'OBJ';
}

function MaterialDotButton({
  material,
  onClick,
}: {
  material: MaterialRecord;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className="materialDot"
      style={{ '--swatch': material.color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Edit ${material.name}`}
    >
      <span className="materialDot__fill" />
      {hovered ? (
        <span className="materialDot__preview">
          <span className="materialDot__previewSwatch" />
          <span>{material.name}</span>
        </span>
      ) : null}
    </button>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12 18.1 17.5 12 17.5 2.5 12 2.5 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" opacity={visible ? 0.9 : 0.3} />
      {!visible ? (
        <path
          d="M4 19 20 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function EnvironmentObjectEditor({
  assetName,
  assets,
  environment,
  onLoadCustom,
  onChange,
}: {
  assetName: string;
  assets: Array<{ id: string; name: string }>;
  environment: EnvironmentEditorState;
  onLoadCustom: () => void;
  onChange: (partial: Partial<EnvironmentEditorState>) => void;
}) {
  return (
    <>
      <div className="inlineControls">
        <button onClick={onLoadCustom}>Load HDRI</button>
      </div>
      <label>
        Active HDRI
        <select
          value={environment.assetId ?? ''}
          onChange={(event) =>
            onChange({
              assetId: event.target.value || undefined,
              enabled: event.target.value ? environment.enabled : false,
            })
          }
        >
          <option value="">None</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <div className="transformGroup">
        <span className="transformGroup__title">{assetName}</span>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={environment.enabled}
            onChange={(event) =>
              onChange({
                enabled: event.target.checked,
              })
            }
          />
          Enabled
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={environment.backgroundVisible}
            onChange={(event) =>
              onChange({
                backgroundVisible: event.target.checked,
              })
            }
          />
          Show background
        </label>
        <label>
          Intensity
          <input
            type="range"
            min="0"
            max="6"
            step="0.05"
            value={environment.intensity}
            onChange={(event) =>
              onChange({
                intensity: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Rotation
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={environment.rotation}
            onChange={(event) =>
              onChange({
                rotation: Number(event.target.value),
              })
            }
          />
        </label>
      </div>
    </>
  );
}

interface EnvironmentEditorState {
    assetId?: string;
    enabled: boolean;
    rotation: number;
    intensity: number;
    backgroundVisible: boolean;
}

function TransformEditor({
  node,
  sections = ['position', 'rotation', 'scale'],
  onChange,
}: {
  node: SceneNodeRecord;
  sections?: Array<'position' | 'rotation' | 'scale'>;
  onChange: (
    axis: number,
    section: 'position' | 'rotation' | 'scale',
    value: number,
  ) => void;
}) {
  const labels = ['X', 'Y', 'Z'];
  return (
    <div className="stack">
      {sections.map((section) => (
        <div key={section} className="transformGroup">
          <span className="transformGroup__title">{section === 'rotation' ? 'ROTATION (°)' : section === 'position' ? 'POSITION (cm)' : 'SCALE'}</span>
          <div className="transformGroup__grid">
            {labels.map((label, axis) => (
              <label key={`${section}-${label}`}>
                <span className={`axis-label axis-label--${label.toLowerCase()}`}>{label}</span>
                <NumericScrubInput
                  ariaLabel={`${section === 'position' ? 'Position' : section === 'rotation' ? 'Rotation' : 'Scale'} ${label}${section === 'position' ? ' (cm)' : section === 'rotation' ? ' (degrees)' : ''}`}
                  value={node.transform[section][axis]}
                  disabled={node.locked}
                  defaultValue={section === 'scale' ? 1 : 0}
                  step={section === 'rotation' ? 0.01 : section === 'position' ? 0.001 : 0.01}
                  displayScale={section === 'position' ? 100 : section === 'rotation' ? 180 / Math.PI : 1}
                  onChange={(value) => onChange(axis, section, value)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LightEditor({
  light,
  onChange,
}: {
  light: LightRecord;
  onChange: (partial: Partial<LightRecord>) => void;
}) {
  const isArea = light.type === 'area';
  const isSpot = light.type === 'spot';
  const isPoint = light.type === 'point';
  const isSun = light.type === 'sun';
  return (
    <div className="transformGroup">
      <span className="transformGroup__title">LIGHT</span>
      <div className="transformGroup__grid transformGroup__grid--two">
        <label>
          Type
          <select
            value={light.type}
            onChange={(event) =>
              onChange({
                type: event.target.value as LightType,
              })
            }
          >
            <option value="area">Area</option>
            <option value="spot">Spot</option>
            <option value="point">Point</option>
            <option value="sun">Sun</option>
          </select>
        </label>
        {isArea ? (
          <label>
            Shape
            <select
              aria-label="Area light shape"
              value={light.shape}
              onChange={(event) =>
                onChange({
                  shape: event.target.value as LightRecord['shape'],
                })
              }
            >
              <option value="rectangle">Rectangle</option>
              <option value="circle">Circle</option>
            </select>
          </label>
        ) : (
          <div />
        )}
      </div>
      <div className="transformGroup__grid transformGroup__grid--two">
        <label>
          Color
          <input
            type="color"
            value={light.color}
            onChange={(event) =>
              onChange({
                color: event.target.value,
              })
            }
          />
        </label>
        <label>
          Intensity
          <NumericScrubInput
            value={light.intensity}
            min={0}
            step={0.1}
            onChange={(value) =>
              onChange({
                intensity: value,
              })
            }
          />
        </label>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={light.showGizmo}
          onChange={(event) =>
            onChange({
              showGizmo: event.target.checked,
            })
          }
        />
        Show light in scene
      </label>
      {isArea ? (
        <>
          <div className="transformGroup__grid transformGroup__grid--two">
            <label>
              X Size (cm)
              <NumericScrubInput
                value={light.width}
                min={0.0005}
                step={0.001}
                displayScale={100}
                onChange={(value) =>
                  onChange({
                    width: value,
                  })
                }
              />
            </label>
            <label>
              Y Size (cm)
              <NumericScrubInput
                value={light.height}
                min={0.0005}
                step={0.001}
                displayScale={100}
                onChange={(value) =>
                  onChange({
                    height: value,
                  })
                }
              />
            </label>
          </div>
          <div className="area-shadow-controls">
            <span className="transformGroup__title">Area shadows</span>
            <label><span className="rangeLabel">Shadow spread<output>{(light.shadowSpread ?? 1).toFixed(2)}</output></span>
              <input type="range" aria-label="Shadow spread" min="0" max="1" step="0.01" value={light.shadowSpread ?? 1}
                onPointerDown={()=>useEditorStore.getState().beginNumericEdit()}
                onPointerUp={()=>useEditorStore.getState().endNumericEdit()}
                onPointerCancel={()=>useEditorStore.getState().endNumericEdit(true)}
                onBlur={()=>useEditorStore.getState().endNumericEdit()}
                onChange={event=>onChange({shadowSpread:Number(event.target.value)})}/>
            </label>
            <div className="shadow-spread-labels"><span>0 · Parallel / shaped</span><span>1 · Wide / soft</span></div>
            <NumericMaterialField label="Spread value" value={light.shadowSpread ?? 1} min={0} max={1} step={.01}
              onChange={shadowSpread=>onChange({shadowSpread})}/>
            <p className="fieldHint">Fixed X/Y aperture. At 0, parallel rays project the rectangle or disc with hard shadows. At 1, broad emission gives soft shadows. Emitted power is preserved. Use Live or Render; realtime does not show this beam control.</p>
          </div>
        </>
      ) : null}
      {isSpot ? (
        <div className="transformGroup__grid transformGroup__grid--two">
          <label>
            Radius (cm)
            <NumericScrubInput
              value={light.radius}
              min={0}
              step={0.001}
              displayScale={100}
              onChange={(value) =>
                onChange({
                  radius: value,
                })
              }
            />
          </label>
          <label>
            Angle
            <NumericScrubInput
              value={light.angle}
              min={1}
              max={85}
              step={0.1}
              onChange={(value) =>
                onChange({
                  angle: value,
                })
              }
            />
          </label>
          <label>
            Penumbra
            <NumericScrubInput
              value={light.penumbra}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                onChange({
                  penumbra: value,
                })
              }
            />
          </label>
          <label>
            Distance (cm)
            <NumericScrubInput
              value={light.distance}
              min={0}
              step={0.01}
              displayScale={100}
              onChange={(value) =>
                onChange({
                  distance: value,
                })
              }
            />
          </label>
          <label>
            Decay
            <NumericScrubInput
              value={light.decay}
              min={0}
              step={0.1}
              onChange={(value) =>
                onChange({
                  decay: value,
                })
              }
            />
          </label>
        </div>
      ) : null}
      {isPoint ? (
        <div className="transformGroup__grid transformGroup__grid--two">
          <label>
            Distance (cm)
            <NumericScrubInput
              value={light.distance}
              min={0}
              step={0.01}
              displayScale={100}
              onChange={(value) =>
                onChange({
                  distance: value,
                })
              }
            />
          </label>
          <label>
            Decay
            <NumericScrubInput
              value={light.decay}
              min={0}
              step={0.1}
              onChange={(value) =>
                onChange({
                  decay: value,
                })
              }
            />
          </label>
        </div>
      ) : null}
      {isSun ? (
        <div className="transformGroup__grid">
          <label>
            Angular Diameter (deg)
            <NumericScrubInput
              value={light.sunAngle}
              min={0}
              max={10}
              step={0.01}
              onChange={(value) =>
                onChange({
                  sunAngle: value,
                })
              }
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function MaterialEditor({
  material,
  onChange,
}: {
  material: MaterialRecord;
  onChange: (partial: Partial<MaterialRecord>) => void;
}) {
  return (
    <div className="materialEditor">
      <MaterialFoldout title="Surface" open>
        <label>
          Name
          <input value={material.name} onChange={(event) => onChange({ name: event.target.value })} />
        </label>
        <div className="transformGroup__grid transformGroup__grid--two">
          <label>Base<input type="color" value={material.color} onChange={(event) => onChange({ color: event.target.value })} /></label>
          <NumericMaterialField label="Roughness" value={material.roughness} min={0} max={1} step={0.01} onChange={(value) => onChange({ roughness: value })} />
          <NumericMaterialField label="Metalness" value={material.metalness} min={0} max={1} step={0.01} onChange={(value) => onChange({ metalness: value })} />
          <NumericMaterialField label="Specular" value={material.specularIntensity} min={0} max={1} step={0.01} onChange={(value) => onChange({ specularIntensity: value })} />
          <label>Specular Color<input type="color" value={material.specularColor} onChange={(event) => onChange({ specularColor: event.target.value })} /></label>
          <NumericMaterialField label="Opacity" value={material.opacity} min={0} max={1} step={0.01} onChange={(value) => onChange({ opacity: value })} />
        </div>
      </MaterialFoldout>

      <MaterialFoldout title="Transmission" open={material.transmission > 0.001 || material.dispersion > 0.001} accent={material.dispersion > 0.001}>
        <label className="checkbox"><input type="checkbox" checked={material.thinWalled ?? false} onChange={event => onChange({ thinWalled: event.target.checked })} />Thin walled (single surface)</label>
        <div className="transformGroup__grid transformGroup__grid--two">
          <NumericMaterialField label="Transmission" value={material.transmission} min={0} max={1} step={0.01} onChange={(value) => onChange({ transmission: value })} />
          <NumericMaterialField label="IOR" value={material.ior} min={1} max={2.5} step={0.01} onChange={(value) => onChange({ ior: value })} />
          <NumericMaterialField label="Thickness (cm)" value={material.thickness} min={0} max={10} step={0.001} displayScale={100} onChange={(value) => onChange({ thickness: value })} />
          <NumericMaterialField label="Absorption (cm)" value={material.attenuationDistance} min={0} max={1000} step={0.01} displayScale={100} onChange={(value) => onChange({ attenuationDistance: value })} />
          <label>Absorption Color<input type="color" value={material.attenuationColor} onChange={(event) => onChange({ attenuationColor: event.target.value })} /></label>
          <NumericMaterialField label="Dispersion" value={material.dispersion} min={0} max={1} step={0.001} onChange={(value) => onChange({ dispersion: value })} />
          <NumericMaterialField label="Abbe number" value={material.dispersion > 0 ? dispersionToAbbe(material.dispersion) : 0} min={0} step={1} onChange={(value) => onChange({ dispersion: abbeToDispersion(value) })} />
        </div>
        <p className="fieldHint fieldHint--spectral">Dispersion or Abbe 0 is off. Abbe 20 and above: lower values give stronger color separation. Live and Render trace three wavelengths through the actual mesh; use 128+ samples and curved or prism-shaped glass. Realtime is a screen-space preview.</p>
        <p className="fieldHint">Thickness controls the realtime preview distance. Live and Render use the object's modeled thickness. Enable Thin walled only for single surfaces; solid glass needs a closed mesh. Absorption 0 disables absorption; white absorption color keeps clear glass clear.</p>
      </MaterialFoldout>

      <MaterialFoldout title="Coat & Sheen">
        <div className="transformGroup__grid transformGroup__grid--two">
          <NumericMaterialField label="Clearcoat" value={material.clearcoat} min={0} max={1} step={0.01} onChange={(value) => onChange({ clearcoat: value })} />
          <NumericMaterialField label="Coat Roughness" value={material.clearcoatRoughness} min={0} max={1} step={0.01} onChange={(value) => onChange({ clearcoatRoughness: value })} />
          <NumericMaterialField label="Sheen" value={material.sheen} min={0} max={1} step={0.01} onChange={(value) => onChange({ sheen: value })} />
          <label>Sheen Color<input type="color" value={material.sheenColor} onChange={(event) => onChange({ sheenColor: event.target.value })} /></label>
          <NumericMaterialField label="Sheen Roughness" value={material.sheenRoughness} min={0} max={1} step={0.01} onChange={(value) => onChange({ sheenRoughness: value })} />
        </div>
      </MaterialFoldout>

      <MaterialFoldout title="Iridescence">
        <div className="transformGroup__grid transformGroup__grid--two">
          <NumericMaterialField label="Iridescence" value={material.iridescence} min={0} max={1} step={0.01} onChange={(value) => onChange({ iridescence: value })} />
          <NumericMaterialField label="Film IOR" value={material.iridescenceIOR} min={1} max={2.5} step={0.01} onChange={(value) => onChange({ iridescenceIOR: value })} />
          <NumericMaterialField label="Film Min (nm)" value={material.iridescenceThicknessMin} min={0} max={2000} step={1} onChange={(value) => onChange({ iridescenceThicknessMin: value })} />
          <NumericMaterialField label="Film Max (nm)" value={material.iridescenceThicknessMax} min={0} max={2000} step={1} onChange={(value) => onChange({ iridescenceThicknessMax: value })} />
        </div>
      </MaterialFoldout>

      <MaterialFoldout title="Emission & Advanced">
        <div className="transformGroup__grid transformGroup__grid--two">
          <NumericMaterialField label="Emission" value={material.emissiveIntensity} min={0} step={0.01} onChange={(value) => onChange({ emissiveIntensity: value })} />
          <label>Emission Color<input type="color" value={material.emissive} onChange={(event) => onChange({ emissive: event.target.value })} /></label>
          <NumericMaterialField label="Anisotropy" value={material.anisotropy} min={0} max={1} step={0.01} onChange={(value) => onChange({ anisotropy: value })} />
          <NumericMaterialField label="Anisotropy Rot." value={material.anisotropyRotation} min={0} max={6.283185307179586} step={0.01} onChange={(value) => onChange({ anisotropyRotation: value })} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={material.transparent} onChange={(event) => onChange({ transparent: event.target.checked })} />
          Transparent raster preview
        </label>
      </MaterialFoldout>
    </div>
  );
}

function MaterialFoldout({
  title,
  open = false,
  accent = false,
  children,
}: {
  title: string;
  open?: boolean;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={`materialFoldout ${accent ? 'materialFoldout--accent' : ''}`} open={open}>
      <summary>{title}</summary>
      <div className="materialFoldout__body">{children}</div>
    </details>
  );
}

function NumericMaterialField({
  label,
  value,
  min,
  max,
  step,
  displayScale = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  displayScale?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <NumericScrubInput
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        displayScale={displayScale}
        onChange={onChange}
      />
    </label>
  );
}

function RenderQualityEditor({
  title,
  settings,
  onChange,
}: {
  title: string;
  settings: RenderQualitySettings;
  onChange: (nextSettings: RenderQualitySettings) => void;
}) {
  return (
    <div className="transformGroup">
      <span className="transformGroup__title">{title}</span>
      <label>
        <span className="rangeLabel">
          Bounces
          <output>{settings.bounces}</output>
        </span>
        <input
          type="range"
          min="1"
          max="16"
          value={settings.bounces}
          onChange={(event) =>
            onChange({
              ...settings,
              bounces: Number(event.target.value),
            })
          }
        />
      </label>
      <label>
        <span className="rangeLabel">Refraction depth<output>{settings.transmissionBounces ?? 16}</output></span>
        <input aria-label={`${title} refraction depth`} type="range" min="1" max="64"
          value={settings.transmissionBounces ?? 16}
          onChange={event => onChange({ ...settings, transmissionBounces: Number(event.target.value) })} />
      </label>
      <label>
        <span className="rangeLabel">
          Scale
          <output>{settings.renderScale.toFixed(2)}x</output>
        </span>
        <input
          type="range"
          min="0.2"
          max="1"
          step="0.05"
          value={settings.renderScale}
          onChange={(event) =>
            onChange({
              ...settings,
              renderScale: Number(event.target.value),
            })
          }
        />
      </label>
      <label>
        <span className="rangeLabel">
          Tiles
          <output>{settings.tiles}x{settings.tiles}</output>
        </span>
        <input
          type="range"
          min="1"
          max="6"
          step="1"
          value={settings.tiles}
          onChange={(event) =>
            onChange({
              ...settings,
              tiles: Number(event.target.value),
            })
          }
        />
      </label>
      <label>
        Max Steps
        <input
          type="number"
          min="1"
          max="2048"
          step="1"
          value={settings.sampleLimit}
          onChange={(event) =>
            onChange({
              ...settings,
              sampleLimit: Number(event.target.value),
            })
          }
        />
      </label>
    </div>
  );
}
