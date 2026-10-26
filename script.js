import { BroadcastController } from '/playback.js';

const $ = (id) => document.getElementById(id);
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`kratex:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`kratex:${key}`, JSON.stringify(value)); } catch { /* Playback still works with storage disabled. */ } },
};
const looks = ['y2k', 'clean', 'retro', 'bw'];
const lookNames = { y2k: 'Y2K', clean: 'CLEAN', retro: 'VHS', bw: 'BLACK & WHITE' };
const savedVolume = Number(storage.get('volume', 60));
const state = {
  channels: [], channel: 0, powered: false, playing: false,
  volume: Number.isFinite(savedVolume) ? Math.max(0, Math.min(100, savedVolume)) : 60,
  muted: storage.get('muted', false) === true,
  theme: storage.get('theme', 'night') === 'day' ? 'day' : 'night',
  look: looks.includes(storage.get('look', 'y2k')) ? storage.get('look', 'y2k') : 'y2k',
};
let apiPromise;
let catalogPromise;
let playerSequence = 0;
let osdTimer;
let remoteTimer;
let remotePinned = false;
let configPromise;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const channelCopy = {
  'podcasts/interviews': ['Conversations', 'Behind the sound'],
  music: ['Music', 'The originals'],
  'dj sets': ['DJ sets', 'Front-row energy'],
  'nusta vibes': ['Nusta Vibes', 'Nothing but a feeling'],
  vlogs: ['Vlogs', 'Life on the other side'],
  'reels/shorts': ['Shorts', 'Small doses. Big mood.'],
};
const currentChannel = () => state.channels[state.channel];
const channelName = (channel) => channelCopy[channel.name.toLowerCase()]?.[0] || channel.name;
const channelNumber = () => String(state.channel + 1).padStart(2, '0');

function announce(message) { $('announcement').textContent = message; }
function osd(message) {
  clearTimeout(osdTimer);
  $('screen-osd').textContent = message;
  $('screen-osd').classList.add('visible');
  osdTimer = setTimeout(() => $('screen-osd').classList.remove('visible'), 1800);
  announce(message);
}
function setPlaying(playing) {
  state.playing = playing;
  document.body.classList.toggle('is-playing', playing);
  $('play-button').setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  $('play-button').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
}
function setStatus(label, title) {
  $('playback-status').textContent = label;
  if (title) $('program-title').textContent = title;
}
function showMessage(title, detail, mode = 'loading') {
  $('screen-message').hidden = false;
  $('message-title').textContent = title;
  $('message-detail').textContent = detail;
  $('retry-button').hidden = mode !== 'error';
  $('resume-button').hidden = mode !== 'resume';
  $('message-next-channel').hidden = mode !== 'error';
}
function tuneEffect() {
  const noise = $('tuning-static');
  noise.classList.remove('active');
  // Restart the short CSS transition without an ongoing canvas animation.
  void noise.offsetWidth;
  noise.classList.add('active');
}
function syncChannel() {
  const channel = currentChannel();
  if (!channel) return;
  document.querySelectorAll('[data-channel]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.channel) === state.channel));
  });
  $('remote-channel').textContent = `CH ${channelNumber()}`;
  $('remote-display-name').textContent = channelName(channel).toUpperCase();
  storage.set('channel', channel.id);
}
function syncAudio(show = false) {
  broadcast.setAudio(state.volume, state.muted);
  const silent = state.muted || state.volume === 0;
  $('remote-volume').textContent = silent ? 'SOUND OFF' : `VOL ${state.volume}`;
  $('mute-button').setAttribute('aria-pressed', String(silent));
  $('mute-button').setAttribute('aria-label', silent ? 'Unmute sound' : 'Mute sound');
  $('mute-label').textContent = silent ? 'UNMUTE' : 'MUTE';
  $('mute-button').querySelector('use').setAttribute('href', silent ? '#i-mute' : '#i-volume');
  storage.set('volume', state.volume);
  storage.set('muted', state.muted);
  if (show) osd(silent ? 'MUTED' : `VOLUME ${state.volume} ${'▮'.repeat(Math.round(state.volume / 10))}`);
}
function applyTheme() {
  document.body.dataset.theme = state.theme;
  const day = state.theme === 'day';
  $('theme-label').textContent = day ? 'Day room' : 'Night room';
  $('theme-switch').setAttribute('aria-checked', String(day));
  $('theme-switch').querySelector('use').setAttribute('href', day ? '#i-sun' : '#i-moon');
  document.querySelector('meta[name="theme-color"]').content = day ? '#e4dfd6' : '#101018';
  storage.set('theme', state.theme);
}
function applyLook() {
  document.body.dataset.look = state.look;
  $('look-indicator').textContent = `${lookNames[state.look]} PICTURE`;
  storage.set('look', state.look);
}
function updateStandbyVideo() {
  if (state.powered || document.hidden || reduceMotion.matches) $('standby-video').pause();
  else $('standby-video').play().catch(() => {});
}

async function loadConfig() {
  try {
    const response = await fetch('/config.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Unable to load channels');
    const config = await response.json();
    state.channels = (config.channels || []).filter((channel) => typeof channel.name === 'string' && /^PL[\w-]+$/.test(channel.id));
    if (!state.channels.length) throw new Error('No configured channels');
    const saved = state.channels.findIndex((channel) => channel.id === storage.get('channel', null));
    const dj = state.channels.findIndex((channel) => channel.name.toLowerCase().includes('dj'));
    state.channel = saved >= 0 ? saved : Math.max(0, dj);
    $('channel-grid').replaceChildren();
    $('remote-numbers').replaceChildren();
    $('channel-count').textContent = ` / ${String(state.channels.length).padStart(2, '0')}`;
    state.channels.forEach((channel, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel-card';
      button.dataset.channel = index;
      button.setAttribute('aria-label', `Channel ${index + 1}: ${channelName(channel)}`);
      const values = [`CH ${String(index + 1).padStart(2, '0')}`, channelName(channel), channelCopy[channel.name.toLowerCase()]?.[1] || 'Tune in & zone out'];
      ['channel-number', 'channel-name', 'channel-description'].forEach((className, i) => {
        const span = document.createElement('span'); span.className = className; span.textContent = values[i]; button.append(span);
      });
      $('channel-grid').append(button);
      const number = document.createElement('button');
      number.type = 'button'; number.textContent = index + 1; number.dataset.channel = index;
      number.setAttribute('aria-label', `Channel ${index + 1}: ${channelName(channel)}`);
      $('remote-numbers').append(number);
    });
    syncChannel();
    return true;
  } catch {
    const message = document.createElement('p'); message.className = 'config-loading';
    message.textContent = 'The channel guide couldn’t load.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', () => { configPromise = loadConfig(); });
    message.append(retry); $('channel-grid').replaceChildren(message);
    return false;
  }
}

function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
    const fail = () => { clearTimeout(timeout); script.remove(); reject(new Error('The video signal couldn’t connect. Check your connection and try again.')); };
    const timeout = setTimeout(fail, 12000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(window.YT); };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error) => { apiPromise = undefined; throw error; });
  return apiPromise;
}
async function loadChannelCatalog(channelId) {
  if (!catalogPromise) {
    catalogPromise = fetch('/channel-catalog.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(response => { if (!response.ok) throw new Error('The channel video lists couldn’t load. Try again.'); return response.json(); })
      .catch(error => { catalogPromise = undefined; throw error; });
  }
  const data = await catalogPromise;
  const channel = data.channels?.[channelId];
  if (!channel || channel.playlistId !== channelId || !Array.isArray(channel.videos)) throw new Error('This channel’s video list is unavailable.');
  return channel;
}
const broadcast = new BroadcastController({
  loadCatalog: loadChannelCatalog,
  async createPlayer({ video, start, isCurrent, ...events }) {
    const YT = await loadYouTubeAPI();
    if (!isCurrent()) return;
    const mount = document.createElement('div');
    mount.id = `broadcast-player-${++playerSequence}`;
    $('player-container').replaceChildren(mount);
    $('screen').dataset.videoShape = video.portrait ? 'portrait' : 'landscape';
    const player = new YT.Player(mount.id, {
      width: '100%', height: '100%', videoId: video.id,
      playerVars: {
        start, autoplay: 1, mute: 1, controls: 0, disablekb: 1,
        fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3,
        origin: window.location.origin,
      },
      events,
    });
    const frame = player.getIframe();
    frame.title = 'Kratex TV broadcast';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    fitPlayer();
    return player;
  },
  emit(event) {
    if (event.channelId && event.channelId !== currentChannel()?.id) return;
    const screen = $('screen');
    screen.dataset.playback = event.type;
    if (event.type === 'selected') {
      screen.dataset.videoId = event.video.id;
      screen.dataset.playlistId = event.channelId;
      screen.dataset.startSeconds = event.start ?? '';
      setStatus(`TUNING IN / CH ${channelNumber()}`, event.video.title);
    } else if (event.type === 'loading') {
      setPlaying(false);
      showMessage(event.buffering ? 'Hold that frequency…' : 'Finding your frequency…', event.retrying ? 'Trying another video from this channel.' : `Tuning into ${channelName(currentChannel())}.`);
    } else if (event.type === 'playing') {
      screen.dataset.startSeconds = event.start;
      $('screen-message').hidden = true;
      setPlaying(true);
      setStatus(`NOW PLAYING / CH ${channelNumber()} / ${channelName(currentChannel()).toUpperCase()}`, event.video.title);
    } else if (event.type === 'paused' || event.type === 'blocked') {
      setPlaying(false);
      showMessage(event.type === 'paused' ? 'Take your time.' : 'Your channel is ready.', 'Press play on the remote or below to tune in.', 'resume');
      setStatus(`${event.type === 'paused' ? 'PAUSED' : 'PRESS PLAY'} / CH ${channelNumber()}`);
    } else if (event.type === 'error') {
      screen.dataset.errorCode = event.code ?? '';
      setPlaying(false);
      showMessage('A little signal trouble.', event.message, 'error');
      setStatus(`SIGNAL INTERRUPTED / CH ${channelNumber()} / ${channelName(currentChannel()).toUpperCase()}`, 'Try again or pick another channel.');
      announce(event.message);
    }
  },
});
function fitPlayer() {
  const frame = $('player-container').querySelector('iframe');
  if (!frame) return;
  const { width, height } = $('screen').getBoundingClientRect();
  const ratio = $('screen').dataset.videoShape === 'portrait' ? 9 / 16 : 16 / 9;
  // Add a matte above/below the native frame, outside the visible CRT aperture.
  // Its video retains its aspect ratio; provider edge chrome stays in the matte.
  frame.style.width = `${Math.min(width, height * ratio)}px`;
  frame.style.height = `${height + 140}px`;
}
new ResizeObserver(fitPlayer).observe($('screen'));
function tune(options = {}) {
  if (!currentChannel()) return;
  state.powered = true;
  document.body.classList.add('powered-on');
  $('tv-power').setAttribute('aria-pressed', 'true');
  $('tv-power').setAttribute('aria-label', 'Turn television off');
  $('standby-screen').hidden = true;
  updateStandbyVideo(); setPlaying(false); syncChannel(); tuneEffect();
  setStatus(`TUNING IN / CH ${channelNumber()}`, channelName(currentChannel()));
  broadcast.tune(currentChannel().id, options);
  osd(`CH ${channelNumber()} · ${channelName(currentChannel()).toUpperCase()}`);
}
async function powerOn() {
  if (!state.channels.length && !(await configPromise)) { announce('The channels could not load. Use Try again in the channel guide.'); return; }
  tune();
}
function powerOff() {
  state.powered = false;
  clearTimeout(osdTimer);
  broadcast.stop();
  setPlaying(false);
  document.body.classList.remove('powered-on');
  $('tv-power').setAttribute('aria-pressed', 'false');
  $('tv-power').setAttribute('aria-label', 'Turn television on');
  $('screen-message').hidden = true; $('standby-screen').hidden = false;
  $('screen-osd').classList.remove('visible');
  setStatus('READY WHEN YOU ARE', 'Your front-row seat to the world of Kratex.');
  updateStandbyVideo(); announce('Television off');
}
function selectChannel(index) {
  if (!state.channels.length) return;
  state.channel = (index + state.channels.length) % state.channels.length;
  tune();
}
function changeVolume(amount) { state.volume = Math.max(0, Math.min(100, state.volume + amount)); state.muted = false; syncAudio(true); }
function toggleMute() {
  if (state.muted || state.volume === 0) { state.muted = false; if (!state.volume) state.volume = 60; }
  else state.muted = true;
  syncAudio(true);
}
function playPause() {
  if (!state.powered) { powerOn(); return; }
  if (state.playing) broadcast.pause(); else broadcast.resume();
}
function changeProgram(direction) {
  if (!state.powered) { powerOn(); return; }
  tune({ previous: direction < 0 });
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('television').requestFullscreen) await $('television').requestFullscreen();
    else osd('FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER');
  } catch { osd('FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER'); }
}
function setRemote(open) {
  clearTimeout(remoteTimer);
  $('remote-dock').classList.toggle('is-open', open);
  $('remote-toggle').setAttribute('aria-expanded', String(open));
  $('remote').inert = !open;
}
const actions = {
  power: () => state.powered ? powerOff() : powerOn(),
  'channel-next': () => selectChannel(state.channel + 1), 'channel-prev': () => selectChannel(state.channel - 1),
  'volume-up': () => changeVolume(10), 'volume-down': () => changeVolume(-10), mute: toggleMute,
  'program-next': () => changeProgram(1), 'program-prev': () => changeProgram(-1), play: playPause,
  look: () => { state.look = looks[(looks.indexOf(state.look) + 1) % looks.length]; applyLook(); osd(`${lookNames[state.look]} PICTURE`); },
  fullscreen,
  guide: () => { remotePinned = false; setRemote(false); $('channel-section').scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'center' }); document.querySelector('.channel-card')?.focus({ preventScroll: true }); },
};
document.addEventListener('click', (event) => {
  const channel = event.target.closest('[data-channel]');
  if (channel) selectChannel(Number(channel.dataset.channel));
  const action = event.target.closest('[data-action]');
  if (action) actions[action.dataset.action]?.();
  if (!$('remote-dock').contains(event.target)) { remotePinned = false; setRemote(false); }
});
$('watch-button').addEventListener('click', () => { $('tv-power').focus({ preventScroll: true }); powerOn(); });
$('retry-button').addEventListener('click', () => tune());
$('resume-button').addEventListener('click', playPause);
$('theme-switch').addEventListener('click', () => { state.theme = state.theme === 'night' ? 'day' : 'night'; applyTheme(); });
$('remote-toggle').addEventListener('click', () => { remotePinned = !remotePinned; setRemote(remotePinned); });
$('remote-dock').addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') setRemote(true); });
$('remote-dock').addEventListener('pointerleave', () => {
  if (!remotePinned && !$('remote').contains(document.activeElement)) remoteTimer = setTimeout(() => setRemote(false), 350);
});
$('remote-dock').addEventListener('focusin', () => setRemote(true));
$('remote-dock').addEventListener('focusout', (event) => { if (!remotePinned && !$('remote-dock').contains(event.relatedTarget)) setRemote(false); });
$('shortcuts-button').addEventListener('click', () => $('shortcuts-dialog').showModal());
$('close-shortcuts').addEventListener('click', () => $('shortcuts-dialog').close());
$('shortcuts-dialog').addEventListener('click', (event) => { if (event.target === $('shortcuts-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]') || $('shortcuts-dialog').open) return;
  if (event.key === 'Escape') { remotePinned = false; if ($('remote').contains(document.activeElement)) $('remote-toggle').focus(); setRemote(false); return; }
  if (event.key === ' ' && event.target.closest('button, a')) return;
  const shortcuts = { ArrowRight: 'channel-next', ArrowLeft: 'channel-prev', ArrowUp: 'volume-up', ArrowDown: 'volume-down', ' ': 'play', p: 'power', m: 'mute', l: 'look', f: 'fullscreen' };
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (shortcuts[key]) { event.preventDefault(); if (!event.repeat || key.startsWith('Arrow')) actions[shortcuts[key]](); }
  else if (/^[1-9]$/.test(key) && Number(key) <= state.channels.length) { event.preventDefault(); selectChannel(Number(key) - 1); }
  else if (key === 'd') $('theme-switch').click();
  else if (key === 'r') { remotePinned = !$('remote-dock').classList.contains('is-open'); setRemote(remotePinned); }
  else if (key === '?') $('shortcuts-dialog').showModal();
});
function updateClock() { $('screen-clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date()); }
document.addEventListener('visibilitychange', updateStandbyVideo);
document.addEventListener('fullscreenchange', () => {
  // Keep the remote available when the TV enters the browser's fullscreen layer.
  const fullscreenTV = document.fullscreenElement === $('television');
  (fullscreenTV ? $('television') : document.body).append($('remote-dock'));
});
reduceMotion.addEventListener('change', updateStandbyVideo);
applyTheme(); applyLook(); syncAudio(); updateClock(); updateStandbyVideo();
setInterval(updateClock, 30000);
configPromise = loadConfig();
