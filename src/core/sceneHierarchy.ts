import type { ProjectDocument } from './types';

export function subtreeHasLockedNode(project: ProjectDocument, nodeId: string, visited = new Set<string>()): boolean {
  const node = project.nodes[nodeId];
  if (!node || visited.has(nodeId)) return false;
  visited.add(nodeId);
  return node.locked || node.children.some((id) => subtreeHasLockedNode(project, id, visited));
}
