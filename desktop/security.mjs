import path from 'node:path';

export function isAppPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.host === 'kana' && !url.username && !url.password &&
      ['/', '/index.html'].includes(url.pathname);
  } catch { return false; }
}

export function isAllowedDownload(downloadUrl, pageUrl) {
  return isAppPage(pageUrl) && downloadUrl.startsWith('blob:app://kana/');
}

export function blockExternalNavigation(event) {
  if (!isAppPage(event.url)) event.preventDefault();
}

export function safeDownloadName(value) {
  return path.win32.basename(String(value || 'kana-progress.json'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'kana-progress.json';
}

export function profilePath(appData, environment) {
  const override = environment.KANA_TEST_DATA_DIR;
  if (override && !path.isAbsolute(override)) throw new Error('KANA_TEST_DATA_DIR must be absolute');
  return override || path.join(appData, 'japanese-kana-review');
}
