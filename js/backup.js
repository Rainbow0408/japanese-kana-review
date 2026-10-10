import { CATEGORY_IDS, STUDY_ITEMS, itemById, itemsByCategory } from './data.js?v=20261010-1';
import { DEFAULT_SETTINGS, RECOVERY_STORAGE_KEY, calculateLearningLevel, createRecord, loadState, readStoredValue, replaceStateVerified } from './storage.js?v=20261010-1';

export const BACKUP_FORMAT = 'japanese-kana-review-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;
const scripts = ['mixed', 'hiragana', 'katakana'];
const statuses = ['not_started', 'browsing', 'browsed', 'joined'];
const recordFields = Object.keys(createRecord());
const counterFields = ['totalReviews', 'knownCount', 'unsureCount', 'unknownCount', 'knownStreak', 'quizCorrect', 'quizWrong'];
const dateFields = ['firstSeenAt', 'firstLearnedAt', 'lastReviewedAt'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value) => value === null || timestamp(value);
class BackupValidationError extends Error {}
const check = (valid, field) => { if (!valid) throw new BackupValidationError(`备份数据无效：${field}。`); };
const exactFields = (value, fields, name) => {
  check(object(value), name);
  check(Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key)), `${name} 字段`);
};

function validateSettings(settings) {
  exactFields(settings, Object.keys(DEFAULT_SETTINGS), '设置');
  check(['review', 'browse', 'test'].includes(settings.selectedMode), '学习模式');
  for (const name of ['reviewCategories', 'testCategories']) {
    check(Array.isArray(settings[name]) && settings[name].every((id) => CATEGORY_IDS.includes(id)) && new Set(settings[name]).size === settings[name].length, name);
  }
  for (const name of ['reviewScript', 'testScript']) check(scripts.includes(settings[name]), name);
  for (const name of ['reviewCount', 'testCount']) check(settings[name] === 'infinite' || [20, 30, 50, 100].includes(settings[name]), name);
  for (const name of ['reviewMode', 'testMode']) check(['smart', 'uniform'].includes(settings[name]), name);
  check(CATEGORY_IDS.includes(settings.browseCategory), '浏览类别');
  check(integer(settings.reviewRangeStart, 1), '复习起点');
  check(settings.reviewRangeEnd === null || integer(settings.reviewRangeEnd, settings.reviewRangeStart), '复习终点');
}

function validateRecord(record, id) {
  exactFields(record, recordFields, `记录 ${id}`);
  check(typeof record.learned === 'boolean', `${id} 已学标记`);
  for (const key of counterFields) check(integer(record[key]), `${id} ${key}`);
  check(record.knownCount + record.unsureCount + record.unknownCount <= record.totalReviews, `${id} 复习计数`);
  check(record.knownStreak <= record.knownCount, `${id} 连续认识计数`);
  for (const key of dateFields) check(nullableTimestamp(record[key]), `${id} ${key}`);
  check(record.lastResult === null || ['known', 'fuzzy', 'unknown'].includes(record.lastResult), `${id} 最近评分`);
  check(record.lastResult !== null || record.knownCount + record.unsureCount + record.unknownCount === 0, `${id} 最近评分缺失`);
  check(integer(record.learningLevel, 0, 4) && record.learningLevel === calculateLearningLevel(record), `${id} 熟练程度`);
}

