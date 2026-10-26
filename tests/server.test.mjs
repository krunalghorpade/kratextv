import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

let server, base;
before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); });

test('serves the application, configuration, and health endpoint', async () => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /id="television"/);
  const config = await (await fetch(`${base}/config.json`)).json();
  assert.equal(config.channels.length, 6);
  const catalog = await (await fetch(`${base}/channel-catalog.json`)).json();
  assert.ok(config.channels.every(channel => catalog.channels[channel.id]?.videos.length));
  const playback = await fetch(`${base}/playback.js`);
  assert.equal(playback.status, 200);
  assert.match(playback.headers.get('content-type'), /javascript/);
  assert.equal((await (await fetch(`${base}/health`)).json()).status, 'ok');
});

test('protects source files, dotfiles, and traversal paths', async () => {
  for (const route of ['/server.mjs', '/package.json', '/.git/config', '/.env', '/assets/%2e%2e%2fpackage.json', '/assets/%5c..%5c.env', '/assets/%00']) {
    assert.equal((await fetch(`${base}${route}`)).status, 404, route);
  }
  assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});

test('supports media byte ranges, suffix ranges, and HEAD', async () => {
  const url = `${base}/assets/videos/tvthumb.mp4`;
  const size = (await stat(new URL('../assets/videos/tvthumb.mp4', import.meta.url))).size;
  const range = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-1023/${size}`);
  assert.equal((await range.arrayBuffer()).byteLength, 1024);
  const suffix = await fetch(url, { headers: { Range: 'bytes=-512' } });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 512);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), size);
  assert.equal(await head.text(), '');
  for (const value of ['bytes=999999999-', 'bytes=7-3', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-']) {
    assert.equal((await fetch(url, { headers: { Range: value } })).status, 416, value);
  }
});

test('does not expose files through an asset symlink', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kratex-server-'));
  try {
    await mkdir(path.join(root, 'public', 'assets'), { recursive: true });
    await writeFile(path.join(root, 'private.txt'), 'private');
    await symlink(path.join(root, 'private.txt'), path.join(root, 'public', 'assets', 'link.txt'));
    const scoped = createServer({ root: path.join(root, 'public') });
    await new Promise((resolve) => scoped.listen(0, '127.0.0.1', resolve));
    try { assert.equal((await fetch(`http://127.0.0.1:${scoped.address().port}/assets/link.txt`)).status, 404); }
    finally { await new Promise((resolve) => scoped.close(resolve)); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
