import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED = ['package.json', 'desktop/main.mjs', 'desktop/protocol.mjs', 'desktop/security.mjs',
  'index.html', 'styles.css', 'assets/app.ico', 'assets/app.png', 'assets/favicon.svg', 'assets/notices.txt',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/audio/README.md', 'assets/audio/TERMS.md',
  'assets/audio/generation-manifest.json'];

export function expectedAudioKeys(items) {
  return [...new Set(items.map(item => item.id))];
}

export function validatePackagedEntries(entries, pkg, expected) {
  const files = new Set(entries.map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
  const errors = [];
  const allow = /^(?:package\.json|desktop\/(?:main|protocol|security)\.mjs|index\.html|styles\.css|js\/(?:app|audio|backup|data|flashcards|keyboard|new-learning|review-range|storage)\.js|assets\/(?:app\.(?:ico|png)|favicon\.svg|notices\.txt)|assets\/audio\/(?:[a-z0-9_-]+\.wav|generation-manifest\.json|(?:README|TERMS)\.md)|LICENSE|THIRD_PARTY_NOTICES\.md)$/;
  for (const entry of files) if (!allow.test(entry)) errors.push(`Unexpected packaged file: ${entry}`);
  for (const file of REQUIRED) if (!files.has(file)) errors.push(`Missing packaged file: ${file}`);
  for (const key of expected.audioKeys) if (!files.has(`assets/audio/${key}.wav`)) errors.push(`Missing packaged audio: ${key}`);
  for (const filename of expected.jsFiles) if (!files.has(`js/${filename}`)) errors.push(`Missing packaged module: ${filename}`);
  if (pkg.name !== 'japanese-kana-review' || pkg.version !== '1.0.0' || pkg.main !== 'desktop/main.mjs') errors.push('Incorrect packaged application identity');
  if (Object.keys(pkg.dependencies || {}).length) errors.push('Runtime dependencies must not be packaged');
  return errors;
}

export async function readPackagedEntries(archive) {
  const asar = await import('@electron/asar');
  const entries = [];
  for (const listed of asar.listPackage(archive)) {
    const entry = listed.replaceAll('\\', '/').replace(/^\/+/, '');
    const metadata = asar.statFile(archive, path.normalize(entry), false);
    assert.ok(!metadata.link, `Packaged symlinks are forbidden: ${entry}`);
    if (!metadata.files) entries.push(entry);
  }
  return entries;
}

export async function verifyPackage(directory = path.join(ROOT, 'dist')) {
  const asar = await import('@electron/asar');
  const archive = path.join(directory, 'win-unpacked/resources/app.asar');
  const entries = await readPackagedEntries(archive);
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const { STUDY_ITEMS } = await import('../js/data.js');
  const audioKeys = expectedAudioKeys(STUDY_ITEMS);
  assert.equal(STUDY_ITEMS.length, 128, 'The complete 128-item course must be packaged');
  assert.equal(audioKeys.length, 128, 'Every study item needs its own local audio key');
  const jsFiles = (await readdir(path.join(ROOT, 'js'))).filter(file => file.endsWith('.js'));
  const errors = validatePackagedEntries(entries, pkg, { audioKeys, jsFiles });
  assert.deepEqual(errors, [], errors.join('\n'));
  for (const key of audioKeys) {
    const wav = asar.extractFile(archive, path.normalize(`assets/audio/${key}.wav`));
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF', `Invalid WAV: ${key}`);
    assert.equal(wav.subarray(8, 12).toString(), 'WAVE', `Invalid WAV: ${key}`);
    assert.ok(wav.length > 44, `Empty WAV: ${key}`);
  }
  assert.ok((await stat(path.join(directory, 'win-unpacked/LICENSE.electron.txt'))).size > 0, 'Electron license required');
  assert.ok((await stat(path.join(directory, 'win-unpacked/LICENSES.chromium.html'))).size > 0, 'Chromium notices required');
  for (const type of ['setup', 'portable']) {
    const filename = `Japanese-Kana-Review-${pkg.version}-win-x64-${type}.exe`;
    const data = await readFile(path.join(directory, filename));
    assert.equal(data.subarray(0, 2).toString(), 'MZ', `Invalid Windows executable: ${filename}`);
    assert.ok(data.length > 1_000_000, `Unexpectedly small package: ${filename}`);
  }
  console.log(`Verified ${entries.length} ASAR files, all 128 WAV clips, licenses, and both Windows x64 executables.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPackage(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
}
