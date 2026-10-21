import { get, set } from 'idb-keyval';
import type { EditorProjectFile, ProjectDocument } from './types';

// Retain the legacy key so the rename does not strand existing local scenes.
const AUTOSAVE_KEY = 'studio-forge.autosave.v1';

export async function loadAutosave(): Promise<ProjectDocument | null> {
  const saved = await get<EditorProjectFile | undefined>(AUTOSAVE_KEY);
  if (saved?.project && !saved.project.metadata.starterScene
    && ['Studio Forge Project', 'Three Render Project'].includes(saved.project.name)) {
    const names = saved.project.rootNodeIds.map(id => saved.project.nodes[id]?.name).sort().join('|');
    if (names === 'Backdrop|Gift Box|Glass Panel|Key Light' || names === 'Backdrop|Gift Box|Glass Panel') {
      await set('studio-forge.autosave.before-cube-glass.v1', saved);
      return null;
    }
  }
  return saved?.project ?? null;
}

export async function saveAutosave(project: ProjectDocument): Promise<void> {
  await set(AUTOSAVE_KEY, { project });
}

export function downloadProjectFile(project: ProjectDocument): void {
  const blob = new Blob([JSON.stringify({ project }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}.studio.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<ProjectDocument> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<EditorProjectFile>;
  const project = parsed?.project;
  if (!project || project.version !== 1 || typeof project.name !== 'string'
    || !Array.isArray(project.rootNodeIds) || !project.nodes || !project.assets
    || !project.materials || !project.cameras?.[project.activeCameraId]
    || !project.environment || !project.renderer || !project.metadata) {
    throw new Error('This is not a supported Three Render project. Open a .studio.json project file.');
  }
  const visit = (id: string, ancestors: Set<string>) => {
    const node = project.nodes[id];
    if (!node || ancestors.has(id) || !Array.isArray(node.children)
      || !node.transform || !node.materialBindings
      || !['position', 'rotation', 'scale'].every((key) => {
        const vector = node.transform[key as keyof typeof node.transform];
        return Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
      }) || (node.pivotOffset && (!Array.isArray(node.pivotOffset) || node.pivotOffset.length !== 3 || !node.pivotOffset.every(Number.isFinite)))
      || (node.assetId && !project.assets[node.assetId])) {
      throw new Error('This project has an invalid scene hierarchy or transform.');
    }
    node.children.forEach((child) => visit(child, new Set([...ancestors, id])));
  };
  project.rootNodeIds.forEach((id) => visit(id, new Set()));
  return project;
}
