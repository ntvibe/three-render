import { Matrix4, Vector3 } from 'three';
import { matrixFromTransform } from './sceneTransforms';
import type { ProjectDocument, SceneNodeRecord, Vec3Tuple } from './types';

function linearTransform(node: SceneNodeRecord): Matrix4 {
  return matrixFromTransform({ ...node.transform, position: [0, 0, 0] });
}

export function pivotForAxisPosition(node: SceneNodeRecord, position: Vec3Tuple): Vec3Tuple | null {
  const linear = linearTransform(node);
  if (Math.abs(linear.determinant()) < 1e-12) return null;
  const delta = new Vector3(...position).sub(new Vector3(...node.transform.position)).applyMatrix4(linear.invert());
  return delta.add(new Vector3(...(node.pivotOffset ?? [0, 0, 0]))).toArray() as Vec3Tuple;
}

/** Mutates a project copy, preserving the mesh and all child world transforms. */
export function moveNodeAxis(project: ProjectDocument, nodeId: string, pivot: Vec3Tuple): boolean {
  const node = project.nodes[nodeId];
  if (!node || node.locked || node.nodeType !== 'asset' || !pivot.every(Number.isFinite)) return false;
  const delta = new Vector3(...pivot).sub(new Vector3(...(node.pivotOffset ?? [0, 0, 0])));
  if (delta.lengthSq() < 1e-24) return false;
  const translation = delta.clone().applyMatrix4(linearTransform(node));
  node.transform.position = new Vector3(...node.transform.position).add(translation).toArray() as Vec3Tuple;
  node.pivotOffset = [...pivot];
  for (const id of node.children) {
    const child = project.nodes[id];
    child.transform.position = new Vector3(...child.transform.position).sub(delta).toArray() as Vec3Tuple;
  }
  return true;
}
