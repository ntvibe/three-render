import type { ProjectDocument } from './types';

export interface MaterialUsage {
  nodeId: string;
  bindingId: string;
  nodeName: string;
  bindingLabel: string;
  locked: boolean;
}

// Follow the same explicit-assignment/default fallback as the renderer.
// Hidden objects still own their materials and must count as users.
export function getMaterialUsages(project: ProjectDocument, materialId: string): MaterialUsage[] {
  return Object.values(project.nodes).flatMap((node) => {
    const bindings = node.assetId ? project.assets[node.assetId]?.meshBindings ?? [] : [];
    return bindings.flatMap((binding) =>
      (node.materialBindings[binding.id] ?? binding.defaultMaterialId) === materialId
        ? [{ nodeId: node.id, bindingId: binding.id, nodeName: node.name,
            bindingLabel: binding.label, locked: node.locked }]
        : []);
  });
}

export function materialUsageKey(materialId: string, usages: MaterialUsage[]): string {
  return JSON.stringify([materialId, usages.map(({ nodeId, bindingId }) => [nodeId, bindingId]).sort()]);
}

export function canEditMaterial(usages: MaterialUsage[], materialId: string, sharedEditKey: string | null): boolean {
  return !usages.some((usage) => usage.locked)
    && (usages.length <= 1 || sharedEditKey === materialUsageKey(materialId, usages));
}
