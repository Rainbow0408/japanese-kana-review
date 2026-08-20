import { BASIC_KANA, CATEGORIES, CATEGORY_IDS, STUDY_ITEMS, itemById, itemsByCategory } from './data.js?v=20260820-1';
import { buildReviewPool, buildSummary, createSession, displayForItem, nextCard, rateCard } from './flashcards.js?v=20260820-1';
import { getBrowseItem, isBrowseComplete, nextBrowseIndex, previousBrowseIndex } from './new-learning.js?v=20260820-1';
import {
  finishBrowsing, isWeakRecord, joinCategory, loadState, markSeen, proficiencyFor,
  recordRating, resetState, saveBrowseProgress, saveSettings, setCourseUntil,
} from './storage.js?v=20260820-1';
import { playStudyItem, registerAudioInteraction } from './audio.js?v=20260820-1';
import { resolveFlashcardSpaceAction } from './keyboard.js?v=20260820-1';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const scriptOptions = [['mixed', '平 + 片'], ['hiragana', '仅平假名'], ['katakana', '仅片假名']];
const countOptions = [[20, '20'], [30, '30'], [50, '50'], [100, '100'], ['infinite', '无限']];
const statusCopy = { not_started: '○ 未开始', browsing: '◐ 浏览中', browsed: '🟡 已浏览', joined: '✅ 已加入复习' };

let state = loadState();
let selectedMode = state.settings.selectedMode;
let flow = null;
let lastSummary = null;
let currentAudioItem = null;
let audioNoticeTimer = null;
let tableTab = 'basic';

const itemForm = (item) => item.kana ?? `${item.hiragana} / ${item.katakana}`;
const pairedForm = (item) => item.kana ?? `${item.hiragana}　${item.katakana}`;
const learnedFor = (item) => item.category === 'basic' ? item.index <= state.courseUntil : Boolean(state.records[item.id]?.learned);
const learnedPool = (categories = CATEGORY_IDS) => buildReviewPool(STUDY_ITEMS, state, categories, { learnedOnly: true });
const weakPool = (categories = CATEGORY_IDS) => buildReviewPool(STUDY_ITEMS, state, categories, { learnedOnly: true, weakOnly: true });
const availableCategories = () => CATEGORY_IDS.filter((id) => learnedPool([id]).length > 0);

function activate(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === name));
  if (name === 'home') { flow = null; state = loadState(); selectedMode = state.settings.selectedMode; renderHome(); }
  if (name === 'table') renderTable();
  if (name === 'records') renderRecords();
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}

function activateWithoutReset(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === name));
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}

function segment(name, options, selected) {
  return `<div class="segment">${options.map(([value, label]) => `<button type="button" data-setting="${name}" data-value="${value}" class="${String(value) === String(selected) ? 'selected' : ''}">${label}</button>`).join('')}</div>`;
}

