import { Lock } from '../icons';
import type { MaterialUsage } from '../core/materialUsage';

export function MaterialUsagePanel({ usages, sharedEditing, canMakeUnique, onMakeUnique, onSharedEditing, onSelect }: {
  usages: MaterialUsage[];
  sharedEditing: boolean;
  canMakeUnique: boolean;
  onMakeUnique: () => void;
  onSharedEditing: () => void;
  onSelect: (nodeId: string, bindingId: string) => void;
}) {
  const objects = new Set(usages.map((usage) => usage.nodeId)).size;
  const shared = usages.length > 1;
  const locked = usages.some((usage) => usage.locked);
  return <section className="material-usage" aria-label="Material usage">
    <div className="material-usage__header">
      <strong>{shared ? 'Shared material' : 'Material usage'}</strong>
      <span>{usages.length} {usages.length === 1 ? 'element' : 'elements'} · {objects} {objects === 1 ? 'object' : 'objects'}</span>
    </div>
    {usages.length ? <ul aria-label="Assigned elements">
      {usages.map((usage) => <li key={JSON.stringify([usage.nodeId, usage.bindingId])}>
        <button type="button" onClick={() => onSelect(usage.nodeId, usage.bindingId)}
          title={`Select ${usage.nodeName} / ${usage.bindingLabel}`}>
          <span>{usage.nodeName} <span className="muted">/ {usage.bindingLabel}</span></span>
          {usage.locked ? <Lock aria-label="Locked object" /> : null}
        </button>
      </li>)}
    </ul> : null}
    <p className="fieldHint" role="status">{locked
      ? 'Used by a locked object. Unlock it to edit, or make an unlocked element unique.'
      : shared
        ? sharedEditing ? 'Editing all assigned elements together.' : 'Make the selected element unique, or enable shared editing.'
        : usages.length ? 'Changes affect this element only.' : 'Library material. Assign it to an element to use it in the scene.'}</p>
    {shared ? <div className="inlineControls">
      <button type="button" disabled={!canMakeUnique} onClick={onMakeUnique}
        title="Copy the material and assign it only to the selected element">Make Unique</button>
      <button type="button" disabled={locked} className={sharedEditing ? 'active' : ''}
        aria-pressed={sharedEditing} onClick={onSharedEditing}>
        {sharedEditing ? 'Stop Shared Editing' : 'Edit Shared'}
      </button>
    </div> : null}
  </section>;
}
