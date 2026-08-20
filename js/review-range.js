const integer = (value, fallback) => Number.isFinite(Number(value))
  ? Math.trunc(Number(value)) : fallback;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeReviewRange(length, start = 1, endSetting = null) {
  const size = Math.max(0, integer(length, 0));
  if (!size) return { start: 0, end: 0, endSetting: null, count: 0 };
  const end = endSetting == null ? size : clamp(integer(endSetting, size), 1, size);
  const normalizedStart = Math.min(clamp(integer(start, 1), 1, size), end);
  return {
    start: normalizedStart,
    end,
    endSetting: endSetting == null ? null : end,
    count: end - normalizedStart + 1,
  };
}

export function updateReviewRange(length, start, endSetting, bound, value) {
  const current = normalizeReviewRange(length, start, endSetting);
  if (!current.count) return current;
  const fallback = bound === 'start' ? current.start : current.end;
  const moved = clamp(integer(value, fallback), 1, length);
  if (bound === 'start') {
    const end = Math.max(current.end, moved);
    return { start: moved, end, endSetting: end, count: end - moved + 1 };
  }
  const nextStart = Math.min(current.start, moved);
  return { start: nextStart, end: moved, endSetting: moved, count: moved - nextStart + 1 };
}

export function sliceReviewRange(items, start, endSetting) {
  const range = normalizeReviewRange(items.length, start, endSetting);
  return range.count ? items.slice(range.start - 1, range.end) : [];
}

export function reviewRangeSummary(length, start, endSetting) {
  const range = normalizeReviewRange(length, start, endSetting);
  return range.count
    ? `第 ${range.start}–${range.end} 项（共 ${range.count} 项）`
    : '暂无可复习内容';
}
