import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastController, randomStart, chooseVideo } from '../playback.js';

const video = (id, duration = 100) => ({ id, duration, title: id });
const catalogs = {
  music: { playlistId: 'music', videos: [video('music000001'), video('music000002')] },
  dj: { playlistId: 'dj', videos: [video('djset000001', 3600)] },
  shorts: { playlistId: 'shorts', videos: [video('short000001', 0)] },
};
function fixture(loadCatalog = async id => catalogs[id]) {
  let time = 0, nextId = 0;
  const jobs = new Map(), events = [], players = [];
  const clock = {
    now: () => time,
    setTimeout(fn, delay) { const id = ++nextId; jobs.set(id, { fn, at: time + delay }); return id; },
    setInterval(fn, delay) { const id = ++nextId; jobs.set(id, { fn, at: time + delay, delay }); return id; },
    clearTimeout: id => jobs.delete(id), clearInterval: id => jobs.delete(id),
  };
  const controller = new BroadcastController({ loadCatalog, random: () => 0.5, clock, emit: event => events.push(event), createPlayer: async options => {
    const p = {
      options, id: options.video.id, position: options.start, duration: options.video.duration || 40,
      state: -1, muted: true, destroyed: false, seeks: [],
      getVideoData() { return { video_id: this.id }; },
      getPlayerState() { return this.state; }, getDuration() { return this.duration; }, getCurrentTime() { return this.position; },
      mute() { this.muted = true; }, unMute() { this.muted = false; }, setVolume(value) { this.volume = value; },
      destroy() { this.destroyed = true; }, playVideo() {},
      pauseVideo() { this.change(2); },
      seekTo(position) { this.seeks.push(position); },
      change(state) { this.state = state; options.onStateChange({ target: this, data: state }); },
      ready() { options.onReady({ target: this }); },
      error(code) { options.onError({ target: this, data: code }); },
    };
    players.push(p); return p;
  } });
  function tick(ms) {
    const end = time + ms;
    while (true) {
      const entry = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, job] = entry;
      const elapsed = job.at - time; time = job.at;
      for (const p of players) if (p.state === 1 && !p.destroyed) p.position += elapsed / 1000;
      if (job.delay) job.at += job.delay; else jobs.delete(id);
      job.fn();
    }
    for (const p of players) if (p.state === 1 && !p.destroyed) p.position += (end - time) / 1000;
    time = end;
  }
  const settle = p => { p.ready(); p.change(1); tick(1000); };
  return { controller, events, players, tick, settle, jobs };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('random starts stay away from the end and video selection avoids repeats', () => {
  for (const duration of [5, 15, 100, 7200]) for (const r of [0, 0.5, 0.99999]) {
    const start = randomStart(duration, () => r);
    assert.ok(start >= 0 && start < duration * 0.91);
  }
  assert.ok(randomStart(3600, () => 0.5) > 1000);
  assert.equal(chooseVideo(catalogs.music.videos, 'music000001', () => 0).id, 'music000002');
  assert.equal(chooseVideo(catalogs.music.videos, null, () => 0, ['music000001']).id, 'music000002');
});

test('late catalog requests and stale player events cannot replace the chosen channel', async () => {
  let resolveMusic;
  const f = fixture(id => id === 'music' ? new Promise(resolve => { resolveMusic = resolve; }) : Promise.resolve(catalogs[id]));
  const pending = f.controller.tune('music');
  await f.controller.tune('dj');
  resolveMusic(catalogs.music); await pending;
  assert.equal(f.players.length, 1); assert.equal(f.players[0].id, 'djset000001');
  f.settle(f.players[0]);
  await f.controller.tune('shorts');
  const mark = f.events.length;
  f.players[0].change(1); f.players[0].error(100);
  assert.equal(f.events.length, mark); assert.equal(f.players[0].destroyed, true);
  assert.equal(f.controller.active.channelId, 'shorts');
});

test('unknown Shorts duration is randomly sought and hidden until the seek finishes', async () => {
  const f = fixture(); await f.controller.tune('shorts');
  const p = f.players[0]; p.ready(); p.change(1);
  assert.equal(p.seeks.length, 1); assert.ok(p.seeks[0] > 0);
  f.tick(2000);
  assert.equal(f.events.some(e => e.type === 'playing'), false);
  p.position = p.seeks[0]; f.tick(1000);
  assert.equal(f.events.at(-1).type, 'playing');
  assert.equal(f.events.at(-1).start, p.seeks[0]); assert.equal(p.muted, false);
});

