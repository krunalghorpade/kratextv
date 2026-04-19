let APP_CONFIG = {};
let player;
let isPlayerReady = false;
let currentPlaylist = [];
let staticTimeout;
let hudTimeout;
let isFirstLoad = true;
let isSeekingToRandom = false;

// Fetch config
fetch('config.json')
    .then(r => r.json())
    .then(data => {
        let id = data.playlist_id;
        if (!id && data.playlist_url) {
            const match = data.playlist_url.match(/list=([^&]+)/);
            if (match) id = match[1];
        }
        APP_CONFIG.playlistId = id;
        
        // If player is already ready but was waiting for config
        if (isPlayerReady && APP_CONFIG.playlistId) {
            player.loadPlaylist({
                list: APP_CONFIG.playlistId,
                listType: 'playlist',
                index: 0,
                suggestedQuality: 'hd1080'
            });
        }
    })
    .catch(err => console.error('Failed to load config', err));

// TV Static Canvas Logic
const canvas = document.getElementById('tv-static');
const ctx = canvas.getContext('2d', { alpha: false });
let animationId;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawStatic() {
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    // Generate noise
    for (let i = 0; i < data.length; i += 4) {
        const color = Math.floor(Math.random() * 255);
        data[i] = color;     // r
        data[i + 1] = color; // g
        data[i + 2] = color; // b
        data[i + 3] = 255;   // a
    }
    ctx.putImageData(imgData, 0, 0);
    animationId = requestAnimationFrame(drawStatic);
}

function showStatic(durationMs = 1200) {
    canvas.classList.add('active');
    if (!animationId) {
        drawStatic();
    }
    
    clearTimeout(staticTimeout);
    staticTimeout = setTimeout(() => {
        canvas.classList.remove('active');
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }, durationMs);
}

// HUD Logic
function wakeUpHUD() {
    const banner = document.getElementById('info-banner');
    banner.classList.remove('hidden');
    clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
        banner.classList.add('hidden');
    }, 5000); // Hide after 5 seconds of inactivity
}

document.addEventListener('mousemove', wakeUpHUD);
document.addEventListener('click', wakeUpHUD);

// YouTube API Initialization
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 1,
            'controls': 0, // Hide UI
            'disablekb': 1,
            'fs': 0,
            'modestbranding': 1,
            'rel': 0,
            'showinfo': 0,
            'iv_load_policy': 3,
            'mute': 0
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

function onPlayerReady(event) {
    isPlayerReady = true;
    player.setVolume(50);
    
    // Attempt to play on load (browsers might block autoplay with sound, but we'll try)
    if(APP_CONFIG && APP_CONFIG.playlistId) {
        player.loadPlaylist({
            list: APP_CONFIG.playlistId,
            listType: 'playlist',
            index: 0,
            suggestedQuality: 'hd1080'
        });
    }
}

function onPlayerStateChange(event) {
    // When playlist metadata is loaded
    if (event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PLAYING) {
        if(isFirstLoad && currentPlaylist.length === 0) {
            currentPlaylist = player.getPlaylist();
            if(currentPlaylist && currentPlaylist.length > 0) {
                isFirstLoad = false;
                playRandomVideo();
            }
        }
    }
    
    if (event.data === YT.PlayerState.PLAYING) {
        // If we just switched channels, jump to a random point in the video
        if (isSeekingToRandom) {
            isSeekingToRandom = false;
            const duration = player.getDuration();
            if (duration > 60) {
                // Seek to somewhere in the middle 80% to avoid immediate endings
                const randomTime = Math.floor(Math.random() * (duration * 0.8));
                player.seekTo(randomTime, true);
            }
        }
        
        // Update HUD
        const videoData = player.getVideoData();
        if(videoData && videoData.title) {
            document.getElementById('video-title').innerText = videoData.title;
        }
        wakeUpHUD();
    }
    
    // Auto change channel on video end
    if (event.data === YT.PlayerState.ENDED) {
        playRandomVideo();
    }
}

function onPlayerError(event) {
    console.warn("YouTube Player Error", event.data);
    setTimeout(playRandomVideo, 2000);
}

function playRandomVideo() {
    if(!isPlayerReady || !currentPlaylist || currentPlaylist.length === 0) return;
    
    const randomIdx = Math.floor(Math.random() * currentPlaylist.length);
    document.getElementById('channel-display').innerText = 'CH ' + (randomIdx + 1).toString().padStart(2, '0');
    
    showStatic(1000);
    isSeekingToRandom = true;
    player.playVideoAt(randomIdx);
    wakeUpHUD();
}

// Attach Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    
    document.getElementById('btn-ch-next').addEventListener('click', () => {
        playRandomVideo();
    });
    
    document.getElementById('btn-ch-prev').addEventListener('click', () => {
        playRandomVideo();
    });
    
    // Volume Controls
    document.getElementById('btn-vol-up').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted()) player.unMute();
            let vol = player.getVolume();
            player.setVolume(Math.min(vol + 10, 100));
            updateMuteIcon();
            wakeUpHUD();
        }
    });
    
    document.getElementById('btn-vol-down').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted()) player.unMute();
            let vol = player.getVolume();
            player.setVolume(Math.max(vol - 10, 0));
            updateMuteIcon();
            wakeUpHUD();
        }
    });
    
    // Mute Toggle
    document.getElementById('btn-mute').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted() || player.getVolume() === 0) {
                player.unMute();
                if(player.getVolume() === 0) player.setVolume(50);
            } else {
                player.mute();
            }
            updateMuteIcon();
            wakeUpHUD();
        }
    });

    function updateMuteIcon() {
        const btn = document.getElementById('btn-mute');
        if (player.isMuted() || player.getVolume() === 0) {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'; // Mute icon (x)
        } else {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'; // Vol icon (waves)
        }
    }

    // Initial show of HUD
    wakeUpHUD();
    updateMuteIcon(); // wait, player not ready yet. Let's do it simple.
});
