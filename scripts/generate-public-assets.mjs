import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BufferGeometry, BoxGeometry, Float32BufferAttribute } from 'three';

// Generates new mathematical geometry, without reading any source model.
// Generated models, thumbnails, and example scenes are dedicated to CC0-1.0.
const root = new URL('../', import.meta.url);
const write = (path, data) => writeFile(new URL(path, root), data);
await mkdir(new URL('public/assets/', root), { recursive: true });

function gltf(geometry, name, material) {
  geometry.computeBoundingBox();
  const arrays = [geometry.index.array, geometry.attributes.position.array, geometry.attributes.normal.array];
  const chunks = [];
  const views = [];
  let offset = 0;
  for (const [index, array] of arrays.entries()) {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: index ? 34962 : 34963 });
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
    bytes.copy(padded); chunks.push(padded); offset += padded.length;
  }
  const bytes = Buffer.concat(chunks);
  return {
    asset: { version: '2.0', generator: 'Three Render procedural asset generator',
      copyright: 'CC0 1.0 Universal', extras: { license: 'CC0-1.0', source: 'scripts/generate-public-assets.mjs' } },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }] }],
    materials: [material],
    ...(material.extensions ? { extensionsUsed: Object.keys(material.extensions) } : {}),
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: geometry.index.array instanceof Uint32Array ? 5125 : 5123, count: geometry.index.count, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: geometry.attributes.position.count, type: 'VEC3',
        min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
      { bufferView: 2, componentType: 5126, count: geometry.attributes.normal.count, type: 'VEC3' },
    ],
  };
}

const profile = [[-3, 0], [1, 0]];
for (let segment = 1; segment <= 24; segment++) {
  const angle = segment / 24 * Math.PI / 2;
  profile.push([1 + Math.sin(angle), 1 - Math.cos(angle)]);
}
profile.push([2, 3]);
const positions = profile.flatMap(([z, y]) => [-3, y, z, 3, y, z]);
const indices = profile.slice(1).flatMap((_, index) => {
  const start = index * 2;
  return [start, start + 2, start + 1, start + 1, start + 2, start + 3];
});
const backdrop = new BufferGeometry();
backdrop.setAttribute('position', new Float32BufferAttribute(positions, 3));
backdrop.setIndex(indices); backdrop.computeVertexNormals();
const panel = new BoxGeometry(.2, .2, .008); panel.translate(0, .1, 0);
await write('public/assets/backdrop.gltf', JSON.stringify(gltf(backdrop, 'Studio Backdrop', {
  name: 'Neutral Studio', pbrMetallicRoughness: { baseColorFactor: [.35, .35, .35, 1], roughnessFactor: .7, metallicFactor: 0 }, doubleSided: true,
}), null, 2) + '\n');
await write('public/assets/glass_panel.gltf', JSON.stringify(gltf(panel, 'Glass Panel', {
  name: 'Clear Glass', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], roughnessFactor: .03, metallicFactor: 0 },
  extensions: { KHR_materials_transmission: { transmissionFactor: 1 }, KHR_materials_ior: { ior: 1.5 } },
}), null, 2) + '\n');
backdrop.dispose(); panel.dispose();

const shapes = {
  'backdrop': '<path d="M7 24h18V8h-4v9a5 5 0 0 1-5 5H7Z" fill="#9ba3af"/><path d="M7 26h20" stroke="#dfe3e8"/>',
  'glass-panel': '<path d="m9 6 14 3v18l-14-3Z" fill="#b4d9f2" fill-opacity=".2" stroke="#b4d9f2"/><path d="m12 9 7 2" stroke="#fff"/>',
  'environment': '<circle cx="16" cy="16" r="11" stroke="#dfe3e8"/><ellipse cx="16" cy="16" rx="5" ry="11" stroke="#dfe3e8"/><path d="M5 16h22" stroke="#dfe3e8"/>',
};
for (const [name, shape] of Object.entries(shapes)) {
  await write(`public/catalog/thumbs/${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32"><metadata>CC0-1.0; Three Render generated artwork</metadata><rect width="32" height="32" rx="3" fill="#181b1f"/>${shape}</svg>\n`);
}

const catalog = JSON.parse(await readFile(new URL('public/catalog/catalog.json', root), 'utf8'));
catalog.items.find((item) => item.id === 'backdrop').boundingBox = { min: [-3, 0, -3], max: [3, 3, 2] };
catalog.items.find((item) => item.id === 'glass-panel').boundingBox = { min: [-.1, 0, -.004], max: [.1, .2, .004] };
await write('public/catalog/catalog.json', JSON.stringify(catalog, null, 2) + '\n');

const authoredPaths = [
  'public/assets/backdrop.gltf', 'public/assets/glass_panel.gltf',
  ...Object.keys(shapes).map((name) => `public/catalog/thumbs/${name}.svg`),
  'public/examples/glass-dispersion.studio.json', 'public/examples/area-aperture.studio.json',
  'src/icons.tsx', 'src/components/PrimitiveIcon.tsx',
  'docs/images/editor.png',
];
const assets = [];
for (const path of authoredPaths) {
  assets.push({ path, license: 'CC0-1.0', origin: 'Original procedural geometry, geometric artwork, or example scene',
    sha256: createHash('sha256').update(await readFile(new URL(path, root))).digest('hex') });
}
assets.push({ path: 'public/assets/studio_small_09_1k.hdr', license: 'CC0-1.0', author: 'Sergej Majboroda / Poly Haven',
  source: 'https://polyhaven.com/a/studio_small_09', licenseUrl: 'https://polyhaven.com/license',
  downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  sha256: createHash('sha256').update(await readFile(new URL('public/assets/studio_small_09_1k.hdr', root))).digest('hex') });
await write('public/assets/manifest.json', JSON.stringify({ version: 1, assets }, null, 2) + '\n');
console.log(`Generated 2 models and 3 thumbnails; recorded ${assets.length} CC0 asset checksums.`);
