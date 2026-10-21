import { readFile, readdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
let text = '# Third-party software notices\n\n';
text += 'Three Render code is MIT licensed. Its bundled creative assets are CC0-1.0.\n';
text += 'Software libraries are not public-domain assets and retain the licenses below.\n';
text += 'Generated from the installed, locked production dependency tree. Regenerate with `npm run notices:generate`.\n\n';
for (const [path, dependency] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path || dependency.dev) continue;
  const directory = new URL(`${path}/`, root);
  const pkg = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  text += `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? dependency.license}\n\n`;
  const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
  if (!files.length) throw new Error(`Missing license file for ${pkg.name}`);
  for (const filename of files) {
    text += `### ${filename}\n\n\x60\x60\x60text\n${(await readFile(new URL(filename, directory), 'utf8')).trim()}\n\x60\x60\x60\n\n`;
  }
}
await writeFile(new URL('THIRD_PARTY_NOTICES.md', root), text.trimEnd() + '\n');
console.log('Generated locked production dependency notices.');
