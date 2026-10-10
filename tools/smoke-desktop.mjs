// Optional end-to-end QA. Install Playwright or set PLAYWRIGHT_MODULE to its entry file.
// Uses only a task-local profile and never reads the production learning profile.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as storage from '../js/storage.js';
import { serializeBackup, parseBackup } from '../js/backup.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = name => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
const executable = path.resolve(option('--executable') ?? path.join(root, 'node_modules/electron/dist/electron.exe'));
const profile = path.resolve(option('--profile') ?? path.join(root, 'tmp/desktop-qa/profile'));
const qaRoot = path.join(root, 'tmp/desktop-qa');
assert.ok(profile.startsWith(qaRoot + path.sep), 'QA profile must stay within tmp/desktop-qa');
const output = path.join(qaRoot, `${Date.now()}`);
await mkdir(output, { recursive: true });
const moduleUrl = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
const { _electron } = await import(moduleUrl);
const release = (await readFile(path.join(root, 'js/app.js'), 'utf8')).match(/data\.js\?v=([^'";]+)/)[1];
const memory = new Map();
const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
storage.setCourseUntil(20, store);
storage.joinCategory('youon', store);
storage.recordRating('so', 'fuzzy', store);
storage.saveSettings({ selectedMode: 'review', reviewCategories: ['basic', 'youon'], reviewCount: 20, reviewRangeStart: 16, reviewRangeEnd: 35 }, store);
const stateA = storage.loadState(store);
const backupA = path.join(output, 'fixture-a.json');
await writeFile(backupA, serializeBackup(stateA));
storage.setCourseUntil(10, store);
storage.saveSettings({ reviewCategories: ['basic'], reviewRangeStart: 1, reviewRangeEnd: null }, store);
const stateB = storage.loadState(store);
const backupB = path.join(output, 'fixture-b.json');
await writeFile(backupB, serializeBackup(stateB));
const invalid = path.join(output, 'invalid.json');
await writeFile(invalid, '{broken json');
let application;
let page;
const errors = [];
const report = { executable: path.basename(executable), startedAt: new Date().toISOString(), checks: [] };
const record = message => { report.checks.push(message); console.log(message); };
const cleanEnvironment = { ...process.env, KANA_TEST_DATA_DIR: profile };
delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
if (!executable.endsWith(`${path.sep}electron.exe`)) cleanEnvironment.PATH = `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`;

async function launch() {
  application = await _electron.launch({ executablePath: executable, cwd: root,
    args: executable.endsWith(`${path.sep}electron.exe`) ? ['.'] : [], env: cleanEnvironment,
    chromiumSandbox: true, timeout: 60000 });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#mode-start').waitFor();
  assert.equal(page.url(), 'app://kana/');
  const info = await application.evaluate(({ app, BrowserWindow }) => ({
    version: app.getVersion(), profile: app.getPath('userData'), preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(info.version, '1.0.0');
  assert.equal(path.normalize(info.profile), profile);
  assert.equal(info.preferences.nodeIntegration, false);
  assert.equal(info.preferences.contextIsolation, true);
  assert.equal(info.preferences.sandbox, true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await application.context().setOffline(true);
  await page.evaluate(() => { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); });
}
const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storage.STORAGE_KEY);
async function openSettings() { if (!await page.locator('#settings-dialog').evaluate(element => element.open)) await page.locator('#open-settings').click(); }
async function closeSettings() { await page.locator('#settings-dialog button[aria-label="关闭"]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' }); }
async function importFile(file) {
  await openSettings();
  await page.locator('#backup-file').setInputFiles(file);
  await page.locator('#backup-confirm').waitFor({ state: 'visible' });
  await page.locator('#confirm-backup').click();
  await page.locator('#backup-confirm').waitFor({ state: 'hidden' });
}

try {
  await launch();
  record('Local app scheme, version, isolated profile and renderer sandbox verified.');
  if (process.argv.includes('--check-licenses')) {
    await openSettings();
    await page.locator('#license-details summary').click();
    await page.locator('#license-text').filter({ hasText: 'MIT License' }).waitFor();
    assert.match(await page.locator('#license-text').innerText(), /VOICEVOX:四国めたん/);
    assert.match(await page.locator('#license-text').innerText(), /后续使用者/);
    await closeSettings();
    record('Full code and audio license terms are readable inside the offline app.');
  }
  await importFile(backupA);
  assert.deepEqual(await stored(), stateA);
  record('Web-format backup imported through file input and confirmation UI.');
  await page.locator('#backup-file').setInputFiles(invalid);
  await page.locator('#backup-status').filter({ hasText: 'JSON' }).waitFor();
  assert.deepEqual(await stored(), stateA);
  assert.equal(await page.locator('#backup-confirm').evaluate(element => element.open), false);
  record('Broken backup rejected without changing current progress.');
  await importFile(backupB);
  assert.deepEqual(await stored(), stateB);
  await page.locator('#recover-backup').click();
  await page.locator('#confirm-backup').click();
  await page.locator('#backup-confirm').waitFor({ state: 'hidden' });
  assert.deepEqual(await stored(), stateA);
  record('Import overwrite preserved the previous state and recovery restored it.');
  if (process.argv.includes('--check-storage-edges')) {
    await page.evaluate(key => {
      const state = JSON.parse(localStorage.getItem(key));
      state.records.a.firstSeenAt = 'invalid-date';
      localStorage.setItem(key, JSON.stringify(state));
    }, storage.STORAGE_KEY);
    await page.locator('#recover-backup').click();
    await page.locator('#backup-confirm').waitFor({ state: 'visible' });
    assert.match(await page.locator('#backup-current').innerText(), /无效字段/);
    await page.locator('#confirm-backup').click();
    await page.locator('#backup-confirm').waitFor({ state: 'hidden' });
    assert.deepEqual(await stored(), stateA);
    record('Valid recovery stays accessible when the current state contains an invalid date.');
  }

  const exported = path.join(output, 'exported.json');
  await application.evaluate(({ session }, filename) => {
    globalThis.kanaQaExportState = null;
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(filename);
      item.once('done', (_downloadEvent, state) => { globalThis.kanaQaExportState = state; });
    });
  }, exported);
  await page.locator('#export-backup').click();
  let downloadState;
  for (let attempt = 0; attempt < 60; attempt++) {
    downloadState = await application.evaluate(() => globalThis.kanaQaExportState);
    if (downloadState !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(downloadState, 'completed', 'Electron native DownloadItem must complete');
  assert.deepEqual(parseBackup(await readFile(exported, 'utf8')).state, stateA);
  record('Backup export generated a valid complete JSON file.');
  await closeSettings();
  await page.locator('#mode-start').click();
  for (let index = 0; index < 20; index++) {
    assert.equal(await page.locator('#stage-position').innerText(), `${index + 1} / 20`);
    await page.locator('[data-action="reveal-card"]').press('Space');
    await page.locator(`[data-rating="${index === 0 ? 'unknown' : index === 1 ? 'fuzzy' : 'known'}"]`).click();
  }
  assert.equal(await page.locator('#summary-title').innerText(), '20 题');
  const summary = await page.locator('#summary-stats .stat b').allTextContents();
  assert.deepEqual(summary, ['18', '1', '1', '90%']);
  record('Complete 20-card offline review, keyboard reveal, ratings and summary verified.');
  await page.locator('[data-summary-action="home"]').click();

  if (!process.argv.includes('--skip-audio')) {
    const completePlayback = process.argv.includes('--complete-audio');
    const audioResults = await page.evaluate(async ({ version, completePlayback }) => {
      const { STUDY_ITEMS } = await import(`./js/data.js?v=${version}`);
      const { playStudyItem, stopStudyAudio } = await import(`./js/audio.js?v=${version}`);
      const context = new AudioContext();
      const results = [];
      for (const item of STUDY_ITEMS) {
        const response = await fetch(`assets/audio/${item.id}.wav`);
        if (!response.ok) throw new Error(`Audio not found: ${item.id}`);
        const decoded = await context.decodeAudioData(await response.arrayBuffer());
        const signal = decoded.getChannelData(0);
        if (!signal.some(value => Math.abs(value) > 0.001)) throw new Error(`Silent audio: ${item.id}`);
        const result = await playStudyItem(item, { manual: true });
        if (!result.ok || result.method !== 'local') throw new Error(`Not local playback: ${item.id}`);
        if (completePlayback && !result.player.ended) await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Playback stalled: ${item.id}`)), 5000);
          result.player.addEventListener('ended', () => { clearTimeout(timeout); resolve(); }, { once: true });
          result.player.addEventListener('error', () => { clearTimeout(timeout); reject(new Error(`Playback failed: ${item.id}`)); }, { once: true });
        });
        results.push({ id: item.id, duration: decoded.duration, channels: decoded.numberOfChannels });
        stopStudyAudio();
      }
      await context.close();
      return results;
    }, { version: release, completePlayback });
    assert.equal(audioResults.length, 128);
    await writeFile(path.join(output, 'audio-results.json'), JSON.stringify(audioResults, null, 2));
    record(`All 128 WAVs fetched, decoded, non-silent and ${completePlayback ? 'completed' : 'started'} local playback while offline with speech synthesis unavailable.`);
  }

  await page.locator('[data-mode="browse"]').click();
  await page.locator('[data-browse-category="handakuten"]').click();
  await page.locator('#mode-start').click();
  for (let index = 0; index < 5; index++) await page.locator('[data-action="browse-next"]').click();
  await page.locator('[data-action="join-category"]').click();
  assert.equal((await stored()).categoryStatus.handakuten, 'joined');
  record('Browse and join-category flow verified.');
  await page.locator('[data-mode="test"]').click();
  await page.locator('[data-setting="testCount"][data-value="infinite"]').click();
  await page.locator('#mode-start').click();
  await page.locator('[data-action="reveal-card"]').click();
  await page.locator('[data-rating="known"]').click();
  await page.locator('[data-action="finish-session"]').click();
  assert.equal(await page.locator('#summary-title').innerText(), '1 题');
  await page.locator('[data-summary-action="home"]').click();
  record('Custom infinite test can be rated and ended with correct summary.');
  await page.locator('nav [data-view="table"]').click();
  await page.locator('[data-table-tab="youon"]').click();
  await page.locator('[data-item="youon-kya"]').click();
  assert.match(await page.locator('#kana-detail').innerText(), /kya/);
  await page.locator('nav [data-view="records"]').click();
  assert.equal(await page.locator('#record-overview .stat').count(), 4);
  await page.locator('.brand').click();
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  const finalState = await stored();
  await application.close(); application = null;
  await launch();
  assert.deepEqual(await stored(), finalState);
  record('Closing and relaunching preserved the exact learning state.');
  if (process.argv.includes('--check-storage-edges')) {
    await openSettings();
    await page.evaluate(key => {
      window.kanaQaOriginalRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (name) {
        if (name === key) throw new DOMException('QA storage deletion blocked', 'SecurityError');
        return window.kanaQaOriginalRemove.call(this, name);
      };
    }, storage.STORAGE_KEY);
    await page.locator('#reset').click();
    await page.locator('#confirm-reset').click();
    await page.locator('#reset-status').waitFor({ state: 'visible' });
    assert.match(await page.locator('#reset-status').innerText(), /未能确认/);
    assert.equal(await page.locator('#confirm').evaluate(element => element.open), true);
    assert.deepEqual(await stored(), finalState);
    await page.evaluate(() => { Storage.prototype.removeItem = window.kanaQaOriginalRemove; delete window.kanaQaOriginalRemove; });
    await page.locator('#confirm-reset').click();
    await page.locator('#confirm').waitFor({ state: 'hidden' });
    assert.equal(await stored(), null);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storage.RECOVERY_STORAGE_KEY), null);
    record('Blocked durable deletion is reported in the UI; retry removes both main and recovery records.');
  }
  assert.deepEqual(errors, []);
  report.finishedAt = new Date().toISOString();
  report.passed = true;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`QA report: ${path.relative(root, path.join(output, 'report.json'))}`);
} finally {
  await application?.close();
}
