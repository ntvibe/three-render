import { useEffect, useRef, useState } from 'react';
import { Focus, Grid3X3, Mouse, Scan, Sparkles } from '../icons';
import type {
  ProjectDocument,
  RenderStatus,
  RenderMode,
  TransformMode,
  TransformSpace,
} from '../core/types';
import { EditorEngine } from '../engine/EditorEngine';

interface ViewportProps {
  project: ProjectDocument;
  selectedNodeId: string | null;
  transformMode: TransformMode;
  axisEditMode?: boolean;
  transformSpace: TransformSpace;
  snapEnabled: boolean;
  translateSnap: number;
  rotateSnap: number;
  scaleSnap: number;
  sampleCount: number;
  sampleLimit: number;
  invalidationReasons: string[];
  onSelectNode: (nodeId: string | null) => void;
  onTransformChange: (
    nodeId: string,
    transform: ProjectDocument['nodes'][string]['transform'],
    recordHistory: boolean,
  ) => void;
  onDiscoveredMetadata: (payload: {
    assetId: string;
    meshBindings: ProjectDocument['assets'][string]['meshBindings'];
    materials: ProjectDocument['materials'][string][];
  }) => void;
  onRenderStatus: (status: Partial<RenderStatus>) => void;
  onCameraChange: (payload: {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
  }) => void;
  onInsertCatalogItem: (catalogItemId: string) => void;
  onImportFiles: (files: FileList | File[]) => Promise<void>;
  onExportReady: (handler: () => void) => void;
  onToolsReady: (commands: ViewportCommands) => void;
  onError: (message: string) => void;
  onRenderModeChange: (mode: RenderMode) => void;
  isolatedNodeName?: string;
  onExitIsolation: () => void;
}

export interface ViewportCommands {
  axisTarget: (target: 'center' | 'base' | 'origin') => import('../core/types').Vec3Tuple | null;
  frame: (all: boolean) => void;
  exportScene: () => Promise<void>;
}

const CATALOG_MIME = 'application/x-studio-catalog-item';

export function Viewport(props: ViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);
  const [view, setView] = useState('perspective');

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new EditorEngine(
      canvasRef.current,
      {
        onSelectNode: props.onSelectNode,
        onTransformChange: props.onTransformChange,
        onDiscoveredMetadata: props.onDiscoveredMetadata,
        onRenderStatus: props.onRenderStatus,
        onCameraChange: props.onCameraChange,
      },
    );
    engineRef.current = engine;
    engine.setGridVisible(false);
    props.onExportReady(() => engine.exportImage());
    props.onToolsReady({ frame: (all) => engine.frameSelection(all), exportScene: () => engine.exportScene(), axisTarget: target => engine.getAxisTarget(target) });
    window.addEventListener('resize', engine.handleResize);
    const resizeObserver = new ResizeObserver(() => engine.handleResize());
    if (viewportRef.current) resizeObserver.observe(viewportRef.current);
    return () => {
      window.removeEventListener('resize', engine.handleResize);
      resizeObserver.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.sync({
      project: props.project,
      selectedNodeId: props.selectedNodeId,
      transformMode: props.transformMode,
      axisEditMode: props.axisEditMode,
      transformSpace: props.transformSpace,
      snapEnabled: props.snapEnabled,
      translateSnap: props.translateSnap,
      rotateSnap: props.rotateSnap,
      scaleSnap: props.scaleSnap,
    });
  }, [
    props.project,
    props.selectedNodeId,
    props.transformMode,
    props.axisEditMode,
    props.transformSpace,
    props.snapEnabled,
    props.translateSnap,
    props.rotateSnap,
    props.scaleSnap,
  ]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const catalogItemId = event.dataTransfer.getData(CATALOG_MIME);
    if (catalogItemId) {
      props.onInsertCatalogItem(catalogItemId);
      return;
    }
    if (event.dataTransfer.files.length > 0) {
      try { await props.onImportFiles(event.dataTransfer.files); }
      catch (cause) { props.onError(cause instanceof Error ? cause.message : String(cause)); }
    }
  };

  return (
    <div
      ref={viewportRef}
      className={`viewport ${dragActive ? 'viewport--drag' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      >
      <canvas ref={canvasRef} className="viewport__canvas" aria-label="3D scene viewport"
        onPointerDown={() => setView('custom')} />
      {props.axisEditMode ? <div className="axis-mode-banner" data-overlay-ui>Axis mode <kbd>L</kbd><span>Move the pivot · geometry stays in place</span></div> : null}
      {props.isolatedNodeName ? <div className="isolation-banner" data-overlay-ui>
        <span>Isolated: <strong>{props.isolatedNodeName}</strong></span>
        <button type="button" onClick={props.onExitIsolation}>Exit isolation</button>
      </div> : null}
      <div className="viewport-chrome viewport-chrome--left" data-overlay-ui>
        <select aria-label="View angle" value={view} onChange={(event) => {
          const value = event.target.value as 'perspective' | 'front' | 'back' | 'top' | 'right';
          setView(value); engineRef.current?.setView(value);
        }}>
          <option value="perspective">Perspective</option><option value="front">Front</option>
          <option value="back">Back</option><option value="top">Top</option>
          <option value="right">Right</option><option value="custom" disabled>User view</option>
        </select>
        <button title="Frame selection (F)" aria-label="Frame selection" onClick={() => engineRef.current?.frameSelection()}><Focus /></button>
        <button title="Frame scene (Shift F)" aria-label="Frame scene" onClick={() => engineRef.current?.frameSelection(true)}><Scan /></button>
        <button title="Toggle grid" aria-label="Toggle grid" aria-pressed={gridVisible}
          className={gridVisible ? 'active' : ''} onClick={() => {
            engineRef.current?.setGridVisible(!gridVisible); setGridVisible(!gridVisible);
          }}><Grid3X3 /></button>
      </div>
      <div className="viewport-chrome viewport-chrome--right" data-overlay-ui>
        <select className="viewport-mode-select" aria-label="Viewport render mode" value={props.project.renderer.mode}
          onChange={(event) => props.onRenderModeChange(event.target.value as RenderMode)}>
          <option value="solid">Solid</option><option value="realtime">Realtime</option>
          <option value="live">Live</option><option value="render">Render</option>
        </select>
        <div className="viewport-modes" aria-label="Viewport rendering">
          {(['solid', 'realtime', 'live', 'render'] as const).map((mode) => <button
            key={mode} aria-pressed={props.project.renderer.mode === mode}
            className={props.project.renderer.mode === mode ? 'active' : ''}
            onClick={() => props.onRenderModeChange(mode)}>
            {mode === 'render' ? <Sparkles /> : null}{mode[0].toUpperCase() + mode.slice(1)}
          </button>)}
        </div>
      </div>
      <div className="viewport-navigation" data-overlay-ui><Mouse /><span>Left drag: orbit</span><span>Right drag: pan</span><span>Scroll: zoom</span><kbd>F</kbd><span>Frame</span></div>
      {props.sampleLimit > 0 ? <div className="viewport-progress" data-overlay-ui>
        <span>{props.sampleCount >= props.sampleLimit ? 'Render complete' : 'Path tracing'}</span>
        <span>{Math.floor(Math.min(props.sampleCount, props.sampleLimit))} / {props.sampleLimit} samples</span>
        <progress value={props.sampleCount} max={props.sampleLimit} aria-label="Render progress" />
      </div> : null}
      {dragActive ? (
        <div className="viewport__drop" data-overlay-ui>
          Drop models or catalog items into the scene
        </div>
      ) : null}
    </div>
  );
}

export const viewportDragMime = CATALOG_MIME;
