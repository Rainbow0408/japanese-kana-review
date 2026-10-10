import { BASIC_KANA, CATEGORIES, CATEGORY_IDS, STUDY_ITEMS, itemById, itemsByCategory } from './data.js?v=20261010-1';
import { buildRangedReviewPool, buildReviewPool, buildSummary, createSession, displayForItem, nextCard, rateCard } from './flashcards.js?v=20261010-1';
import { getBrowseItem, isBrowseComplete, nextBrowseIndex, previousBrowseIndex } from './new-learning.js?v=20261010-1';
import {
  finishBrowsing, isWeakRecord, joinCategory, loadState, markSeen, proficiencyFor,
  recordRating, resetStateWithResult, saveBrowseProgress, saveSettings, setCourseUntil, isStoragePersistent,
} from './storage.js?v=20261010-1';
import { playStudyItem, registerAudioInteraction, stopStudyAudio } from './audio.js?v=20261010-1';
import { resolveFlashcardSpaceAction } from './keyboard.js?v=20261010-1';
import { normalizeReviewRange, reviewRangeSummary, updateReviewRange } from './review-range.js?v=20261010-1';
import { MAX_BACKUP_BYTES, backupSummary, currentBackupSummary, getRecoveryBackup, importBackup, parseBackup, recoverBackup, serializeBackup } from './backup.js?v=20261010-1';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const scriptOptions = [['mixed', '平 + 片'], ['hiragana', '仅平假名'], ['katakana', '仅片假名']];
const countOptions = [[20, '20'], [30, '30'], [50, '50'], [100, '100'], ['infinite', '无限']];
const statusCopy = { not_started: '未开始', browsing: '浏览中', browsed: '已浏览', joined: '已加入复习' };
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const desktopApp = globalThis.location?.protocol === 'app:';
const storagePlace = desktopApp ? '当前电脑' : '当前浏览器';

let state = loadState();
let selectedMode = state.settings.selectedMode;
let flow = null;
let lastSummary = null;
let currentAudioItem = null;
let audioNoticeTimer = null;
let audioRequest = 0;
let tableTab = 'basic';
let pendingBackup = null;
let backupBusy = false;

const itemForm = (item) => item.kana ?? `${item.hiragana} / ${item.katakana}`;
const pairedForm = (item) => item.kana ?? `${item.hiragana}　${item.katakana}`;
const learnedFor = (item) => item.category === 'basic' ? item.index <= state.courseUntil : Boolean(state.records[item.id]?.learned);
const learnedPool = (categories = CATEGORY_IDS) => buildReviewPool(STUDY_ITEMS, state, categories, { learnedOnly: true });
const weakPool = (categories = CATEGORY_IDS) => buildReviewPool(STUDY_ITEMS, state, categories, { learnedOnly: true, weakOnly: true });
const availableCategories = () => CATEGORY_IDS.filter((id) => learnedPool([id]).length > 0);

function activate(name) {
  clearPracticeAudio();
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === name));
  updateNavigation(name);
  if (name === 'home') { flow = null; state = loadState(); selectedMode = state.settings.selectedMode; renderHome(); }
  if (name === 'table') renderTable();
  if (name === 'records') renderRecords();
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}

function activateWithoutReset(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === name));
  updateNavigation(name);
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}

