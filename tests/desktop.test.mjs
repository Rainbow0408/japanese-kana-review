import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDY_ITEMS } from '../js/data.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
async function protocolModule() {
  assert.ok(existsSync(path.join(root, 'desktop/protocol.mjs')), 'local resource protocol must exist');
  return import('../desktop/protocol.mjs');
}

test('local protocol resolves entry point and local modules with explicit MIME types', async () => {
  const { resolveResource } = await protocolModule();
  assert.deepEqual(resolveResource('app://kana/', root), {
    status: 200, file: path.join(root, 'index.html'), mime: 'text/html; charset=utf-8',
  });
  assert.equal(resolveResource('app://kana/js/app.js?v=1', root).mime, 'text/javascript; charset=utf-8');
  assert.equal(resolveResource('app://kana/assets/audio/a.wav', root).mime, 'audio/wav');
  assert.equal(resolveResource('app://kana/assets/app.ico', root).mime, 'image/x-icon');
});

test('local protocol rejects raw and encoded traversal before URL normalization', async () => {
  const { resolveResource } = await protocolModule();
  for (const tail of ['../index.html', 'js/../app.js', '%2e%2e/index.html', 'js/%2e%2e/app.js',
    'assets/%2e%2e/%2e%2e/package.json', 'js/%252e%252e/app.js', 'js/%2e./app.js',
    'js%2f..%2findex.html', 'assets/%5c..%5csecret.png', 'assets/a%00.wav', 'assets/C%3A/a.wav',
    'js/.hidden.js', 'assets/a.wav::$DATA', 'js//app.js', 'js/app.js%20']) {
    assert.equal(resolveResource(`app://kana/${tail}`, root).status, 403, tail);
  }
});

test('local protocol denies foreign hosts, credentials, ports and non-web package files', async () => {
  const { resolveResource } = await protocolModule();
  for (const url of ['https://kana/index.html', 'file:///C:/secret', 'app://evil/index.html',
    'app://kana.evil/index.html', 'app://user@kana/index.html', 'app://kana:80/index.html',
    'app://kana/package.json', 'app://kana/desktop/main.mjs', 'app://kana/tests/desktop.test.mjs',
    'app://kana/LICENSE', 'app://kana/README.md', 'app://kana/js/app.js.bak']) {
    assert.notEqual(resolveResource(url, root).status, 200, url);
  }
  assert.equal(resolveResource('app://kana/assets/%broken.wav', root).status, 400);
});

test('resource responses support HEAD, deny writes and retain restrictive CSP', async () => {
  const { handleResourceRequest, CONTENT_SECURITY_POLICY } = await protocolModule();
  const response = await handleResourceRequest({ url: 'app://kana/', method: 'GET' }, root);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html/);
  assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.equal((await handleResourceRequest({ url: 'app://kana/', method: 'POST' }, root)).status, 405);
  const head = await handleResourceRequest({ url: 'app://kana/', method: 'HEAD' }, root);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await handleResourceRequest({ url: 'app://kana/js/missing.js', method: 'GET' }, root)).status, 404);
});

test('only the app page and its blob downloads qualify for native Save As', async () => {
  assert.ok(existsSync(path.join(root, 'desktop/security.mjs')), 'desktop security policy must exist');
  const { isAppPage, isAllowedDownload, safeDownloadName, profilePath } = await import('../desktop/security.mjs');
  assert.equal(isAppPage('app://kana/'), true);
  assert.equal(isAppPage('app://kana/index.html#about'), true);
  for (const url of ['app://kana/js/app.js', 'app://evil/', 'https://example.com/', 'app://kana:80/']) {
    assert.equal(isAppPage(url), false);
  }
  assert.equal(isAllowedDownload('blob:app://kana/123', 'app://kana/'), true);
  assert.equal(isAllowedDownload('https://example.com/x.json', 'app://kana/'), false);
  assert.equal(isAllowedDownload('blob:app://kana/123', 'https://example.com/'), false);
  assert.equal(safeDownloadName('../../progress.json'), 'progress.json');
  assert.equal(safeDownloadName('progress:bad.json'), 'progress_bad.json');
  assert.equal(profilePath(root, {}), path.join(root, 'japanese-kana-review'));
  assert.equal(profilePath(root, { KANA_TEST_DATA_DIR: path.join(root, 'tmp/qa') }), path.join(root, 'tmp/qa'));
  assert.throws(() => profilePath(root, { KANA_TEST_DATA_DIR: 'relative-path' }), /absolute/);
});

