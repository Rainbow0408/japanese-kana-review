import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self'", "media-src 'self'", "font-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
  "frame-ancestors 'none'", "worker-src 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

export function resolveResource(rawUrl, root) {
  try {
    const raw = /^app:\/\/([^/?#]+)([^?#]*)/.exec(rawUrl);
    if (!raw || raw[1] !== 'kana') return { status: 403 };
    // Inspect the original path first: URL parsing erases literal and encoded dot segments.
    const pathname = decodeURIComponent(raw[2] || '/');
    const segments = pathname.slice(1).split('/');
    if (pathname !== '/' && segments.some(segment => !segment || segment.startsWith('.') ||
      /[\\:%\x00-\x20\x7f<>"|?*]/.test(segment) || segment.endsWith('.'))) return { status: 403 };
    const url = new URL(rawUrl);
    if (url.protocol !== 'app:' || url.host !== 'kana' || url.username || url.password) return { status: 403 };
    const relative = pathname === '/' ? 'index.html' : segments.join('/');
    const extension = path.extname(relative);
    const allowed = relative === 'index.html' || relative === 'styles.css' ||
      (relative.startsWith('js/') && extension === '.js') ||
      (relative.startsWith('assets/') && extension !== '.html' && extension !== '.js' && extension !== '.css');
    if (!allowed || !MIME[extension]) return { status: 404 };
    const file = path.resolve(root, ...relative.split('/'));
    const within = path.relative(root, file);
    if (within.startsWith('..') || path.isAbsolute(within)) return { status: 403 };
    return { status: 200, file, mime: MIME[extension] };
  } catch {
    return { status: 400 };
  }
}

export async function handleResourceRequest(request, root) {
  const headers = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  const resource = resolveResource(request.url, root);
  if (resource.status !== 200) return new Response(null, { status: resource.status, headers });
  try {
    const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(resource.file)]);
    const relative = path.relative(canonicalRoot, canonicalFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, { status: 403, headers });
    const data = await readFile(resource.file);
    return new Response(request.method === 'HEAD' ? null : data, {
      status: 200, headers: { ...headers, 'Content-Type': resource.mime, 'Content-Length': String(data.length) },
    });
  } catch (error) {
    return new Response(null, { status: ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 500, headers });
  }
}