function updateNavigation(name) {
  $$('.site-header nav [data-view]').forEach((button) => {
    button.classList.toggle('current', button.dataset.view === name);
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function segment(name, options, selected) {
  return `<div class="segment">${options.map(([value, label]) => `<button type="button" data-setting="${name}" data-value="${value}" aria-pressed="${String(value) === String(selected)}" class="${String(value) === String(selected) ? 'selected' : ''}">${label}</button>`).join('')}</div>`;
}

function categoryChecks(name, selected, learnedOnly = false) {
  const enabled = new Set(availableCategories());
  return `<div class="category-checks">${CATEGORY_IDS.map((id) => {
    const disabled = learnedOnly && !enabled.has(id);
    return `<label class="category-check ${disabled ? 'disabled' : ''}"><input type="checkbox" data-category-setting="${name}" value="${id}" ${selected.includes(id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><b>${CATEGORIES[id].label}</b><small>${disabled ? '尚未加入复习池' : `${learnedOnly ? learnedPool([id]).length : itemsByCategory(id).length} 项`}</small></span></label>`;
  }).join('')}</div>`;
}

function reviewSourcePool() {
  return buildReviewPool(STUDY_ITEMS, state, state.settings.reviewCategories, { learnedOnly: true });
}

function currentReviewRange(pool = reviewSourcePool()) {
  return normalizeReviewRange(pool.length, state.settings.reviewRangeStart, state.settings.reviewRangeEnd);
}

function rangeControlsTemplate(pool, location = 'home') {
  const range = currentReviewRange(pool);
  const disabled = pool.length === 0 ? 'disabled' : '';
  const maximum = Math.max(1, pool.length);
  const start = range.start || 1;
  const end = range.end || 1;
  return `<div class="review-range-controls" data-range-location="${location}">
    <div class="setting-heading"><b>复习范围</b><span class="review-range-summary">${reviewRangeSummary(pool.length, range.start, range.endSetting)}</span></div>
    <div class="range-bound"><label>从第 <input type="number" min="1" max="${maximum}" value="${start}" data-review-range-bound="start" aria-label="复习范围起点" ${disabled}> 项开始</label><input type="range" min="1" max="${maximum}" value="${start}" data-review-range-bound="start" aria-label="拖动选择复习范围起点" ${disabled}></div>
    <div class="range-bound"><label>到第 <input type="number" min="1" max="${maximum}" value="${end}" data-review-range-bound="end" aria-label="复习范围终点" ${disabled}> 项结束</label><input type="range" min="1" max="${maximum}" value="${end}" data-review-range-bound="end" aria-label="拖动选择复习范围终点" ${disabled}></div>
    <div class="range-actions"><button type="button" data-action="all-review-range" ${disabled}>全部范围</button><button type="button" data-action="open-review-range" ${disabled}>查看全部假名</button></div>
    <p class="hint">按已勾选类别的固定顺序合并后截取，起点和终点都包含在内。</p>
  </div>`;
}

function rangePreviewTemplate(pool) {
  const range = currentReviewRange(pool);
  let offset = 0;
  return CATEGORY_IDS.map((category) => {
    const items = pool.filter((item) => item.category === category);
    if (!items.length) return '';
    const cells = items.map((item, localIndex) => {
      const index = offset + localIndex + 1;
      const selected = index >= range.start && index <= range.end;
      return `<div class="range-item ${selected ? 'selected' : ''}" role="option" aria-selected="${selected}"><span class="range-item-index">${index}</span><b>${itemForm(item)}</b><small>${item.romaji}</small>${selected ? '<em>已选</em>' : ''}</div>`;
    }).join('');
    offset += items.length;
    return `<section class="range-category"><h3>${CATEGORIES[category].label}<span>${items.length} 项</span></h3><div class="range-items">${cells}</div></section>`;
  }).join('');
}

function syncReviewRangeUi() {
  const pool = reviewSourcePool();
  const range = currentReviewRange(pool);
  const maximum = Math.max(1, pool.length);
  $$('[data-review-range-bound]').forEach((input) => {
    input.max = String(maximum);
    input.disabled = pool.length === 0;
    input.value = String(input.dataset.reviewRangeBound === 'start' ? (range.start || 1) : (range.end || 1));
  });
  $$('.review-range-summary').forEach((element) => { element.textContent = reviewRangeSummary(pool.length, range.start, range.endSetting); });
  if ($('#review-range-dialog').open) $('#review-range-grid').innerHTML = rangePreviewTemplate(pool);
}

function changeReviewRange(bound, value, persist = false) {
  const pool = reviewSourcePool();
  const range = updateReviewRange(pool.length, state.settings.reviewRangeStart, state.settings.reviewRangeEnd, bound, value);
  state.settings.reviewRangeStart = range.start || 1;
  state.settings.reviewRangeEnd = range.endSetting;
  if (persist) state = saveSettings({ reviewRangeStart: state.settings.reviewRangeStart, reviewRangeEnd: state.settings.reviewRangeEnd });
  syncReviewRangeUi();
}

function saveAllReviewRange() {
  state = saveSettings({ reviewRangeStart: 1, reviewRangeEnd: null });
  syncReviewRangeUi();
}

function openReviewRangeDialog() {
  const pool = reviewSourcePool();
  $('#review-range-dialog-controls').innerHTML = rangeControlsTemplate(pool, 'dialog');
  $('#review-range-grid').innerHTML = rangePreviewTemplate(pool);
  $('#review-range-dialog').showModal();
}

function renderDashboard() {
  state = loadState();
  updateStorageNotice();
  const learned = learnedPool();
  const weak = weakPool();
  $('#dashboard-learned').textContent = `${learned.length} / ${STUDY_ITEMS.length}`;
  $('#dashboard-weak').textContent = String(weak.length);
  $('#dashboard-progress').style.width = `${learned.length / STUDY_ITEMS.length * 100}%`;
  $('.dashboard-progress').setAttribute('aria-valuenow', String(learned.length));
  $('.dashboard-progress').setAttribute('aria-valuemax', String(STUDY_ITEMS.length));
  $('#dashboard-advice').textContent = weak.length ? `有 ${weak.length} 项需要加强，可以直接只练薄弱项。` : learned.length ? '状态不错，开始一轮快速复习吧。' : '从“快速过新内容”开始，学完再加入复习。';
  $('#category-overview').innerHTML = CATEGORY_IDS.map((id) => {
    const items = itemsByCategory(id);
    const learnedCount = items.filter(learnedFor).length;
    const status = state.categoryStatus[id];
    return `<div class="category-status" data-status="${status}"><span>${CATEGORIES[id].label}</span><b>${learnedCount} / ${items.length}</b><small>${statusCopy[status]}</small><div class="category-mini" aria-hidden="true"><i style="width:${learnedCount / items.length * 100}%"></i></div></div>`;
  }).join('');
  $$('.mode-card').forEach((card) => {
    const active = card.dataset.mode === selectedMode;
    card.classList.toggle('selected', active);
    card.setAttribute('aria-pressed', String(active));
  });
  const allJoined = CATEGORY_IDS.every((id) => state.categoryStatus[id] === 'joined');
  $('#all-start').hidden = !allJoined;
  $('#weak-start').disabled = weak.length === 0;
  $('#weak-start').title = weak.length ? `共 ${weak.length} 项` : '暂时没有明显薄弱内容。';
}

function updateStorageNotice() {
  const persistent = isStoragePersistent();
  $('#storage-note').textContent = persistent ? `无需登录 · 学习记录保存在${storagePlace}` : `${storagePlace}无法保存 · 记录仅在本次打开期间保留`;
  $('#storage-note').classList.toggle('danger', !persistent);
  $('#storage-setting-note').textContent = persistent ? `学习记录只保存在${storagePlace}中。` : `${storagePlace}无法保存数据，记录仅在本次打开期间保留。`;
  $('#record-storage-label').textContent = persistent ? `保存在${storagePlace}` : '仅在本次打开期间保留';
}

function setBackupStatus(message, failure = false) {
  $('#backup-status').textContent = message;
  $('#backup-status').classList.toggle('danger', failure);
  $('#backup-status').hidden = false;
}

function refreshRecoveryControl() {
  $('#export-backup').disabled = backupBusy;
  $('#import-backup').disabled = backupBusy;
  try {
    const recovery = getRecoveryBackup();
    $('#recover-backup').disabled = backupBusy || !recovery;
    $('#recovery-note').textContent = recovery ? `可恢复到 ${new Date(recovery.exportedAt).toLocaleString('zh-CN')} 导入前保存的记录。每次导入会更新这份副本。` : '尚无导入前记录可恢复。';
  } catch {
    $('#recover-backup').disabled = true;
    $('#recovery-note').textContent = '导入前恢复副本无法读取，请使用已导出的备份文件。';
  }
}

function exportCurrentBackup() {
  let url;
  let link;
  try {
    const now = new Date().toISOString();
    const text = serializeBackup(loadState(), now);
    url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    link = document.createElement('a');
    link.href = url;
    link.download = `kana-review-backup-${now.slice(0, 10)}-${now.slice(11, 19).replaceAll(':', '')}.json`;
    document.body.append(link);
    link.click();
    setBackupStatus('备份文件已准备好，请完成保存或查看下载文件。');
  } catch (error) {
    setBackupStatus(`无法导出备份：${error.message}`, true);
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function showBackupPreview(value, kind, source) {
  const summary = backupSummary(value);
  const current = currentBackupSummary(loadState());
  pendingBackup = { value, kind };
  $('#backup-confirm-title').textContent = kind === 'recover' ? '恢复导入前记录' : '导入备份预览';
  $('#backup-source').textContent = source;
  const rows = [
    ['备份时间', new Date(summary.exportedAt).toLocaleString('zh-CN')],
    ['基础五十音进度', `${summary.courseUntil} / 46`],
    ['已加入复习', `${summary.learnedCount} / ${STUDY_ITEMS.length} 项`],
    ['完整加入复习的类别', `${summary.joinedCategories} / ${CATEGORY_IDS.length}`],
    ['历史记录', `${summary.recordCount} 项 · 复习 ${summary.totalReviews} 次`],
    ['浏览进度', summary.browseProgress ? `${CATEGORIES[summary.browseProgress.category].label} · ${summary.browseProgress.position} / ${summary.browseProgress.total}` : '没有未完成的浏览'],
  ];
  $('#backup-preview').replaceChildren(...rows.map(([label, content]) => {
    const row = document.createElement('div');
    const name = document.createElement('dt');
    const detail = document.createElement('dd');
    name.textContent = label;
    detail.textContent = content;
    row.append(name, detail);
    return row;
  }));
  $('#backup-current').textContent = current
    ? `当前记录：已加入复习 ${current.learnedCount} 项，历史复习 ${current.totalReviews} 次。`
    : '当前记录含有无效字段，无法生成摘要。仍可使用已验证的导入前副本恢复记录。';
  $('#backup-confirm-description').textContent = kind === 'recover' ? '确认恢复会用上次导入前保存的数据覆盖当前全部设置和学习记录。请先导出当前记录，以便日后保留。' : '确认导入会覆盖当前全部设置和学习记录。覆盖前会保留一份旧数据，可从设置中恢复。';
  $('#confirm-backup').textContent = kind === 'recover' ? '确认覆盖并恢复' : '确认覆盖并导入';
  $('#backup-confirm-status').hidden = true;
  $('#backup-confirm').showModal();
}

async function readBackupFile() {
  const file = $('#backup-file').files?.[0];
  if (!file || backupBusy) return;
  backupBusy = true;
  refreshRecoveryControl();
  setBackupStatus('正在检查备份文件…');
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 1 MiB。');
    const value = parseBackup(await file.text());
    showBackupPreview(value, 'import', file.name);
    setBackupStatus('备份检查通过，请在预览中确认是否覆盖当前记录。');
  } catch (error) {
    setBackupStatus(`无法导入备份：${error.message}`, true);
  } finally {
    $('#backup-file').value = '';
    backupBusy = false;
    refreshRecoveryControl();
  }
}

function confirmBackupOverwrite() {
  if (!pendingBackup || backupBusy) return;
  const kind = pendingBackup.kind;
  try {
    state = kind === 'recover' ? recoverBackup() : importBackup(pendingBackup.value);
    selectedMode = state.settings.selectedMode;
    lastSummary = null;
    $('#manual-progress').value = state.courseUntil;
    $('#backup-confirm').close();
    activate('home');
    setBackupStatus(kind === 'recover' ? '已恢复导入前记录，设置和进度已更新。' : '备份已导入，设置和进度已更新。可使用“恢复导入前记录”撤回这次导入。');
  } catch (error) {
    $('#backup-confirm-status').textContent = error.message;
    $('#backup-confirm-status').hidden = false;
    setBackupStatus(error.message, true);
    updateStorageNotice();
  }
  refreshRecoveryControl();
}

function reviewSettingsTemplate() {
  const settings = state.settings;
  const pool = reviewSourcePool();
  return `<div class="settings-grid review-settings">
    <div class="setting-block category-setting"><div class="setting-heading"><b>今天复习什么？</b><button type="button" class="text compact" data-action="select-all-learned">全选已学</button></div>${categoryChecks('reviewCategories', settings.reviewCategories, true)}</div>
    <div class="setting-block"><b>假名形式</b>${segment('reviewScript', scriptOptions, settings.reviewScript)}</div>
    <div class="setting-block"><b>题目数量</b>${segment('reviewCount', countOptions, settings.reviewCount)}</div>
    <div class="setting-block"><b>出题方式</b>${segment('reviewMode', [['smart', '智能复习'], ['uniform', '均匀随机']], settings.reviewMode)}<span class="hint">优先复习模糊和不认识的内容</span></div>
    <div class="setting-block review-range-setting">${rangeControlsTemplate(pool)}</div>
  </div>`;
}

function browseSettingsTemplate() {
  const current = state.settings.browseCategory;
  return `<div class="browse-picker"><div class="setting-heading"><b>选择要快速浏览的内容</b><span class="hint">浏览完成后再加入复习池</span></div><div class="browse-category-grid">${CATEGORY_IDS.map((id) => {
    const status = state.categoryStatus[id];
    return `<button type="button" data-browse-category="${id}" aria-pressed="${id === current}" class="browse-category ${id === current ? 'selected' : ''}"><b>${CATEGORIES[id].label}</b><span>${itemsByCategory(id).length} 项</span><small>${statusCopy[status]}</small></button>`;
  }).join('')}</div></div>`;
}

function testSettingsTemplate() {
  const settings = state.settings;
  return `<div class="settings-grid">
    <div class="setting-block category-setting"><b>测试内容</b>${categoryChecks('testCategories', settings.testCategories)}</div>
    <div class="setting-block"><b>假名形式</b>${segment('testScript', scriptOptions, settings.testScript)}</div>
    <div class="setting-block"><b>题目数量</b>${segment('testCount', countOptions, settings.testCount)}</div>
    <div class="setting-block"><b>出题方式</b>${segment('testMode', [['uniform', '均匀随机'], ['smart', '智能随机']], settings.testMode)}</div>
  </div>`;
}

function renderModeSettings() {
  $('#mode-message').hidden = true;
  $('#mode-settings').innerHTML = selectedMode === 'review' ? reviewSettingsTemplate() : selectedMode === 'browse' ? browseSettingsTemplate() : testSettingsTemplate();
  const start = $('#mode-start');
  start.textContent = selectedMode === 'review' ? '开始复习' : selectedMode === 'browse' ? (state.browseProgress?.category === state.settings.browseCategory ? '继续浏览' : '开始浏览') : '开始测试';
  start.disabled = selectedMode === 'review' ? learnedPool(state.settings.reviewCategories).length === 0 : selectedMode === 'test' ? state.settings.testCategories.length === 0 : false;
  $('#weak-start').hidden = selectedMode !== 'review';
  $('#mode-panel-title').textContent = selectedMode === 'review' ? '安排这一轮复习' : selectedMode === 'browse' ? '认识一组新的假名' : '定制你的闪卡测试';
  $('#mode-panel-description').textContent = selectedMode === 'review' ? '选好内容，开始一轮专注的复习。' : selectedMode === 'browse' ? '先看字形、听读音，学完后就能加入复习池。' : '已学和未学内容都可以选，按自己的节奏检验记忆。';
  if (selectedMode === 'review' && start.disabled) setModeMessage(learnedPool().length ? '请至少勾选一个已学类别，或点击“全选已学”。' : '还没有可复习的内容。先选择“快速过新内容”，或在设置中填写已学进度。');
}

function renderHome() { renderDashboard(); renderModeSettings(); }

function setModeMessage(message) {
  $('#mode-message').textContent = message;
  $('#mode-message').hidden = false;
}

function saveSetting(name, rawValue) {
  const numeric = ['reviewCount', 'testCount'];
  const value = rawValue === 'infinite' ? 'infinite' : numeric.includes(name) ? Number(rawValue) : rawValue;
  state = saveSettings({ [name]: value });
  renderHome();
}

function toggleCategorySetting(name, category, checked) {
  const selected = new Set(state.settings[name]);
  if (checked) selected.add(category); else selected.delete(category);
  state = saveSettings({ [name]: CATEGORY_IDS.filter((id) => selected.has(id)) });
  if (name === 'reviewCategories') {
    const pool = reviewSourcePool();
    const range = currentReviewRange(pool);
    state = saveSettings({ reviewRangeStart: range.start || 1, reviewRangeEnd: range.endSetting });
  }
  renderHome();
}

function preparePractice(label, position = '', trail = '') {
  clearPracticeAudio();
  $('#stage-label').textContent = label;
  $('#stage-position').textContent = position;
  $('#group-trail').textContent = trail;
  $('#practice-feedback').textContent = '';
  $('#practice-feedback').className = 'feedback';
  $('#audio-note').hidden = true;
  $('#replay-audio').hidden = true;
  currentAudioItem = null;
  activateWithoutReset('flashcards');
}

function clearPracticeAudio() {
  audioRequest += 1;
  clearTimeout(audioNoticeTimer);
  stopStudyAudio();
  currentAudioItem = null;
  $('#audio-note').hidden = true;
  $('#replay-audio').hidden = true;
}

async function tryPlayAudio(item, manual = false) {
  const request = ++audioRequest;
  clearTimeout(audioNoticeTimer);
  $('#audio-note').hidden = true;
  currentAudioItem = item;
  $('#replay-audio').hidden = false;
  const result = await playStudyItem(item, { manual });
  if (request !== audioRequest) return;
  if (result.ok) { $('#audio-note').hidden = true; return; }
  $('#audio-note').textContent = '发音暂时无法自动播放，可点击重播按钮。';
  $('#audio-note').hidden = false;
  clearTimeout(audioNoticeTimer);
  audioNoticeTimer = setTimeout(() => { $('#audio-note').hidden = true; }, 3600);
}

function highlightFocus(item) {
  if (!item.focus) return item.kana ?? '';
  return (item.kana ?? '').split(item.focus).join(`<mark>${item.focus}</mark>`);
}

function answerMeta(item) {
  if (item.kana) return `<p lang="ja" class="focus-kana">${highlightFocus(item)}</p><p class="rule-note">${item.explanation}</p>${item.standardRomaji ? `<p class="kana-meta">标准长音写法：${item.standardRomaji}</p>` : ''}`;
  return `<p class="kana-meta">平假名：${item.hiragana}　片假名：${item.katakana}</p>`;
}

function ratingButtons() {
  return `<div class="ratings"><button data-rating="known">${icon('check')}认识<kbd aria-hidden="true">1</kbd></button><button data-rating="fuzzy">${icon('help')}模糊<kbd aria-hidden="true">2</kbd></button><button data-rating="unknown">${icon('close')}不认识<kbd aria-hidden="true">3</kbd></button></div>`;
}

function startCurrentMode() {
  registerAudioInteraction();
  state = saveSettings({ selectedMode });
  if (selectedMode === 'review') startReview();
  if (selectedMode === 'browse') startBrowse();
  if (selectedMode === 'test') startTest();
}

function startBrowse() {
  state = loadState();
  const category = state.settings.browseCategory;
  const group = itemsByCategory(category);
  const index = state.browseProgress?.category === category ? state.browseProgress.index : 0;
  state = saveBrowseProgress(category, index);
  flow = { kind: 'browse', category, group, index };
  renderBrowseCard();
}

function renderBrowseCard() {
  const item = getBrowseItem(flow.group, flow.index);
  state = markSeen(item.id);
  state = saveBrowseProgress(flow.category, flow.index);
  preparePractice(`快速浏览 · ${CATEGORIES[flow.category].label}`, `${flow.index + 1} / ${flow.group.length}`, '直接看字形和读音，快速过一遍');
  $('#practice-content').innerHTML = `<div lang="ja" class="kana ${item.kana ? 'rule-kana' : 'paired'}">${pairedForm(item)}</div><div class="romaji">${item.romaji}</div>${answerMeta(item)}<div class="learning-actions"><button data-action="browse-prev" ${flow.index === 0 ? 'disabled' : ''}>上一张</button><button class="primary" data-action="browse-next">${isBrowseComplete(flow.group, flow.index) ? '完成浏览' : '下一张'}</button></div>`;
  tryPlayAudio(item);
}

function moveBrowse(direction) {
  if (direction === 'next' && isBrowseComplete(flow.group, flow.index)) {
    state = finishBrowsing(flow.category);
    renderBrowseComplete();
    return;
  }
  flow.index = direction === 'next' ? nextBrowseIndex(flow.group, flow.index) : previousBrowseIndex(flow.group, flow.index);
  renderBrowseCard();
}

function renderBrowseComplete() {
  preparePractice(`${CATEGORIES[flow.category].label}已浏览完成`, `${flow.group.length} 项`, '真正记忆交给后续闪卡复习');
  $('#practice-content').innerHTML = `<div class="completion-icon">✓</div><h1>${CATEGORIES[flow.category].label}已浏览完成</h1><p class="muted">现在可以把这一类加入复习池。</p><div class="learning-actions"><button data-action="join-category">加入复习池</button><button class="primary" data-action="join-and-review">立即复习</button></div>`;
}

function startReview(customPool = null, overrides = {}) {
  state = loadState();
  const categories = overrides.categories ?? state.settings.reviewCategories;
  const pool = customPool ?? buildRangedReviewPool(STUDY_ITEMS, state, categories, {
    start: state.settings.reviewRangeStart,
    end: state.settings.reviewRangeEnd,
  }, { learnedOnly: true, weakOnly: Boolean(overrides.weakOnly) });
  if (!pool.length) { activate('home'); setModeMessage(overrides.weakOnly ? '暂时没有明显薄弱内容。' : '请先选择已经加入复习池的内容。'); return; }
  startCardSession('review', pool, {
    script: overrides.script ?? state.settings.reviewScript,
    count: overrides.count ?? state.settings.reviewCount,
    mode: overrides.mode ?? state.settings.reviewMode,
  });
}

function startTest() {
  state = loadState();
  const pool = STUDY_ITEMS.filter((item) => state.settings.testCategories.includes(item.category));
  if (!pool.length) { setModeMessage('请至少选择一个测试类别。'); return; }
  startCardSession('test', pool, { script: state.settings.testScript, count: state.settings.testCount, mode: state.settings.testMode });
}

function startCardSession(kind, pool, settings) {
  flow = { kind, pool, settings, session: createSession(pool, settings, Math.random, state.records), index: 0, revealed: false, current: null };
  renderNextCard();
}

function renderNextCard() {
  flow.current = nextCard(flow.session);
  flow.revealed = false;
  const total = flow.settings.count === 'infinite' ? '∞' : flow.settings.count;
  preparePractice(flow.kind === 'review' ? '巩固复习' : '自定义测试', `${flow.index + 1} / ${total}`, flow.kind === 'review' ? '先在心里说出读音，再显示答案' : '纯闪卡自测');
  $('#practice-content').innerHTML = `<div lang="ja" class="kana ${flow.current.kana ? 'rule-kana' : ''}">${flow.current.display}</div><div class="learning-actions"><button class="primary" data-action="reveal-card">显示答案</button>${flow.settings.count === 'infinite' ? '<button data-action="finish-session">结束本轮</button>' : ''}</div>`;
}

function revealCard() {
  if (flow.revealed) return;
  flow.revealed = true;
  const item = flow.current;
  $('#practice-content').innerHTML = `<div lang="ja" class="kana ${item.kana ? 'rule-kana' : ''}">${item.display}</div><div class="romaji">${item.romaji}</div>${answerMeta(item)}${ratingButtons()}${flow.settings.count === 'infinite' ? '<div class="learning-actions"><button data-action="finish-session">结束本轮</button></div>' : ''}`;
  tryPlayAudio(item);
}

function rateCurrent(rating) {
  if (!flow.revealed) return;
  rateCard(flow.session, flow.current, rating);
  state = recordRating(flow.current.id, rating);
  flow.index += 1;
  if (flow.settings.count !== 'infinite' && flow.index >= flow.settings.count) showSessionSummary(); else renderNextCard();
}

function weakRows(items) {
  return items.length ? `<div class="weak-list">${items.slice(0, 10).map((item) => `<div class="weak-row"><b>${itemForm(item)}　${item.romaji}</b><span>${item.unknown ? `不认识 ${item.unknown}` : ''}${item.fuzzy ? ` 模糊 ${item.fuzzy}` : ''}</span></div>`).join('')}</div>` : '<p>这一轮没有标记为模糊或不认识的内容。</p>';
}

function showSessionSummary() {
  clearPracticeAudio();
  const summary = buildSummary(flow.session.cards);
  lastSummary = { kind: flow.kind, pool: flow.pool, settings: flow.settings, weak: summary.weak.map((entry) => itemById(entry.id)).filter(Boolean) };
  activateWithoutReset('summary');
  $('#summary-title').textContent = `${summary.total} 题`;
  $('#summary-stats').innerHTML = `<div class="stat"><span>认识</span><b>${summary.counts.known}</b></div><div class="stat"><span>模糊</span><b>${summary.counts.fuzzy}</b></div><div class="stat"><span>不认识</span><b>${summary.counts.unknown}</b></div><div class="stat"><span>认识率</span><b>${Math.round(summary.knownRate * 100)}%</b></div>`;
  $('#summary-detail').innerHTML = `<h2>需要加强</h2>${weakRows(summary.weak)}`;
  $('#summary-actions').innerHTML = `${lastSummary.weak.length ? '<button class="primary" data-summary-action="weak">只练这些</button>' : ''}<button data-summary-action="repeat">再来一轮</button><button data-summary-action="home">返回首页</button>`;
}

function itemsForTableTab() {
  if (tableTab === 'basic') return itemsByCategory('basic');
  if (tableTab === 'marks') return [...itemsByCategory('dakuten'), ...itemsByCategory('handakuten')];
  if (tableTab === 'youon') return itemsByCategory('youon');
  return [...itemsByCategory('sokuon'), ...itemsByCategory('chouon')];
}

function renderTable() {
  state = loadState();
  $$('.table-tabs [data-table-tab]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.tableTab === tableTab);
    button.setAttribute('aria-pressed', String(button.dataset.tableTab === tableTab));
  });
  const groups = itemsForTableTab().reduce((result, item) => {
    (result[item.group] ??= []).push(item);
    return result;
  }, {});
  $('#kana-grid').classList.toggle('rule-grid', tableTab === 'rules');
  $('#kana-grid').dataset.tableCategory = tableTab;
  $('#kana-grid').innerHTML = Object.entries(groups).map(([group, items]) => `<section class="kana-group"><h2>${group}</h2><div class="kana-group-grid">${items.map((item) => `<button class="kana-cell ${proficiencyFor(state.records[item.id])}" data-item="${item.id}" aria-pressed="false"><b lang="ja">${item.kana ?? `<span>${item.hiragana}</span><span>${item.katakana}</span>`}</b><small>${item.romaji}</small></button>`).join('')}</div></section>`).join('');
  $('#kana-detail').innerHTML = `<div class="detail-hint">${icon('book')}<b>从一个假名开始</b><p>选择任意项目，查看字形、读音和你的学习记录。</p></div>`;
}

function renderItemDetail(id) {
  const item = itemById(id);
  const record = state.records[id];
  $$('#kana-grid [data-item]').forEach((button) => { button.classList.toggle('selected', button.dataset.item === id); button.setAttribute('aria-pressed', String(button.dataset.item === id)); });
  $('#kana-detail').innerHTML = `<div class="detail-kana" lang="ja">${pairedForm(item)}</div><h2>${item.romaji}</h2>${item.aliases?.length ? `<p>其他写法：${item.aliases.join(' / ')}</p>` : ''}${item.explanation ? `<p>${item.explanation}</p>` : ''}<p class="muted">${learnedFor(item) ? '已加入复习' : '尚未加入复习'} · 认识 ${record?.knownCount ?? 0} · 模糊 ${record?.unsureCount ?? 0} · 不认识 ${record?.unknownCount ?? 0}</p>`;
}

function renderRecords() {
  state = loadState();
  updateStorageNotice();
  const learned = learnedPool();
  const weak = weakPool();
  const strong = learned.filter((item) => state.records[item.id]?.learningLevel === 4);
  $('#record-overview').innerHTML = `<div class="stat"><span>已学习</span><b>${learned.length}</b></div><div class="stat"><span>已熟练</span><b>${strong.length}</b></div><div class="stat"><span>薄弱</span><b>${weak.length}</b></div><div class="stat"><span>总复习</span><b>${Object.values(state.records).reduce((sum, record) => sum + (record.totalReviews || 0), 0)}</b></div>`;
  $('#record-list').innerHTML = CATEGORY_IDS.map((category) => {
    const items = itemsByCategory(category);
    const learnedItems = items.filter(learnedFor);
    const strongItems = learnedItems.filter((item) => state.records[item.id]?.learningLevel === 4);
    const weakItems = learnedItems.filter((item) => isWeakRecord(state.records[item.id]));
    const rows = items.filter((item) => state.records[item.id]?.totalReviews || learnedFor(item)).map((item) => { const record = state.records[item.id] ?? {}; return `<div class="record-row"><b>${itemForm(item)}　${item.romaji}</b><span>认识 ${record.knownCount ?? 0} · 模糊 ${record.unsureCount ?? 0} · 不认识 ${record.unknownCount ?? 0}</span></div>`; }).join('') || '<p class="muted">还没有学习记录。</p>';
    return `<details class="record-category"><summary><span><b>${CATEGORIES[category].label}</b><small>${items.length} 项</small></span><span>已学习 ${learnedItems.length} · 熟练 ${strongItems.length} · 薄弱 ${weakItems.length}</span></summary><div class="record-category-body">${rows}</div></details>`;
  }).join('');
}

function handlePracticeAction(action, target) {
  if (action === 'browse-prev') moveBrowse('previous');
  if (action === 'browse-next') moveBrowse('next');
  if (action === 'join-category') { state = joinCategory(flow.category); activate('home'); }
  if (action === 'join-and-review') { state = joinCategory(flow.category); startReview(itemsByCategory(flow.category), { categories: [flow.category], count: 30, mode: 'smart' }); }
  if (action === 'reveal-card') revealCard();
  if (action === 'finish-session') showSessionSummary();
  if (target.dataset.rating) rateCurrent(target.dataset.rating);
}

function handleSummaryAction(action) {
  if (action === 'home') activate('home');
  if (action === 'weak' && lastSummary?.weak.length) startReview(lastSummary.weak, { count: 30, mode: 'smart' });
  if (action === 'repeat' && lastSummary) startCardSession(lastSummary.kind, lastSummary.pool, lastSummary.settings);
}

$$('[data-view]').forEach((button) => button.addEventListener('click', () => activate(button.dataset.view)));

$('.mode-grid').addEventListener('click', (event) => {
  const card = event.target.closest('[data-mode]');
  if (!card) return;
  selectedMode = card.dataset.mode;
  state = saveSettings({ selectedMode });
  renderHome();
});

$('#mode-settings').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.setting) saveSetting(button.dataset.setting, button.dataset.value);
  if (button.dataset.browseCategory) { state = saveSettings({ browseCategory: button.dataset.browseCategory }); renderHome(); }
  if (button.dataset.action === 'select-all-learned') { state = saveSettings({ reviewCategories: availableCategories() }); renderHome(); }
});

$('#mode-settings').addEventListener('change', (event) => {
  const input = event.target.closest('[data-category-setting]');
  if (input) toggleCategorySetting(input.dataset.categorySetting, input.value, input.checked);
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-review-range-bound]');
  if (!input || input.type !== 'range' || input.value === '') return;
  changeReviewRange(input.dataset.reviewRangeBound, input.value);
});

document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-review-range-bound]');
  if (!input) return;
  changeReviewRange(input.dataset.reviewRangeBound, input.value || 1, true);
});

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'all-review-range') saveAllReviewRange();
  if (action === 'open-review-range') openReviewRangeDialog();
});