test('navigation guards read Electron navigation details from the event itself', async () => {
  const { blockExternalNavigation } = await import('../desktop/security.mjs');
  assert.equal(typeof blockExternalNavigation, 'function');
  let blocked = false;
  blockExternalNavigation({ url: 'https://example.com/', preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  blocked = false;
  blockExternalNavigation({ url: 'app://kana/', preventDefault() { blocked = true; } });
  assert.equal(blocked, false);
});

test('packaging config uses a resource allowlist, stable identity and both Windows x64 targets', () => {
  assert.ok(existsSync(path.join(root, 'package.json')), 'desktop package manifest must exist');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const build = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.main, 'desktop/main.mjs');
  assert.equal(build.productName, '日语假名复习');
  assert.equal(build.appId, 'io.github.rainbow0408.japanese-kana-review');
  assert.equal(build.asar, true);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.artifactName, 'Japanese-Kana-Review-${version}-win-${arch}-setup.${ext}');
  assert.equal(build.portable.artifactName, 'Japanese-Kana-Review-${version}-win-${arch}-portable.${ext}');
  assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }]);
  assert.equal(build.files.includes('**/*'), false);
  assert.equal(pkg.dependencies, undefined);
  assert.ok(pkg.devDependencies.electron);
});

test('packaged archive manifest refuses tools, dependencies, links and absent audio', async () => {
  assert.ok(existsSync(path.join(root, 'tools/verify-package.mjs')), 'package verifier must exist');
  const { validatePackagedEntries } = await import('../tools/verify-package.mjs');
  const pkg = { name: 'japanese-kana-review', version: '1.0.0', main: 'desktop/main.mjs' };
  const entries = ['package.json', 'desktop/main.mjs', 'desktop/protocol.mjs', 'desktop/security.mjs',
    'index.html', 'styles.css', 'js/app.js', 'assets/app.ico', 'assets/app.png', 'assets/favicon.svg', 'assets/notices.txt',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/audio/README.md', 'assets/audio/TERMS.md',
    'assets/audio/generation-manifest.json', 'assets/audio/a.wav'];
  assert.deepEqual(validatePackagedEntries(entries, pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }), []);
  for (const extra of ['tools/serve.mjs', '.git/config', 'node_modules/runtime/index.js', 'docs/design.md',
    'tmp/cached.zip', 'assets/audio/a.wav.bak', 'assets/audio/backup.json']) {
    assert.ok(validatePackagedEntries([...entries, extra], pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }).length > 0, extra);
  }
  assert.ok(validatePackagedEntries(entries.filter(entry => !entry.endsWith('a.wav')), pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }).some(error => /audio/.test(error)));
  assert.ok(validatePackagedEntries(entries, { ...pkg, dependencies: { unsafe: '*' } }, { audioKeys: ['a'], jsFiles: ['app.js'] }).length > 0);
  assert.ok(validatePackagedEntries(entries.filter(entry => !entry.endsWith('TERMS.md')), pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }).some(error => /Missing.*TERMS/.test(error)));
  assert.ok(validatePackagedEntries(entries.filter(entry => !entry.endsWith('generation-manifest.json')), pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }).some(error => /Missing.*manifest/.test(error)));
  assert.ok(validatePackagedEntries(entries.filter(entry => !entry.endsWith('notices.txt')), pkg, { audioKeys: ['a'], jsFiles: ['app.js'] }).some(error => /Missing.*notices/.test(error)));
});

test('package audio verification uses all stable item IDs including complete rule examples', async () => {
  const { expectedAudioKeys } = await import('../tools/verify-package.mjs');
  assert.equal(typeof expectedAudioKeys, 'function');
  const keys = expectedAudioKeys(STUDY_ITEMS);
  assert.equal(keys.length, 128);
  assert.deepEqual(keys, STUDY_ITEMS.map(item => item.id));
  assert.equal(keys.includes(undefined), false);
});

test('ASAR verification reads Windows archive paths and excludes directories', async () => {
  const { readPackagedEntries } = await import('../tools/verify-package.mjs');
  assert.equal(typeof readPackagedEntries, 'function');
  const asar = await import('@electron/asar');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kana-archive-test-'));
  try {
    const source = path.join(temporary, 'source');
    await mkdir(path.join(source, 'js'), { recursive: true });
    await mkdir(path.join(source, 'assets/audio'), { recursive: true });
    await writeFile(path.join(source, 'LICENSE'), 'Test license');
    await writeFile(path.join(source, 'js/app.js'), 'export const local = true;');
    await writeFile(path.join(source, 'assets/audio/a.wav'), 'Test audio');
    const archive = path.join(temporary, 'app.asar');
    await asar.createPackage(source, archive);
    assert.deepEqual((await readPackagedEntries(archive)).sort(), ['LICENSE', 'assets/audio/a.wav', 'js/app.js']);
  } finally {
    assert.ok(path.relative(os.tmpdir(), temporary).startsWith('kana-archive-test-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
