// Playback is isolated from the room UI so races can be tested with a fake player.
export function randomStart(duration, random = Math.random) {
  if (!Number.isFinite(duration) || duration <= 1) return 0;
  const minimum = Math.min(5, duration * 0.05);
  const maximum = Math.max(minimum, Math.min(duration * 0.9, duration - Math.min(5, duration * 0.1)));
  return Math.floor(minimum + Math.max(0, Math.min(0.999999, random())) * (maximum - minimum));
}
export function chooseVideo(videos, previousId, random = Math.random, excluded = []) {
  const available = videos.filter(video => !excluded.includes(video.id));
  const different = available.filter(video => video.id !== previousId);
  const choices = different.length ? different : available;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id),
};
export class BroadcastController {
  constructor({ loadCatalog, createPlayer, emit = () => {}, random = Math.random, clock = defaultClock }) {
    this.loadCatalog = loadCatalog; this.createPlayer = createPlayer; this.emit = emit;
    this.random = random; this.clock = clock; this.generation = 0; this.active = null;
    this.volume = 60; this.muted = false; this.history = new Map();
  }
  current(session) { return this.active === session && session.token === this.generation; }
  clearTimers(session) {
    this.clock.clearTimeout(session.timeout); this.clock.clearInterval(session.poll);
    session.timeout = null; session.poll = null;
  }
  dispose() {
    const old = this.active;
    this.active = null;
    if (!old) return;
    this.clearTimers(old);
    try { old.player?.mute(); old.player?.destroy(); } catch { /* A replaced iframe may already be detached. */ }
  }
  async tune(channelId, { previous = false, failed = [] } = {}) {
    this.generation++;
    this.dispose();
    const session = { token: this.generation, channelId, failed, player: null, video: null, revealed: false, paused: false, seekApplied: false, start: null, settleAt: null, playing: false };
    this.active = session;
    this.emit({ type: 'loading', channelId, retrying: failed.length > 0 });
    this.armTimeout(session);
    try {
      const catalog = await this.loadCatalog(channelId);
      if (!this.current(session)) return;
      if (catalog.playlistId !== channelId) throw new Error('This channel’s video list could not be verified.');
      const videos = catalog.videos.filter(v => /^[\w-]{11}$/.test(v.id));
      const history = this.history.get(channelId) || [];
      const oldId = history.at(-1);
      const priorId = previous && history.length > 1 ? history.at(-2) : null;
      const video = (priorId && videos.find(v => v.id === priorId && !failed.includes(v.id))) || chooseVideo(videos, oldId, this.random, failed);
      if (!video) throw new Error('No playable videos are available in this channel right now.');
      session.video = video;
      session.videoCount = videos.length;
      session.start = video.duration > 0 ? randomStart(video.duration, this.random) : null;
      this.emit({ type: 'selected', channelId, video, start: session.start });
      const player = await this.createPlayer({
        video, start: session.start || 0,
        isCurrent: () => this.current(session),
        onReady: event => this.ready(session, event.target),
        onStateChange: event => this.onState(session, event),
        onError: event => this.onError(session, event),
        onAutoplayBlocked: () => this.blocked(session),
      });
      if (!this.current(session)) { player?.destroy(); return; }
      session.player = player;
    } catch (error) { this.fail(session, error.message); }
  }
  armTimeout(session) {
    this.clock.clearTimeout(session.timeout);
    session.timeout = this.clock.setTimeout(() => {
      if (!this.current(session)) return;
      if (session.player && session.video && session.player.getVideoData()?.video_id === session.video.id && [-1, 2, 5].includes(session.player.getPlayerState())) this.blocked(session);
      else this.fail(session, 'The signal is taking too long. Check your connection or try this channel again.');
    }, 25000);
  }
  ready(session, player) {
    if (!this.current(session)) { player.destroy(); return; }
    session.player = player;
    player.mute(); player.setVolume(this.volume); player.playVideo();
    this.armTimeout(session);
  }
  onState(session, event) {
    if (!this.current(session) || session.error || event.target !== session.player || !session.video) return;
    const player = session.player;
    const actualId = player.getVideoData()?.video_id;
    // Never reveal, seek, or label a frame belonging to another request/video.
    if (actualId && actualId !== session.video.id) {
      player.mute();
      this.emit({ type: 'loading', channelId: session.channelId });
      return;
    }
    if (event.data === 1) {
      if (!actualId) return;
      if (session.paused) { player.pauseVideo(); return; }
      session.playing = true;
      if (session.revealed) {
        this.clock.clearTimeout(session.timeout);
        this.emit({ type: 'playing', channelId: session.channelId, video: session.video, start: session.start });
        this.applyAudio();
      } else {
        this.clock.clearInterval(session.poll);
        session.poll = this.clock.setInterval(() => this.checkPosition(session), 100);
        this.checkPosition(session);
      }
    } else if (event.data === 2) {
      session.playing = false;
      if (session.paused) {
        this.clock.clearTimeout(session.timeout);
        this.emit({ type: 'paused', channelId: session.channelId });
      } else this.blocked(session);
    } else if (event.data === 3) {
      session.playing = false; session.settleAt = null;
      this.emit({ type: 'loading', channelId: session.channelId, buffering: true });
      this.armTimeout(session);
    } else if (event.data === 0 && actualId === session.video.id) {
      // A single-video embed has no playlist/recommendation authority over the TV.
      this.tune(session.channelId);
    }
  }
  checkPosition(session) {
    if (!this.current(session) || !session.playing || session.paused) return;
    const player = session.player;
    if (player.getVideoData()?.video_id !== session.video.id || player.getPlayerState() !== 1) return;
    const duration = player.getDuration();
    if (!(duration > 0)) return; // Shorts often expose duration only once playback begins.
    if (session.start === null || session.start >= duration - 1) session.start = randomStart(duration, this.random);
    const position = player.getCurrentTime();
    if (!session.seekApplied) {
      session.seekApplied = true;
      if (Math.abs(position - session.start) > 2) {
        session.settleAt = null;
        player.seekTo(session.start, true);
        return;
      }
    }
    if (position < session.start - 2 || position > session.start + 20) return;
    if (session.settleAt === null) { session.settleAt = this.clock.now() + 700; session.firstPosition = position; return; }
    if (this.clock.now() < session.settleAt || position <= session.firstPosition) return;
    session.revealed = true;
    this.clearTimers(session);
    const history = this.history.get(session.channelId) || [];
    if (history.at(-1) !== session.video.id) history.push(session.video.id);
    this.history.set(session.channelId, history.slice(-50));
    this.emit({ type: 'playing', channelId: session.channelId, video: session.video, start: session.start });
    this.applyAudio();
  }
  onError(session, event) {
    if (!this.current(session) || event.target !== session.player) return;
    const failed = [...session.failed, session.video.id];
    if ([2, 5, 100, 101, 150].includes(event.data) && failed.length < Math.min(5, session.videoCount)) {
      this.tune(session.channelId, { failed });
    } else this.fail(session, event.data === 153
      ? 'The video provider could not verify this player. Try this page in your browser.'
      : [100, 101, 150].includes(event.data)
        ? 'This channel’s videos are unavailable for embedded playback. Try another channel or try again later.'
        : 'These videos cannot play here right now. Try another channel or try again.', event.data);
  }
  blocked(session) {
    if (!this.current(session) || session.error) return;
    this.clearTimers(session);
    session.playing = false;
    this.emit({ type: 'blocked', channelId: session.channelId });
  }
  fail(session, message, code) {
    if (!this.current(session)) return;
    session.error = true;
    this.clearTimers(session);
    session.playing = false;
    session.player?.mute();
    session.player?.pauseVideo();
    this.emit({ type: 'error', channelId: session.channelId, message, code });
  }
  pause() {
    const session = this.active;
    if (!session?.player) return;
    session.paused = true; session.playing = false;
    this.clearTimers(session);
    this.emit({ type: 'paused', channelId: session.channelId });
    session.player.pauseVideo();
  }
  resume() {
    const session = this.active;
    if (!session?.player) return;
    session.paused = false;
    this.emit({ type: 'loading', channelId: session.channelId, buffering: true });
    // This runs directly from the visitor's tap, satisfying sound autoplay rules.
    session.player.setVolume(this.volume);
    if (!this.muted) session.player.unMute();
    session.player.playVideo();
    this.armTimeout(session);
  }
  setAudio(volume, muted) {
    this.volume = volume; this.muted = muted;
    this.applyAudio();
  }
  applyAudio() {
    const session = this.active;
    if (!session?.player) return;
    session.player.setVolume(this.volume);
    if (this.muted || !session.revealed) session.player.mute(); else session.player.unMute();
  }
  stop() {
    this.generation++; this.dispose(); this.emit({ type: 'stopped' });
  }
}
