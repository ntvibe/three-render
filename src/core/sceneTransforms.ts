import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { TransformRecord as NodeTransform, ProjectDocument } from './types'

const vector = (value: [number, number, number]) => new Vector3(...value)

export function matrixFromTransform(transform: NodeTransform) {
  const quaternion = new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ'))
  return new Matrix4().compose(vector(transform.position), quaternion, vector(transform.scale))
}

export function transformFromMatrix(matrix: Matrix4): NodeTransform {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: [scale.x, scale.y, scale.z],
  }
}

export function worldMatrixForNode(document: ProjectDocument, nodeId: string, visiting = new Set<string>()): Matrix4 {
  const node = document.nodes[nodeId]
  if (!node) return new Matrix4()
  if (visiting.has(nodeId)) throw new Error(`Cycle detected while resolving transform for ${nodeId}`)
  visiting.add(nodeId)
  const local = matrixFromTransform(node.transform)
  const world = node.parentId
    ? worldMatrixForNode(document, node.parentId, visiting).multiply(local)
    : local
  visiting.delete(nodeId)
  return world
}

export function worldTransformForNode(document: ProjectDocument, nodeId: string): NodeTransform {
  return transformFromMatrix(worldMatrixForNode(document, nodeId))
}

export function localTransformFromWorld(
  document: ProjectDocument,
  nodeId: string,
  desiredWorldTransform: NodeTransform,
): NodeTransform {
  const node = document.nodes[nodeId]
  if (!node?.parentId) return structuredClone(desiredWorldTransform)
  const parentInverse = worldMatrixForNode(document, node.parentId).invert()
  return transformFromMatrix(parentInverse.multiply(matrixFromTransform(desiredWorldTransform)))
}
