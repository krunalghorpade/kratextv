import { readFile, writeFile, rename } from 'node:fs/promises';
import { fetchPlaylist } from '../lib/playlist-catalog.mjs';
const root = new URL('../', import.meta.url);
const { channels } = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
const results = await Promise.all(channels.map(async channel => {
  const catalog = await fetchPlaylist(channel.id);
  console.log(`${channel.name}: ${catalog.videos.length} verified playlist videos`);
  return [channel.id, catalog];
}));
const temporary = new URL('channel-catalog.json.tmp', root);
await writeFile(temporary, JSON.stringify({ version: 1, channels: Object.fromEntries(results) }, null, 2) + '\n');
await rename(temporary, new URL('channel-catalog.json', root));
console.log('Saved channel-catalog.json.');