test('a mismatched video ID is never revealed', async () => {
  const f = fixture(); await f.controller.tune('dj');
  const p = f.players[0]; p.ready(); p.id = 'music000001'; p.change(1); f.tick(2000);
  assert.equal(f.events.some(e => e.type === 'playing'), false); assert.equal(p.muted, true);
});

test('unavailable videos retry inside the same channel and stop when exhausted', async () => {
  const f = fixture(); await f.controller.tune('music');
  f.players[0].error(150); await flush();
  assert.equal(f.players.length, 2); assert.notEqual(f.players[0].id, f.players[1].id);
  assert.equal(f.controller.active.channelId, 'music');
  f.players[1].error(100); await flush();
  assert.equal(f.events.at(-1).type, 'error'); assert.equal(f.players.length, 2);
  f.players[1].change(1);
  assert.equal(f.events.at(-1).type, 'error');
  f.controller.pause(); // Opening the external video must not hide the recovery controls.
  assert.equal(f.events.at(-1).type, 'error');
});

test('pause/resume keeps the random position and audio preferences', async () => {
  const f = fixture(); f.controller.setAudio(30, true); await f.controller.tune('dj');
  const p = f.players[0]; f.settle(p); const start = f.events.at(-1).start;
  assert.equal(p.muted, true); assert.equal(p.volume, 30);
  f.controller.pause(); assert.equal(f.events.at(-1).type, 'paused');
  f.controller.resume(); p.change(1);
  assert.equal(f.events.at(-1).type, 'playing'); assert.equal(f.events.at(-1).start, start);
  assert.equal(p.seeks.length, 0); assert.equal(p.muted, true);
  f.controller.setAudio(70, false); assert.equal(p.muted, false); assert.equal(p.volume, 70);
});

test('opening the full video while the TV loads keeps a late player paused', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.controller.tune('dj');
  f.controller.pause();
  resolve(catalogs.dj); await pending;
  const p = f.players[0];
  p.ready(); p.change(1); f.tick(2000);
  assert.equal(p.state, 2);
  assert.equal(p.muted, true);
  assert.equal(f.events.at(-1).type, 'paused');
  assert.equal(f.events.some(event => event.type === 'playing'), false);
});

test('ended video advances within its channel without immediately repeating', async () => {
  const f = fixture(); await f.controller.tune('music'); const p = f.players[0]; f.settle(p);
  p.change(0); await flush();
  assert.equal(f.controller.active.channelId, 'music'); assert.notEqual(f.players[1].id, p.id);
  assert.equal(p.destroyed, true);
});

test('program navigation follows playlist order, wraps, and stays in its channel', async () => {
  const playlist = { playlistId: 'music', videos: [video('music000001'), video('music000002'), video('music000003')] };
  const f = fixture(async id => id === 'music' ? playlist : catalogs[id]);
  await f.controller.tune('music');
  assert.equal(f.controller.active.video.id, 'music000002');
  for (const [direction, expected] of [[-1, 'music000001'], [-1, 'music000003'], [1, 'music000001'], [1, 'music000002']]) {
    await f.controller.tune('music', { direction });
    assert.equal(f.controller.active.channelId, 'music');
    assert.equal(f.controller.active.video.id, expected);
    assert.ok(f.controller.active.start > 0);
    const selected = f.events.at(-1);
    assert.equal(selected.type, 'selected');
    assert.equal(selected.index, playlist.videos.findIndex(v => v.id === expected));
    assert.equal(selected.count, 3);
  }
  await f.controller.tune('dj');
  assert.equal(f.controller.active.video.id, 'djset000001');
});

test('turning off cancels timers and a pending catalog load', async () => {
  let resolve;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  const pending = f.controller.tune('dj'); f.controller.stop(); resolve(catalogs.dj); await pending;
  f.tick(30000);
  assert.equal(f.players.length, 0); assert.equal(f.jobs.size, 0); assert.equal(f.events.at(-1).type, 'stopped');
});

test('a catalog with the wrong playlist identity fails closed', async () => {
  const f = fixture(async () => catalogs.music); await f.controller.tune('dj');
  assert.equal(f.players.length, 0); assert.equal(f.events.at(-1).type, 'error');
});
