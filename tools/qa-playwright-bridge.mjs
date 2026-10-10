// Optional QA adapter for real NSIS portable launchers. Never shipped in app.asar.
// PLAYWRIGHT_NATIVE_MODULE points to an existing Playwright installation.
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const nativeUrl = process.env.PLAYWRIGHT_NATIVE_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_NATIVE_MODULE).href : 'playwright';
const playwright = await import(nativeUrl);
export const chromium = playwright.chromium;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function inspectorTarget(port, child, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Portable launcher exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      if (targets[0]?.webSocketDebuggerUrl) return targets[0].webSocketDebuggerUrl;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Portable child inspector did not start within the QA timeout');
}

class Inspector {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) pending.reject(new Error(response.error.message));
      else pending.resolve(response.result);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Task inspector disconnected')); }
      this.pending.clear();
    });
  }
  async request(method, params) {
    await this.ready;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Task inspector request timed out: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(callback, value) {
    const expression = `(async () => { const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron'); return (${callback.toString()})(electron, ${JSON.stringify(value) ?? 'undefined'}); })()`;
    const response = await this.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}

export const _electron = {
  async launch(options) {
    if (!options.executablePath.endsWith('-portable.exe')) return playwright._electron.launch(options);
    const profile = options.env?.KANA_TEST_DATA_DIR;
    assert.ok(profile && path.isAbsolute(profile), 'Portable QA requires an explicit isolated profile');
    const nodePort = await unusedPort();
    const chromiumPort = await unusedPort();
    const child = spawn(options.executablePath,
      [`--inspect=127.0.0.1:${nodePort}`, `--remote-debugging-port=${chromiumPort}`, ...(options.args || [])], {
        cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'ignore',
      });
    console.log(`Portable QA launcher PID ${child.pid}; inspector ${nodePort}; Chromium ${chromiumPort}.`);
    let inspector;
    let browser;
    let closed = false;
    try {
      const inspectorUrl = await inspectorTarget(nodePort, child, options.timeout || 60000);
      inspector = new Inspector(inspectorUrl);
      await inspectorTarget(chromiumPort, child, options.timeout || 60000);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${chromiumPort}`, { timeout: options.timeout || 60000 });
      // Playwright otherwise sends allowAndName and redirects Electron's native Save As target.
      const downloadControl = await browser.newBrowserCDPSession();
      await downloadControl.send('Browser.setDownloadBehavior', { behavior: 'default' });
      await downloadControl.detach();
      const context = browser.contexts()[0];
      const identity = await inspector.evaluate(({ app }) => ({ pid: process.pid, profile: app.getPath('userData') }));
      assert.equal(path.normalize(identity.profile), path.normalize(profile));
      return {
        context: () => context,
        evaluate: (callback, value) => inspector.evaluate(callback, value),
        firstWindow: async () => context.pages()[0] || await context.waitForEvent('page'),
        process: () => child,
        taskIdentity: { launcherPid: child.pid, appPid: identity.pid, nodePort, chromiumPort },
        async close() {
          if (closed) return;
          closed = true;
          const quit = inspector.evaluate(({ app }) => app.quit()).catch(() => {});
          await Promise.race([quit, new Promise(resolve => setTimeout(resolve, 300))]);
          inspector.close();
          await browser.close().catch(() => {});
          if (child.exitCode === null) {
            await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
          }
          if (child.exitCode === null) child.kill();
        },
      };
    } catch (error) {
      if (inspector) await inspector.evaluate(({ app }) => app.quit()).catch(() => {});
      inspector?.close();
      await browser?.close().catch(() => {});
      if (child.exitCode === null) child.kill();
      throw error;
    }
  },
};
