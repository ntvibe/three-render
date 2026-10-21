import { BoxGeometry, CapsuleGeometry, CylinderGeometry, Mesh, MeshPhysicalMaterial, PlaneGeometry, RingGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AssetRecord, PrimitiveParameters, PrimitiveType } from './types';
import { createId } from './id';
import { DEFAULT_DIFFUSE_MATERIAL_ID } from './materials';

export interface PrimitiveField {
  key: string; label: string; default: number | boolean; min?: number; max?: number;
  step?: number; length?: boolean; integer?: boolean;
}
const length = (key: string, label: string, value: number, min = 0.001): PrimitiveField =>
  ({ key, label, default: value, min, max: 100, step: 0.01, length: true });
const segments = (key: string, label: string, value: number, min = 1, max = 128): PrimitiveField =>
  ({ key, label, default: value, min, max, step: 1, integer: true });
export const PRIMITIVES: Array<{ type: PrimitiveType; name: string; fields: PrimitiveField[] }> = [
  { type: 'cube', name: 'Cube', fields: [length('width','Width',.2), length('height','Height',.2), length('depth','Depth',.2), segments('widthSegments','Segments X',1,1,32), segments('heightSegments','Segments Y',1,1,32), segments('depthSegments','Segments Z',1,1,32), length('fillet','Fillet radius',0,0), segments('filletSegments','Fillet subdivisions',3,1,8)] },
  { type: 'sphere', name: 'Sphere', fields: [length('radius','Radius',.1), segments('radialSegments','Segments',48,3), segments('heightSegments','Rings',32,2,64)] },
  { type: 'cylinder', name: 'Cylinder', fields: [length('radius','Radius',.1), length('height','Height',.2), segments('radialSegments','Rotation segments',48,3), segments('heightSegments','Height segments',1,1,32), {key:'openEnded',label:'Open ends',default:false}] },
  { type: 'cone', name: 'Cone', fields: [length('radius','Bottom radius',.1), length('topRadius','Top radius',0,0), length('height','Height',.2), segments('radialSegments','Rotation segments',48,3), segments('heightSegments','Height segments',1,1,32), {key:'openEnded',label:'Open ends',default:false}] },
  { type: 'torus', name: 'Torus', fields: [length('radius','Ring radius',.1), length('tube','Tube radius',.035), segments('radialSegments','Tube segments',24,3,64), segments('tubularSegments','Ring segments',64,3)] },
  { type: 'capsule', name: 'Capsule', fields: [length('radius','Radius',.05), length('height','Total height',.2), segments('capSegments','Cap segments',8,2,32), segments('radialSegments','Rotation segments',32,3)] },
  { type: 'plane', name: 'Plane', fields: [length('width','Width',1), length('depth','Depth',1), segments('widthSegments','Segments X',1,1,64), segments('depthSegments','Segments Z',1,1,64)] },
  { type: 'disc', name: 'Disc', fields: [length('radius','Outer radius',.1), length('innerRadius','Inner radius',0,0), segments('radialSegments','Rotation segments',48,3), segments('ringSegments','Disc segments',1,1,32)] },
];

export function normalizePrimitiveParameters(type: PrimitiveType, input: PrimitiveParameters = {}): PrimitiveParameters {
  const definition = PRIMITIVES.find(item => item.type === type)!;
  const p: PrimitiveParameters = {};
  for (const field of definition.fields) {
    if (typeof field.default === 'boolean') { p[field.key] = typeof input[field.key] === 'boolean' ? input[field.key] : field.default; continue; }
    let value = typeof input[field.key] === 'number' && Number.isFinite(input[field.key]) ? input[field.key] as number : field.default;
    value = Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, value));
    p[field.key] = field.integer ? Math.round(value) : value;
  }
  if (type === 'cube') p.fillet = Math.min(p.fillet as number, Math.min(p.width as number, p.height as number, p.depth as number) * .499);
  if (type === 'capsule') p.height = Math.max(p.height as number, (p.radius as number) * 2);
  if (type === 'disc') p.innerRadius = Math.min(p.innerRadius as number, (p.radius as number) * .999);
  if (type === 'torus') p.tube = Math.min(p.tube as number, (p.radius as number) * .999);
  return p;
}

export function createPrimitiveGeometry(type: PrimitiveType, input?: PrimitiveParameters): BufferGeometry {
  const p = normalizePrimitiveParameters(type, input);
  const n = (key: string) => p[key] as number;
  let geometry: BufferGeometry;
  if (type === 'sphere') geometry = new SphereGeometry(n('radius'), n('radialSegments'), n('heightSegments'));
  else if (type === 'cylinder' || type === 'cone') geometry = new CylinderGeometry(type === 'cone' ? n('topRadius') : n('radius'), n('radius'), n('height'), n('radialSegments'), n('heightSegments'), p.openEnded as boolean);
  else if (type === 'torus') geometry = new TorusGeometry(n('radius'),n('tube'),n('radialSegments'),n('tubularSegments'));
  else if (type === 'capsule') geometry = new CapsuleGeometry(n('radius'), Math.max(0, n('height') - n('radius') * 2), n('capSegments'), n('radialSegments'));
  else if (type === 'plane') { geometry = new PlaneGeometry(n('width'), n('depth'), n('widthSegments'), n('depthSegments')); geometry.rotateX(-Math.PI / 2); }
  else if (type === 'disc') { geometry = new RingGeometry(n('innerRadius'), n('radius'), n('radialSegments'), n('ringSegments')); geometry.rotateX(-Math.PI / 2); }
  else geometry = n('fillet') > 0
    ? new RoundedBoxGeometry(n('width'),n('height'),n('depth'),n('filletSegments'),n('fillet'))
    : new BoxGeometry(n('width'),n('height'),n('depth'),n('widthSegments'),n('heightSegments'),n('depthSegments'));
  if (type !== 'plane' && type !== 'disc') geometry.translate(0, type === 'sphere' ? n('radius') : type === 'torus' ? n('radius') + n('tube') : n('height') / 2, 0);
  geometry.computeBoundingBox();
  return geometry;
}

export function createPrimitiveMesh(type: PrimitiveType, input?: PrimitiveParameters): Mesh {
  const mesh = new Mesh(createPrimitiveGeometry(type, input), new MeshPhysicalMaterial({color:'#c4c8cf',roughness:.3}));
  mesh.name = PRIMITIVES.find(item => item.type === type)!.name;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function createPrimitiveAsset(type: PrimitiveType): AssetRecord {
  const id = createId('asset');
  return { id, name: PRIMITIVES.find(item => item.type === type)!.name, kind:'model',sourceKind:'primitive',primitive:type,
    sourceUri:`primitive:${type}`, defaultScale:[1,1,1], pivotHint:'floor',
    meshBindings:[{id:`${id}::binding::0:0`, label:'Surface', meshPath:'0',slot:0,defaultMaterialId:DEFAULT_DIFFUSE_MATERIAL_ID}] };
}
