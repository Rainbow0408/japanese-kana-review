// Optional QA of the actual NSIS-installed and portable products. Never packaged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from './qa-playwright-bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = key => { const index = process.argv.indexOf(key); return index === -1 ? undefined : process.argv[index + 1]; };
const installed = path.resolve(option('--installed') || path.join(root, 'tmp/installed-qa/Japanese-Kana-Review.exe'));
const portable = path.resolve(option('--portable') || path.join(root, 'dist/Japanese-Kana-Review-1.0.0-win-x64-portable.exe'));
const profile = path.join(root, 'tmp/desktop-qa/wrapper-shared');
const reportPath = path.join(root, 'tmp/desktop-qa/wrapper-proof.json');
assert.ok(path.relative(path.join(root, 'tmp/installed-qa'), installed) === 'Japanese-Kana-Review.exe');
const environment = { ...process.env, KANA_TEST_DATA_DIR: profile,
  PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}` };
delete environment.ELECTRON_RUN_AS_NODE;
const report = { date: new Date().toISOString(), profile, checks: [] };
const hash = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
const record = value => { report.checks.push(value); console.log(value); };
let application;
let secondLauncher;

async function launch(filename) {
  application = await _electron.launch({ executablePath: filename, args: [], env: environment,
    cwd: root, chromiumSandbox: true, timeout: 60000 });
  const page = await application.firstWindow();
  await page.locator('#mode-start').waitFor();
  assert.equal(page.url(), 'app://kana/');
  await application.context().setOffline(true);
  const identity = await application.evaluate(({ app, BrowserWindow }) => ({
    pid: process.pid, execPath: process.execPath, appPath: app.getAppPath(), profile: app.getPath('userData'),
    version: app.getVersion(), bounds: BrowserWindow.getAllWindows()[0].getBounds(),
  }));
  assert.equal(path.normalize(identity.profile), profile);
  assert.equal(identity.version, '1.0.0');
  return { page, identity };
}

try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const first = await launch(installed);
  report.installed = first.identity;
  const initial = await first.page.evaluate(async () => {
    const storage = await import('./js/storage.js');
    storage.setCourseUntil(15);
    storage.recordRating('so', 'known');
    storage.saveSettings({ selectedMode: 'review', reviewCategories: ['basic'], reviewCount: 20 });
    return storage.loadState();
  });
  await application.evaluate(({ app }) => {
    globalThis.kanaQaSecondInstance = 0;
    app.once('second-instance', () => { globalThis.kanaQaSecondInstance += 1; });
  });
  secondLauncher = spawn(portable, [], { env: environment, cwd: root, windowsHide: true, stdio: 'ignore' });
  const exit = await Promise.race([
    new Promise(resolve => secondLauncher.once('exit', code => resolve(code))),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 20000)),
  ]);
  assert.equal(exit, 0, 'Second actual portable launcher must exit while installed instance remains');
  const single = await application.evaluate(({ BrowserWindow }) => ({
    secondInstance: globalThis.kanaQaSecondInstance,
    windows: BrowserWindow.getAllWindows().length,
    focused: BrowserWindow.getAllWindows()[0].isFocused(),
  }));
  assert.equal(single.secondInstance, 1);
  assert.equal(single.windows, 1);
  assert.equal(single.focused, true);
  report.singleInstance = single;
  record('Launching actual portable beside installed app focused the existing single window and exited.');
  await application.close(); application = null;

  const second = await launch(portable);
  report.portable = second.identity;
  const fromPortable = await second.page.evaluate(() => JSON.parse(localStorage.getItem('kana-flashcards-v1')));
  assert.deepEqual(fromPortable, initial);
  const installedHash = await hash(first.identity.appPath);
  const portableHash = await hash(second.identity.appPath);
  assert.equal(portableHash, installedHash);
  report.asarSha256 = installedHash;
  record('Installed and actual portable have byte-identical ASARs and share the exact persisted learning state.');
  const changed = await second.page.evaluate(async () => {
    const storage = await import('./js/storage.js');
    storage.recordRating('shi', 'fuzzy');
    return storage.loadState();
  });
  await application.close(); application = null;

  const third = await launch(installed);
  assert.deepEqual(await third.page.evaluate(() => JSON.parse(localStorage.getItem('kana-flashcards-v1'))), changed);
  record('Learning state changed in actual portable persisted exactly when the installed app reopened.');
  await application.close(); application = null;
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'Local State'), 'utf8')).profile?.info_cache ?? {}, {});
  report.passed = true;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`QA proof: ${path.relative(root, reportPath)}`);
} finally {
  if (secondLauncher?.exitCode === null) secondLauncher.kill();
  await application?.close();
}