$('#close-review-range').addEventListener('click', () => $('#review-range-dialog').close());

$('#mode-start').addEventListener('click', startCurrentMode);
$('#weak-start').addEventListener('click', () => { registerAudioInteraction(); startReview(null, { categories: state.settings.reviewCategories, weakOnly: true }); });
$('#all-start').addEventListener('click', () => { registerAudioInteraction(); startReview(learnedPool(), { categories: CATEGORY_IDS, count: 30, mode: 'smart' }); });
$('#practice-content').addEventListener('click', (event) => { const target = event.target.closest('button'); if (target) handlePracticeAction(target.dataset.action, target); });
$('#replay-audio').addEventListener('click', () => { registerAudioInteraction(); if (currentAudioItem) tryPlayAudio(currentAudioItem, true); });
$('#summary-actions').addEventListener('click', (event) => { const button = event.target.closest('[data-summary-action]'); if (button) handleSummaryAction(button.dataset.summaryAction); });
$('.table-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-table-tab]'); if (button) { tableTab = button.dataset.tableTab; renderTable(); } });
$('#kana-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-item]'); if (button) renderItemDetail(button.dataset.item); });

$('#open-settings').addEventListener('click', () => { state = loadState(); $('#manual-progress').value = state.courseUntil; $('#settings-message').hidden = true; updateStorageNotice(); refreshRecoveryControl(); $('#settings-dialog').showModal(); });
$('#export-backup').addEventListener('click', exportCurrentBackup);
$('#import-backup').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', readBackupFile);
$('#recover-backup').addEventListener('click', () => {
  try {
    const recovery = getRecoveryBackup();
    if (!recovery) throw new Error('还没有可恢复的导入前记录。');
    showBackupPreview(recovery, 'recover', '上次导入前自动保存的恢复副本');
  } catch (error) { setBackupStatus(error.message, true); }
});
$('#confirm-backup').addEventListener('click', confirmBackupOverwrite);
$('#cancel-backup').addEventListener('click', () => $('#backup-confirm').close());
$('#backup-confirm').addEventListener('close', () => { pendingBackup = null; });
$('#save-manual-progress').addEventListener('click', () => {
  state = setCourseUntil($('#manual-progress').value);
  $('#manual-progress').value = state.courseUntil;
  $('#settings-message').textContent = isStoragePersistent() ? '基础进度已保存，历史评分没有被删除。' : '基础进度已更新，记录仅在本次打开期间保留。';
  $('#settings-message').hidden = false;
  renderHome();
});
$('#license-details').addEventListener('toggle', async () => {
  const details = $('#license-details');
  if (!details.open || details.dataset.loaded === 'true' || details.dataset.loading === 'true') return;
  details.dataset.loading = 'true';
  try {
    const response = await fetch('assets/notices.txt');
    if (!response.ok) throw new Error('许可文件未能读取');
    $('#license-text').textContent = await response.text();
    details.dataset.loaded = 'true';
  } catch {
    $('#license-text').textContent = '暂时无法读取完整许可说明。请重新展开重试，或在项目 GitHub 仓库中查看 LICENSE、THIRD_PARTY_NOTICES.md 和 assets/audio/TERMS.md。';
  } finally { details.dataset.loading = 'false'; }
});
$('#reset').addEventListener('click', () => { $('#reset-status').hidden = true; $('#confirm').showModal(); });
$('#cancel-reset').addEventListener('click', () => $('#confirm').close());
$('#confirm-reset').addEventListener('click', () => {
  const result = resetStateWithResult();
  state = result.state;
  selectedMode = state.settings.selectedMode;
  activate('home');
  refreshRecoveryControl();
  updateStorageNotice();
  if (result.persistentCleared) {
    $('#confirm').close();
    $('#settings-dialog').close();
  } else {
    $('#reset-status').textContent = '未能确认已清除所有持久记录。当前页面已重置，重新打开后旧记录或恢复副本可能仍在。请解除存储限制后再次清空，或选择取消返回。';
    $('#reset-status').hidden = false;
  }
});

document.addEventListener('keydown', (event) => {
  const flashcardsActive = $('#flashcards').classList.contains('active');
  const editable = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
  const dialogOpen = $$('dialog[open]').length > 0;
  if (event.code === 'Space') {
    const reveal = $('#practice-content [data-action="reveal-card"]');
    const known = $('#practice-content [data-rating="known"]');
    const focused = document.activeElement;
    const otherControlFocused = Boolean(focused?.matches('button, a, summary, [role="button"]') && !focused.matches('[data-action="reveal-card"], [data-rating="known"]'));
    const action = resolveFlashcardSpaceAction({ repeat: event.repeat, flashcardsActive, editable, dialogOpen, otherControlFocused, revealAvailable: Boolean(reveal && !reveal.disabled), knownAvailable: Boolean(known && !known.disabled) });
    if (action) { event.preventDefault(); (action === 'reveal' ? reveal : known).click(); }
    return;
  }
  if (!flashcardsActive || editable || dialogOpen || event.repeat) return;
  const rating = { 1: 'known', 2: 'fuzzy', 3: 'unknown' }[event.key];
  if (rating) $('#practice-content [data-rating="' + rating + '"]')?.click();
});

renderHome();
