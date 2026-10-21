import type { ProjectDocument } from './types';
import type { Object3D } from 'three';

export function isObjectVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

// Isolation is a view mask, independent of each object's authored visibility.
export function getIsolationNodeIds(project: ProjectDocument): Set<string> | null {
  const targets = Object.values(project.nodes).filter((node) => node.isolated);
  if (!targets.length) return null;
  const included = new Set<string>();
  const visitedSubtrees = new Set<string>();
  const includeAncestors = (id: string) => {
    const visiting = new Set<string>();
    let current: string | null = id;
    while (current && project.nodes[current] && !visiting.has(current)) {
      visiting.add(current);
      included.add(current);
      current = project.nodes[current].parentId;
    }
  };
  const includeSubtree = (id: string) => {
    if (visitedSubtrees.has(id) || !project.nodes[id]) return;
    visitedSubtrees.add(id);
    included.add(id);
    project.nodes[id].children.forEach(includeSubtree);
  };
  targets.forEach((node) => { includeSubtree(node.id); includeAncestors(node.id); });
  // Keep the scene's lighting while examining an isolated object.
  Object.values(project.nodes).filter((node) => node.nodeType === 'light')
    .forEach((node) => includeAncestors(node.id));
  return included;
}
