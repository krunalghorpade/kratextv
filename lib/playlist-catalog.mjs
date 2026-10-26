// Only playlist-member records are accepted. Suggested videos and menus are ignored.
export function extractJSON(source, marker) {
  const match = marker.exec(source);
  if (!match) throw new Error('Playlist page data is unavailable');
  const start = source.indexOf('{', match.index + match[0].length);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error('Incomplete playlist page data');
}
export function parseDuration(value) {
  if (typeof value === 'number' || /^\d+$/.test(value || '')) return Number(value) || 0;
  if (!/^\d+(?::\d{2}){1,2}$/.test(value || '')) return 0;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
export function parsePlaylistPage(data, playlistId) {
  const videos = new Map();
  const continuations = new Set();
  const add = (id, title, duration, member, portrait = false) => {
    if (member !== playlistId || !/^[\w-]{11}$/.test(id || '') || !title || /\[(?:Private|Deleted) video\]/i.test(title)) return;
    videos.set(id, { id, title, duration: parseDuration(duration), portrait });
  };
  function walk(node, inPlaylist = false) {
    if (!node || typeof node !== 'object') return;
    if (node.playlistVideoRenderer) {
      const v = node.playlistVideoRenderer;
      const member = v.navigationEndpoint?.watchEndpoint?.playlistId;
      if (v.isPlayable !== false) add(v.videoId, v.title?.simpleText || v.title?.runs?.map(r => r.text).join(''), v.lengthSeconds || v.lengthText?.simpleText, member || (inPlaylist ? playlistId : undefined));
      return;
    }
    if (node.lockupViewModel) {
      const v = node.lockupViewModel;
      const endpoint = v.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
      const badges = v.contentImage?.thumbnailViewModel?.overlays?.flatMap(o => o.thumbnailBottomOverlayViewModel?.badges || []) || [];
      const duration = badges.map(b => b.thumbnailBadgeViewModel?.text).find(text => parseDuration(text) > 0);
      if (v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') add(v.contentId, v.metadata?.lockupMetadataViewModel?.title?.content, duration, endpoint?.playlistId);
      return;
    }
    if (node.shortsLockupViewModel) {
      const v = node.shortsLockupViewModel;
      const endpoint = v.onTap?.innertubeCommand?.reelWatchEndpoint;
      add(endpoint?.videoId, v.overlayMetadata?.primaryText?.content, 0, endpoint?.playlistId, true);
      return;
    }
    if (node.continuationItemRenderer) {
      const token = node.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
      if (token) continuations.add(token);
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, inPlaylist || key === 'playlistVideoListRenderer');
  }
  // Never traverse headers, sidebars, or recommendation panels.
  walk(data.contents);
  for (const action of [...(data.onResponseReceivedActions || []), ...(data.onResponseReceivedEndpoints || [])]) {
    walk(action.appendContinuationItemsAction?.continuationItems, true);
    walk(action.reloadContinuationItemsCommand?.continuationItems, true);
  }
  return { videos: [...videos.values()], continuations: [...continuations] };
}
export async function fetchPlaylist(playlistId, { fetchImpl = fetch } = {}) {
  if (!/^PL[\w-]+$/.test(playlistId)) throw new Error('Invalid playlist ID');
  const response = await fetchImpl(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Playlist request failed (${response.status})`);
  const html = await response.text();
  const data = extractJSON(html, /(?:var\s+ytInitialData\s*=|window\["ytInitialData"\]\s*=)/);
  const first = parsePlaylistPage(data, playlistId);
  const videos = new Map(first.videos.map(video => [video.id, video]));
  const queue = [...first.continuations];
  const visited = new Set();
  let context;
  if (queue.length) {
    const config = extractJSON(html, /ytcfg\.set\(\s*(?=\{")/);
    context = config.INNERTUBE_CONTEXT;
    if (!context?.client?.clientVersion) throw new Error('Playlist pagination context is missing');
  }
  while (queue.length) {
    const continuation = queue.shift();
    if (visited.has(continuation)) continue;
    if (visited.size >= 30) throw new Error('Playlist exceeds the supported page limit');
    visited.add(continuation);
    const page = await fetchImpl('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, continuation }), signal: AbortSignal.timeout(15000),
    });
    if (!page.ok) throw new Error(`Playlist pagination failed (${page.status})`);
    const parsed = parsePlaylistPage(await page.json(), playlistId);
    for (const video of parsed.videos) videos.set(video.id, video);
    queue.push(...parsed.continuations);
  }
  if (!videos.size) throw new Error('This playlist has no public playable videos');
  return { playlistId, title: data.metadata?.playlistMetadataRenderer?.title || '', fetchedAt: new Date().toISOString(), videos: [...videos.values()] };
}
