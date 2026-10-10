import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 8765;
const address = `http://127.0.0.1:${port}/`;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, address).pathname);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.some(segment => segment.startsWith('.') || segment.includes('\\'))) {
      response.writeHead(403).end();
      return;
    }
    const file = path.resolve(root, ...segments, ...(segments.length ? [] : ['index.html']));
    if (!file.startsWith(root) || !types[path.extname(file)]) {
      response.writeHead(404).end();
      return;
    }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400).end();
  }
});

function openStudyPage() {
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const opener = spawn('cmd.exe', ['/d', '/c', 'start', '', address], { windowsHide: true, stdio: 'ignore' });
    opener.on('error', () => console.log(`Open ${address} in your browser.`));
    opener.unref();
  }
}

server.on('error', error => {
  if (error.code !== 'EADDRINUSE') { console.error(error.message); process.exitCode = 1; return; }
  // A second double-click can reuse the same site without starting another server.
  const probe = http.get(address, response => {
    let html = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { if (html.length < 100000) html += chunk; });
    response.on('end', () => {
      if (response.statusCode === 200 && html.includes('<meta name="application-name" content="Kana Flashcards">')) {
        console.log(`Kana study is already running: ${address}`);
        openStudyPage();
      } else {
        console.error('Port 8765 is used by another application. Close it and try again.');
        process.exitCode = 1;
      }
    });
  });
  probe.setTimeout(2000, () => probe.destroy(new Error('Existing server did not respond.')));
  probe.on('error', err => { console.error(err.message); process.exitCode = 1; });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Kana study is ready: ${address}\nKeep this window open while studying. Press Ctrl+C to stop.`);
  openStudyPage();
});
