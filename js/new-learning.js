export function clampBrowseIndex(group, index) {
  if (!group.length) return 0;
  return Math.max(0, Math.min(Number(index) || 0, group.length - 1));
}

export function getBrowseItem(group, index) {
  return group[clampBrowseIndex(group, index)] ?? null;
}

export function nextBrowseIndex(group, index) {
  return clampBrowseIndex(group, Number(index) + 1);
}

export function previousBrowseIndex(group, index) {
  return clampBrowseIndex(group, Number(index) - 1);
}

export function isBrowseComplete(group, index) {
  return Boolean(group.length) && clampBrowseIndex(group, index) === group.length - 1;
}