function categoryChecks(name, selected, learnedOnly = false) {
  const enabled = new Set(availableCategories());
  return `<div class="category-checks">${CATEGORY_IDS.map((id) => {
    const disabled = learnedOnly && !enabled.has(id);
    return `<label class="category-check ${disabled ? 'disabled' : ''}"><input type="checkbox" data-category-setting="${name}" value="${id}" ${selected.includes(id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><b>${CATEGORIES[id].label}</b><small>${disabled ? '尚未加入复习池' : `${learnedPool([id]).length || itemsByCategory(id).length} 项`}</small></span></label>`;
  }).join('')}</div>`;
}

function renderDashboard() {
  state = loadState();
  const learned = learnedPool();
  const weak = weakPool();
  $('#dashboard-learned').textContent = `${learned.length} / ${STUDY_ITEMS.length}`;
  $('#dashboard-weak').textContent = String(weak.length);
  $('#dashboard-progress').style.width = `${learned.length / STUDY_ITEMS.length * 100}%`;
  $('#dashboard-advice').textContent = weak.length ? `🔁 有 ${weak.length} 项需要加强，可以直接只练薄弱项。` : learned.length ? '状态不错，开始一轮快速复习吧。' : '先在“快速过新内容”中浏览并加入一个类别。';
  $('#category-overview').innerHTML = CATEGORY_IDS.map((id) => {
    const items = itemsByCategory(id);
    const learnedCount = items.filter(learnedFor).length;
    const status = state.categoryStatus[id];
    return `<div class="category-status"><span>${CATEGORIES[id].label}</span><b>${learnedCount} / ${items.length}</b><small>${statusCopy[status]}</small></div>`;
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

function reviewSettingsTemplate() {
  const settings = state.settings;
  return `<div class="settings-grid review-settings">
    <div class="setting-block category-setting"><div class="setting-heading"><b>今天复习什么？</b><button type="button" class="text compact" data-action="select-all-learned">全选已学</button></div>${categoryChecks('reviewCategories', settings.reviewCategories, true)}</div>
    <div class="setting-block"><b>假名形式</b>${segment('reviewScript', scriptOptions, settings.reviewScript)}</div>
    <div class="setting-block"><b>题目数量</b>${segment('reviewCount', countOptions, settings.reviewCount)}</div>
    <div class="setting-block"><b>出题方式</b>${segment('reviewMode', [['smart', '智能复习'], ['uniform', '均匀随机']], settings.reviewMode)}<span class="hint">模糊权重 3，不认识权重 5</span></div>
  </div>`;
}

function browseSettingsTemplate() {
  const current = state.settings.browseCategory;
  return `<div class="browse-picker"><div class="setting-heading"><b>选择要快速浏览的内容</b><span class="hint">浏览完成后再加入复习池</span></div><div class="browse-category-grid">${CATEGORY_IDS.map((id) => {
    const status = state.categoryStatus[id];
    return `<button type="button" data-browse-category="${id}" class="browse-category ${id === current ? 'selected' : ''}"><b>${CATEGORIES[id].label}</b><span>${itemsByCategory(id).length} 项</span><small>${statusCopy[status]}</small></button>`;
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
  renderHome();
}

function preparePractice(label, position = '', trail = '') {
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

async function tryPlayAudio(item, manual = false) {
  currentAudioItem = item;
  $('#replay-audio').hidden = false;
  const result = await playStudyItem(item, { manual });
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
  if (item.kana) return `<p class="focus-kana">${highlightFocus(item)}</p><p class="rule-note">${item.explanation}</p>${item.standardRomaji ? `<p class="kana-meta">标准长音写法：${item.standardRomaji}</p>` : ''}`;
  return `<p class="kana-meta">平假名：${item.hiragana}　片假名：${item.katakana}</p>`;
}

function ratingButtons() {
  return '<div class="ratings"><button data-rating="known">✅ 认识</button><button data-rating="fuzzy">🤔 模糊</button><button data-rating="unknown">❌ 不认识</button></div>';
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
  $('#practice-content').innerHTML = `<div class="kana ${item.kana ? 'rule-kana' : 'paired'}">${pairedForm(item)}</div><div class="romaji">${item.romaji}</div>${answerMeta(item)}<div class="learning-actions"><button data-action="browse-prev" ${flow.index === 0 ? 'disabled' : ''}>上一张</button><button class="primary" data-action="browse-next">${isBrowseComplete(flow.group, flow.index) ? '完成浏览' : '下一张'}</button></div>`;
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
  const pool = customPool ?? buildReviewPool(STUDY_ITEMS, state, categories, { learnedOnly: true, weakOnly: Boolean(overrides.weakOnly) });
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
  $('#practice-content').innerHTML = `<div class="kana ${flow.current.kana ? 'rule-kana' : ''}">${flow.current.display}</div><div class="learning-actions"><button class="primary" data-action="reveal-card">显示答案</button>${flow.settings.count === 'infinite' ? '<button data-action="finish-session">结束本轮</button>' : ''}</div>`;
}

function revealCard() {
  if (flow.revealed) return;
  flow.revealed = true;
  const item = flow.current;
  $('#practice-content').innerHTML = `<div class="kana ${item.kana ? 'rule-kana' : ''}">${item.display}</div><div class="romaji">${item.romaji}</div>${answerMeta(item)}${ratingButtons()}${flow.settings.count === 'infinite' ? '<div class="learning-actions"><button data-action="finish-session">结束本轮</button></div>' : ''}`;
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
  $$('.table-tabs [data-table-tab]').forEach((button) => button.classList.toggle('selected', button.dataset.tableTab === tableTab));
  const groups = itemsForTableTab().reduce((result, item) => {
    (result[item.group] ??= []).push(item);
    return result;
  }, {});
  $('#kana-grid').classList.toggle('rule-grid', tableTab === 'rules');
  $('#kana-grid').innerHTML = Object.entries(groups).map(([group, items]) => `<section class="kana-group"><h2>${group}</h2><div class="kana-group-grid">${items.map((item) => `<button class="kana-cell ${proficiencyFor(state.records[item.id])}" data-item="${item.id}"><b>${item.kana ?? `${item.hiragana}　${item.katakana}`}</b><small>${item.romaji}</small></button>`).join('')}</div></section>`).join('');
  $('#kana-detail').textContent = '选择任意项目查看详情。';
}

function renderItemDetail(id) {
  const item = itemById(id);
  const record = state.records[id];
  $('#kana-detail').innerHTML = `<div class="detail-kana">${pairedForm(item)}</div><h2>${item.romaji}</h2>${item.aliases?.length ? `<p>其他写法：${item.aliases.join(' / ')}</p>` : ''}${item.explanation ? `<p>${item.explanation}</p>` : ''}<p class="muted">${learnedFor(item) ? '已加入复习' : '尚未加入复习'} · 认识 ${record?.knownCount ?? 0} · 模糊 ${record?.unsureCount ?? 0} · 不认识 ${record?.unknownCount ?? 0}</p>`;
}

function renderRecords() {
  state = loadState();
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

$('#mode-start').addEventListener('click', startCurrentMode);
$('#weak-start').addEventListener('click', () => { registerAudioInteraction(); startReview(null, { categories: state.settings.reviewCategories, weakOnly: true }); });
$('#all-start').addEventListener('click', () => { registerAudioInteraction(); startReview(learnedPool(), { categories: CATEGORY_IDS, count: 30, mode: 'smart' }); });
$('#practice-content').addEventListener('click', (event) => { const target = event.target.closest('button'); if (target) handlePracticeAction(target.dataset.action, target); });
$('#replay-audio').addEventListener('click', () => { registerAudioInteraction(); if (currentAudioItem) tryPlayAudio(currentAudioItem, true); });
$('#summary-actions').addEventListener('click', (event) => { const button = event.target.closest('[data-summary-action]'); if (button) handleSummaryAction(button.dataset.summaryAction); });
$('.table-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-table-tab]'); if (button) { tableTab = button.dataset.tableTab; renderTable(); } });
$('#kana-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-item]'); if (button) renderItemDetail(button.dataset.item); });

$('#open-settings').addEventListener('click', () => { state = loadState(); $('#manual-progress').value = state.courseUntil; $('#settings-message').hidden = true; $('#settings-dialog').showModal(); });
$('#save-manual-progress').addEventListener('click', () => {
  state = setCourseUntil($('#manual-progress').value);
  $('#manual-progress').value = state.courseUntil;
  $('#settings-message').textContent = '基础进度已保存，历史评分没有被删除。';
  $('#settings-message').hidden = false;
  renderHome();
});
$('#reset').addEventListener('click', () => $('#confirm').showModal());
$('#cancel-reset').addEventListener('click', () => $('#confirm').close());
$('#confirm-reset').addEventListener('click', () => { state = resetState(); selectedMode = state.settings.selectedMode; $('#confirm').close(); $('#settings-dialog').close(); activate('home'); });

document.addEventListener('keydown', (event) => {
  const flashcardsActive = $('#flashcards').classList.contains('active');
  const editable = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
  const dialogOpen = $$('dialog[open]').length > 0;
  if (event.code === 'Space') {
    const reveal = $('#practice-content [data-action="reveal-card"]');
    const known = $('#practice-content [data-rating="known"]');
    const action = resolveFlashcardSpaceAction({ repeat: event.repeat, flashcardsActive, editable, dialogOpen, revealAvailable: Boolean(reveal && !reveal.disabled), knownAvailable: Boolean(known && !known.disabled) });
    if (action) { event.preventDefault(); (action === 'reveal' ? reveal : known).click(); }
    return;
  }
  if (!flashcardsActive || editable || dialogOpen || event.repeat) return;
  const rating = { 1: 'known', 2: 'fuzzy', 3: 'unknown' }[event.key];
  if (rating) $('#practice-content [data-rating="' + rating + '"]')?.click();
});

renderHome();
