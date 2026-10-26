import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractJSON, parseDuration, parsePlaylistPage, fetchPlaylist } from '../lib/playlist-catalog.mjs';
const playlistId = 'PL_ours';
const record = (id, list = playlistId) => ({ playlistVideoRenderer: { videoId: id, title: { simpleText: id }, lengthText: { simpleText: '2:30' }, navigationEndpoint: { watchEndpoint: { playlistId: list } } } });
test('parses JSON with quoted braces and escaped quotes', () => {
  const data = { title: 'a } brace and a " quote', nested: { items: [1] } };
  assert.deepEqual(extractJSON(`var ytInitialData = ${JSON.stringify(data)}; other();`, /var ytInitialData = /), data);
  assert.equal(parseDuration('1:02:03'), 3723); assert.equal(parseDuration('LIVE'), 0);
});
test('accepts only members, handles modern cards/Shorts, excludes recommendations and duplicates', () => {
  const data = { contents: { playlistVideoListRenderer: { contents: [
    record('music000001'), record('music000001'), record('foreign0001', 'PL_other'),
    { ...record('private0001'), playlistVideoRenderer: { ...record('private0001').playlistVideoRenderer, isPlayable: false } },
    { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'djset000001', metadata: { lockupMetadataViewModel: { title: { content: 'DJ set' } } }, rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { playlistId } } } } }, contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '1:00:00' } }] } }] } } } },
    { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'short000001', playlistId } } }, overlayMetadata: { primaryText: { content: 'Short' } } } },
  ] } }, sidebar: record('sidebar0001') };
  const videos = parsePlaylistPage(data, playlistId).videos;
  assert.deepEqual(videos.map(v => v.id), ['music000001', 'djset000001', 'short000001']);
  assert.equal(videos[1].duration, 3600); assert.equal(videos[2].portrait, true);
});
test('fetches continuation pages, deduplicates videos and ignores repeated tokens', async () => {
  const continuation = { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'page2' } } } };
  const first = { contents: { playlistVideoListRenderer: { contents: [record('music000001'), continuation] } } };
  const next = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [record('music000001'), record('music000002'), continuation] } }] };
  const calls = [];
  const result = await fetchPlaylist(playlistId, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? { ok: true, text: async () => `ytcfg.set = function(k,v) {}; ytcfg.set(${JSON.stringify({ INNERTUBE_CONTEXT: { client: { clientVersion: 'test' } } })}); var ytInitialData = ${JSON.stringify(first)};` }
      : { ok: true, json: async () => next };
  } });
  assert.equal(calls.length, 2); assert.equal(result.videos.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).continuation, 'page2');
});
test('committed catalog covers every configured channel with distinct valid videos', async () => {
  const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  const catalog = JSON.parse(await readFile(new URL('../channel-catalog.json', import.meta.url)));
  for (const channel of config.channels) {
    const data = catalog.channels[channel.id];
    assert.equal(data.playlistId, channel.id); assert.ok(data.videos.length > 0);
    assert.equal(new Set(data.videos.map(v => v.id)).size, data.videos.length);
    assert.ok(data.videos.every(v => /^[\w-]{11}$/.test(v.id)));
  }
});
