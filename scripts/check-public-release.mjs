import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
assert.ok(files.length, 'No public repository files found');
// Keep the prohibited legacy brand out of the release, including this check's source.
const prohibited = String.fromCharCode(98, 105, 116, 112, 97, 110, 100, 97);
const privatePath = new RegExp('[/]' + 'Users[/]');
const secrets = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5})/;
for (const path of files) {
  assert.ok(!/(^|\/)(node_modules|dist|\.codex|\.agents|\.playwright-mcp)(\/|$)|\.zip$|\.tgz$|\.tza$|(^|\/)\.env(?:\.|$)|\.DS_Store$/.test(path), `Local or unverified file included: ${path}`);
  const content = await readFile(new URL(path, root));
  const text = content.toString('utf8');
  assert.ok(!text.toLowerCase().includes(prohibited) && !path.toLowerCase().includes(prohibited), `Prohibited brand in ${path}`);
  assert.ok(!privatePath.test(text), `Private machine path in ${path}`);
  assert.ok(!secrets.test(text), `Possible secret in ${path}`);
  if (path.endsWith('.gltf')) {
    const asset = JSON.parse(text);
    assert.equal(asset.asset.extras?.license, 'CC0-1.0', `Missing CC0 provenance: ${path}`);
    for (const buffer of asset.buffers ?? []) {
      assert.ok(buffer.uri.startsWith('data:'), `External buffer in ${path}`);
      assert.ok(!Buffer.from(buffer.uri.split(',')[1], 'base64').toString('utf8').toLowerCase().includes(prohibited), `Prohibited content in model buffer: ${path}`);
    }
  }
}

const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8'));
const recorded = new Set();
for (const asset of manifest.assets) {
  assert.equal(asset.license, 'CC0-1.0', `Non-public-domain asset: ${asset.path}`);
  assert.ok(!recorded.has(asset.path), `Duplicate provenance entry: ${asset.path}`);
  recorded.add(asset.path);
  const hash = createHash('sha256').update(await readFile(new URL(asset.path, root))).digest('hex');
  assert.equal(hash, asset.sha256, `Asset changed without provenance update: ${asset.path}`);
}
const publicDocuments = new Set(['public/assets/ATTRIBUTION.md', 'public/assets/LICENSE', 'public/assets/manifest.json', 'public/catalog/catalog.json']);
async function checkPublic(directory) {
  for (const name of await readdir(new URL(directory, root))) {
    const path = `${directory}${name}`;
    if ((await stat(new URL(path, root))).isDirectory()) await checkPublic(`${path}/`);
    else assert.ok(recorded.has(path) || publicDocuments.has(path), `Unreviewed public asset: ${path}`);
  }
}
await checkPublic('public/');
const catalog = JSON.parse(await readFile(new URL('public/catalog/catalog.json', root), 'utf8'));
for (const item of catalog.items) {
  for (const path of [item.sourceAsset, item.thumbnail]) {
    assert.ok(path.startsWith('/') && recorded.has(`public${path}`), `Catalog asset lacks CC0 provenance: ${path}`);
  }
}
assert.equal(createHash('sha256').update(await readFile(new URL('public/assets/studio_small_09_1k.hdr', root))).digest('hex'),
  'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45', 'HDR differs from verified creator download');
console.log(`Public release check passed: ${files.length} files, ${recorded.size} verified CC0 creative assets.`);
