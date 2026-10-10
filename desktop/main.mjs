import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { handleResourceRequest, resolveResource } from './protocol.mjs';
import { blockExternalNavigation, isAllowedDownload, profilePath, safeDownloadName } from './security.mjs';

const APP_ID = 'io.github.rainbow0408.japanese-kana-review';
const APP_URL = 'app://kana/';
app.setName('日语假名复习');
app.setAppUserModelId(APP_ID);
const userData = profilePath(app.getPath('appData'), process.env);
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true,
} }]);

let mainWindow;
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    const root = app.getAppPath();
    protocol.handle('app', request => handleResourceRequest(request, root));
    const localSession = session.defaultSession;
    localSession.setPermissionCheckHandler(() => false);
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setDevicePermissionHandler(() => false);
    localSession.on('file-system-access-restricted', (_event, _details, callback) => callback('deny'));
    localSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = resolveResource(details.url, root).status === 200 ||
        details.url.startsWith('blob:app://kana/');
      callback({ cancel: !allowed });
    });
    localSession.on('will-download', (event, item, contents) => {
      if (contents !== mainWindow?.webContents || !isAllowedDownload(item.getURL(), contents.getURL())) {
        event.preventDefault();
        return;
      }
      const filename = safeDownloadName(item.getFilename());
      const extension = path.extname(filename).slice(1).toLowerCase();
      // Keeping the native download dialog preserves the browser's filename without a filesystem bridge.
      item.setSaveDialogOptions({
        title: '导出学习记录', defaultPath: path.join(app.getPath('downloads'), filename),
        filters: extension ? [{ name: extension === 'json' ? 'JSON 学习记录' : '导出文件', extensions: [extension] }] : [],
      });
    });

    mainWindow = new BrowserWindow({
      title: '日语假名复习', width: 1200, height: 860, minWidth: 900, minHeight: 640,
      show: false, backgroundColor: '#f6f8fc', icon: path.join(root, 'assets/app.ico'),
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, spellcheck: false,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', blockExternalNavigation);
    mainWindow.webContents.on('will-frame-navigate', blockExternalNavigation);
    mainWindow.webContents.on('will-redirect', event => event.preventDefault());
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [{ label: '退出', role: 'quit' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '帮助', submenu: [{ label: '关于日语假名复习', click: () => dialog.showMessageBox(mainWindow, {
        type: 'info', title: '关于日语假名复习', message: '日语假名复习',
        detail: `版本 ${app.getVersion()}\n离线假名学习与复习。\n软件与音频许可请查看应用内的“关于与许可”。`,
      }) }] },
    ]));
    await mainWindow.loadURL(APP_URL);
  }).catch(error => {
    dialog.showErrorBox('日语假名复习未能启动', error.message);
    app.quit();
  });
}
