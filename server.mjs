import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_FILES = new Set(['/index.html', '/style.css', '/script.js', '/playback.js', '/channel-catalog.json', '/config.json', '/ticker.json', '/settings.json']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

export function createServer({ root = ROOT } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const send = (status, text, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { return send(400, 'Bad request'); }
    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', app: 'kratex-tv' }));
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part.startsWith('.'))) return send(404, 'Not found');
    if (!PUBLIC_FILES.has(pathname) && !pathname.startsWith('/assets/')) return send(404, 'Not found');
    try {
      const actualRoot = await realpath(root);
      const filename = await realpath(path.join(root, pathname));
      if (!filename.startsWith(`${actualRoot}${path.sep}`)) return send(404, 'Not found');
      const info = await stat(filename);
      if (!info.isFile()) return send(404, 'Not found');
      const headers = {
        'Content-Type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
        'Accept-Ranges': 'bytes',
        'Content-Length': info.size,
      };
      let start = 0;
      let end = info.size - 1;
      let status = 200;
      // Video previews need byte ranges for reliable seeking and Safari playback.
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!match || (!match[1] && !match[2])) return send(416, 'Invalid range', { 'Content-Range': `bytes */${info.size}` });
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return send(416, 'Invalid range', { 'Content-Range': `bytes */${info.size}` });
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        headers['Content-Length'] = end - start + 1;
      }
      response.writeHead(status, headers);
      if (request.method === 'HEAD' || info.size === 0) return response.end();
      const stream = createReadStream(filename, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      send(['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code) ? 404 : 500, 'Unable to serve this resource');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.on('error', (error) => { console.error(`Kratex TV: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Kratex TV\nLocal: http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