function validateState(state) {
  exactFields(state, ['version', 'settings', 'courseUntil', 'categoryStatus', 'browseProgress', 'records'], '学习数据');
  check(state.version === 4, '学习数据版本（仅支持 v4）');
  check(integer(state.courseUntil, 0, 46), '基础五十音进度');
  validateSettings(state.settings);
  exactFields(state.categoryStatus, CATEGORY_IDS, '类别状态');
  for (const id of CATEGORY_IDS) check(statuses.includes(state.categoryStatus[id]), `${id} 类别状态`);
  check(object(state.records), '学习记录');
  for (const [id, record] of Object.entries(state.records)) {
    check(Boolean(itemById(id)), `未知学习项目 ${id}`);
    validateRecord(record, id);
  }
  for (const item of STUDY_ITEMS) {
    if (item.category === 'basic' && item.index <= state.courseUntil || state.categoryStatus[item.category] === 'joined') {
      check(state.records[item.id]?.learned === true, `${item.id} 已学记录缺失`);
    }
  }
  const available = CATEGORY_IDS.filter((category) => STUDY_ITEMS.some((item) => item.category === category && (category === 'basic' ? item.index <= state.courseUntil : state.records[item.id]?.learned)));
  check(state.settings.reviewCategories.every((id) => available.includes(id)), '复习类别尚未加入复习');
  if (state.browseProgress !== null) {
    exactFields(state.browseProgress, ['category', 'index', 'startedAt'], '浏览进度');
    const progress = state.browseProgress;
    check(CATEGORY_IDS.includes(progress.category), '浏览进度类别');
    check(integer(progress.index, 0, itemsByCategory(progress.category).length - 1), '浏览位置');
    check(nullableTimestamp(progress.startedAt), '浏览开始时间');
    check(state.categoryStatus[progress.category] !== 'not_started', '浏览类别状态');
  }
}

function validateBackup(value) {
  exactFields(value, ['format', 'formatVersion', 'exportedAt', 'state'], '备份文件');
  check(value.format === BACKUP_FORMAT, '备份格式');
  check(value.formatVersion === BACKUP_FORMAT_VERSION, '备份版本（仅支持版本 1）');
  check(timestamp(value.exportedAt), '备份时间');
  validateState(value.state);
  return clone(value);
}

export function createBackup(state = loadState(), exportedAt = new Date().toISOString()) {
  return validateBackup({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt, state });
}

export function serializeBackup(state = loadState(), exportedAt = new Date().toISOString()) {
  const text = JSON.stringify(createBackup(state, exportedAt), null, 2);
  check(new TextEncoder().encode(text).byteLength <= MAX_BACKUP_BYTES, '文件超过 1 MiB');
  return text;
}

export function parseBackup(text) {
  check(typeof text === 'string', 'JSON 文件内容');
  check(new TextEncoder().encode(text).byteLength <= MAX_BACKUP_BYTES, '文件超过 1 MiB');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('无法读取备份：文件不是有效的 JSON。'); }
  return validateBackup(value);
}

export function backupSummary(value) {
  const { state, exportedAt } = validateBackup(value);
  return {
    exportedAt,
    courseUntil: state.courseUntil,
    recordCount: Object.keys(state.records).length,
    learnedCount: STUDY_ITEMS.filter((item) => item.category === 'basic' ? item.index <= state.courseUntil : state.records[item.id]?.learned).length,
    totalReviews: Object.values(state.records).reduce((sum, record) => sum + record.totalReviews, 0),
    joinedCategories: CATEGORY_IDS.filter((id) => state.categoryStatus[id] === 'joined').length,
    browseProgress: state.browseProgress ? { category: state.browseProgress.category, position: state.browseProgress.index + 1, total: itemsByCategory(state.browseProgress.category).length } : null,
  };
}

export function currentBackupSummary(state = loadState()) {
  try { return backupSummary(createBackup(state)); }
  catch (error) {
    if (error instanceof BackupValidationError) return null;
    throw error;
  }
}

export function importBackup(value, { store, now = new Date().toISOString() } = {}) {
  const imported = typeof value === 'string' ? parseBackup(value) : validateBackup(value);
  const recoveryRaw = serializeBackup(loadState(store), now);
  return replaceStateVerified(imported.state, { store, recoveryRaw });
}

export function getRecoveryBackup({ store } = {}) {
  const raw = readStoredValue(RECOVERY_STORAGE_KEY, store);
  return raw === null ? null : parseBackup(raw);
}

export function recoverBackup({ store } = {}) {
  const backup = getRecoveryBackup({ store });
  if (!backup) throw new Error('还没有可恢复的导入前记录。');
  return replaceStateVerified(backup.state, { store, retryPersistence: true });
}
