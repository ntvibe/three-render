import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Layers3, Plus, Search, Upload } from '../icons';
import { PrimitiveIcon } from './PrimitiveIcon';
import { MATERIAL_PRESETS } from '../core/materials';
import { PRIMITIVES } from '../core/primitives';
import { publicAssetUrl } from '../core/publicAssets';
import type { CatalogItem, MaterialRecord, PrimitiveType } from '../core/types';
import { viewportDragMime } from './Viewport';

export function AssetShelf({ items, materials, selectedMaterialId, onMaterial, onPreset,
  onInsert, onPrimitive, onImport, collapsed, onToggle }: {
  items: CatalogItem[];
  materials: MaterialRecord[];
  selectedMaterialId: string | null;
  onMaterial: (id: string) => void;
  onPreset: (id: string) => void;
  onInsert: (id: string) => void;
  onPrimitive: (type: PrimitiveType) => void;
  onImport: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<'materials' | 'models' | 'environments'>('materials');
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLowerCase());
  const visibleItems = useMemo(() => items.filter((item) =>
    (tab === 'models' ? item.kind === 'model' : item.kind === 'environment')
    && `${item.name} ${item.category} ${item.tags.join(' ')}`.toLowerCase().includes(query)), [items, query, tab]);
  const visibleMaterials = materials.filter((material) => material.name.toLowerCase().includes(query));
  const visiblePresets = MATERIAL_PRESETS.filter((material) => material.name.toLowerCase().includes(query));
  const hasResults = tab === 'materials' ? visibleMaterials.length + visiblePresets.length > 0
    : visibleItems.length > 0 || (tab === 'models' && PRIMITIVES.some((item) => item.name.toLowerCase().includes(query)));
  return <section className={`asset-shelf ${collapsed ? 'asset-shelf--collapsed' : ''}`} aria-label="Asset library">
    <header className="shelf-header">
      <strong><Layers3 />Library</strong>
      <div className="shelf-tabs" role="tablist" aria-label="Library category">
        {(['materials', 'models', 'environments'] as const).map((value) => <button key={value}
          role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''}
          onClick={() => { setTab(value); if (collapsed) onToggle(); }}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      <label className="shelf-search"><Search /><input aria-label="Search library" placeholder={`Search ${tab}…`}
        value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button className="shelf-import" onClick={onImport} title="Import GLB, glTF, HDR or EXR"><Upload /><span>Import</span></button>
      <button className="iconButton" aria-label={collapsed ? 'Expand library' : 'Collapse library'} onClick={onToggle}>
        {collapsed ? <ChevronUp /> : <ChevronDown />}
      </button>
    </header>
    {!collapsed ? <div className="shelf-content">
      {tab === 'materials' ? <>
        {visibleMaterials.map((material) => <MaterialTile key={material.id} material={material}
          selected={material.id === selectedMaterialId} onClick={() => onMaterial(material.id)} />)}
        {visibleMaterials.length > 0 && visiblePresets.length > 0 ? <span className="shelf-divider" /> : null}
        {visiblePresets.map((material) => <MaterialTile key={material.id} material={material}
          preset onClick={() => onPreset(material.id)} />)}
      </> : <>
        {tab === 'models' ? PRIMITIVES.filter((item) => item.name.toLowerCase().includes(query)).map((item) =>
          <button className="library-tile primitive-tile" key={item.type} onClick={() => onPrimitive(item.type)}
            title={`Add ${item.name}`}><PrimitiveIcon type={item.type} /><span>{item.name}</span><Plus className="tile-add" /></button>) : null}
        {visibleItems.map((item) => <button className="library-tile model-tile" key={item.id}
          title={item.kind === 'environment' ? `Use ${item.name}` : `Add ${item.name}`}
          draggable onDragStart={(event) => { event.dataTransfer.setData(viewportDragMime, item.id); event.dataTransfer.effectAllowed = 'copy'; }}
          onClick={() => onInsert(item.id)}><img src={publicAssetUrl(item.thumbnail)} alt="" /><span>{item.name}</span></button>)}
      </>}
      {!hasResults ? <p className="library-empty">No {tab} match “{search}”.</p> : null}
    </div> : null}
  </section>;
}

function MaterialTile({ material, selected, preset, onClick }: {
  material: MaterialRecord; selected?: boolean; preset?: boolean; onClick: () => void;
}) {
  const displayName = material.name.replace(/^Gift Box 2026::/, '').replace(/ Copy$/, '');
  return <button className={`library-tile material-tile ${selected ? 'is-selected' : ''}`}
    style={{ '--material-color': material.color, '--material-roughness': material.roughness } as CSSProperties}
    title={preset ? `Create ${material.name} material` : `Assign ${material.name} to selected element`}
    aria-label={preset ? `Create ${material.name} material` : `Select ${material.name} material`} onClick={onClick}>
    <span className={`material-sphere ${material.metalness > 0.8 ? 'material-sphere--metal' : ''} ${material.transmission > 0 ? 'material-sphere--glass' : ''}`} />
    <span className="tile-name">{displayName}</span>
    {preset ? <Plus className="tile-add" /> : null}
  </button>;
}
