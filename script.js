let APP_CONFIG = { categories: [] };
let player;
let isPlayerReady = false;
let currentPlaylistVideos = [];
let staticTimeout;
let hudTimeout;
let isPoweredOn = false; // Start off
let isSeekingToRandom = false;
let lastVideoId = null;

// -1 means "ALL", 0..N means specific category
let activeCategoryIdx = -1; 
let currentLoadedPlaylistId = null;
let categorySwitchPending = false;
let intendedCategoryId = null; // Tracker for what we WANT to play

let VIDEO_CATEGORY_MAP = {}; // Master lookup: { videoId: categoryName }
let PLAYLIST_CACHE = {};

async function getPlaylistItems(playlistId, catName) {
    if (PLAYLIST_CACHE[playlistId]) return PLAYLIST_CACHE[playlistId];
    try {
        const response = await fetch(`https://yt.lemnoslife.com/noKey/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50`);
        const data = await response.json();
        if (data.items) {
            const items = data.items.map(i => {
                const vid = i.snippet.resourceId.videoId;
                if(vid && catName) VIDEO_CATEGORY_MAP[vid] = catName;
                return vid;
            }).filter(Boolean);
            PLAYLIST_CACHE[playlistId] = items;
            return items;
        }
    } catch(err) {
        console.warn("Failed to fetch playlist items", err);
    }
    return [];
}

// Apply zoom from settings
fetch('settings.json')
    .then(r => r.json())
    .then(data => {
        if (data.zoom) {
            document.getElementById('player').style.transform = `scale(${data.zoom})`;
        }
    })
    .catch(err => console.error('Failed to load settings', err));

// Fetch Config
fetch('config.json')
    .then(r => r.json())
    .then(data => {
        if (data.categories) {
            APP_CONFIG.categories = data.categories;
            // Background fetch to populate master category map for internal seek logic
            data.categories.forEach((cat) => {
                getPlaylistItems(cat.id, cat.name);
            });
            
            if (isPlayerReady && isPoweredOn) {
                startTV();
            }
        }
    })
    .catch(err => console.error('Failed to load config', err));

// Fetch Ticker
fetch('ticker.json')
    .then(r => r.json())
    .then(data => {
        const tickerContent = document.getElementById('ticker-content');
        if (data.messages && Array.isArray(data.messages)) {
            const fullText = data.messages.join(' &nbsp;&nbsp;&nbsp; ✦ &nbsp;&nbsp;&nbsp; ');
            tickerContent.innerHTML = fullText + ' &nbsp;&nbsp;&nbsp; ✦ &nbsp;&nbsp;&nbsp; ' + fullText + ' &nbsp;&nbsp;&nbsp; ✦ &nbsp;&nbsp;&nbsp; ' + fullText;
        }
        if (data.speed) {
            tickerContent.style.animationDuration = data.speed + 's';
        }
    })
    .catch(err => console.error('Failed to load ticker', err));

async function fetchVideoMetadata(videoId) {
    try {
        const response = await fetch(`https://yt.lemnoslife.com/noKey/videos?part=snippet&id=${videoId}`);
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const snippet = data.items[0].snippet;
            return {
                year: snippet.publishedAt ? snippet.publishedAt.substring(0, 4) : "",
                description: snippet.description || ""
            };
        }
    } catch(err) {
        console.warn("Failed to fetch exact year", err);
    }
    return { year: "", description: "" };
}

function startTV() {
    if (APP_CONFIG.categories.length > 0 && isPlayerReady) {
        document.getElementById('power-screen').classList.add('hidden');
        isPoweredOn = true;
        if (!currentLoadedPlaylistId) {
            playRandomVideo();
        } else {
            player.playVideo();
            showStatic(1000);
            wakeUpHUD();
        }
    }
}

// TV Static Canvas Logic
const canvas = document.getElementById('tv-static');
const ctx = canvas.getContext('2d', { alpha: false });
let animationId;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);

// Mobile Swipe Navigation
let touchStartY = 0;
document.addEventListener('touchstart', e => {
    touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

document.addEventListener('touchend', e => {
    const touchEndY = e.changedTouches[0].screenY;
    const diff = touchStartY - touchEndY;
    
    // Threshold of 50px for a swipe
    if (Math.abs(diff) > 50) {
        playRandomVideo();
    }
}, {passive: true});

resizeCanvas();

function drawStatic() {
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        const color = Math.floor(Math.random() * 255);
        data[i] = color;
        data[i + 1] = color;
        data[i + 2] = color;
        data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    animationId = requestAnimationFrame(drawStatic);
}

function showStatic(durationMs = 1200) {
    canvas.classList.add('active');
    if (!animationId) drawStatic();
    
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
    if (!isPoweredOn) return;
    const banner = document.getElementById('info-banner');
    banner.classList.remove('hidden');
    clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
        banner.classList.add('hidden');
    }, 5000);
}

document.addEventListener('mousemove', wakeUpHUD);
document.addEventListener('click', wakeUpHUD);
document.addEventListener('keydown', (e) => {
    wakeUpHUD();
    if (!isPlayerReady || !isPoweredOn) return;
    
    switch(e.key) {
        case 'ArrowRight':
        case 'ArrowLeft':
            playRandomVideo();
            break;
        case 'ArrowUp':
            if(player.isMuted()) player.unMute();
            player.setVolume(Math.min(player.getVolume() + 10, 100));
            break;
        case 'ArrowDown':
            if(player.isMuted()) player.unMute();
            player.setVolume(Math.max(player.getVolume() - 10, 0));
            break;
        case 'f':
        case 'F':
            const elem = document.documentElement;
            if (!document.fullscreenElement) {
                if (elem.requestFullscreen) elem.requestFullscreen();
                else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
                else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
            }
            break;
        case 'l':
        case 'L':
            const lookBtn = document.getElementById('btn-look-toggle');
            if (lookBtn) lookBtn.click();
            break;
    }
});

// YouTube API Initialization
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 1,
            'controls': 0,
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
    player.setVolume(100); 
    player.unMute();
    
    // Auto-select initial intended ID if needed
    if (APP_CONFIG.categories.length > 0) {
        intendedCategoryId = APP_CONFIG.categories[0].id;
    }

    if (APP_CONFIG.categories.length > 0 && isPoweredOn) {
        startTV();
    }
}

function onPlayerStateChange(event) {    
    const videoData = player.getVideoData();
    const currentVideoId = videoData ? videoData.video_id : null;

    // INTERCEPT NEW VIDEO START (including buffering phase)
    if (currentVideoId && currentVideoId !== lastVideoId && (event.data === YT.PlayerState.BUFFERING || event.data === YT.PlayerState.PLAYING)) {
        lastVideoId = currentVideoId;
        
        // 1. Lock screen with high-priority static
        showStatic(3000); 
        
        // 2. Silence immediately to prevent 'start audio' leak
        try { player.mute(); } catch(e) {}

        // 3. Perform the calculation and jump hidden behind static
        const checkDuration = setInterval(() => {
            const duration = player.getDuration();
            if (duration > 0) {
                clearInterval(checkDuration);
                
                let minPct = 0.20; 
                const matchedCatName = VIDEO_CATEGORY_MAP[currentVideoId];
                if (matchedCatName) {
                    const cn = matchedCatName.toLowerCase();
                    if (cn.includes('dj') || cn.includes('podcast') || cn.includes('interview')) {
                        minPct = 0.05;
                    }
                }
                const randomTime = Math.floor(duration * minPct + Math.random() * (duration * 0.7)); 
                
                player.seekTo(randomTime, true);
                
                // 4. Reveal only after the jump is likely finished
                setTimeout(() => {
                    try {
                        player.unMute();
                        player.setVolume(100);
                        showStatic(10); // Clear static immediately
                    } catch(e) {}
                }, 600);
            }
        }, 50);
    }

    if (event.data === YT.PlayerState.PLAYING) {
        // Standard metadata updates...
        if(videoData) {
            if (videoData.title) document.getElementById('video-title').innerText = videoData.title;
            if (videoData.video_id) {
                document.getElementById('video-desc').innerText = "Receiving broadcast metadata...";
                fetchVideoMetadata(videoData.video_id).then(meta => {
                    if (meta.description) {
                        document.getElementById('video-desc').innerText = meta.description.substring(0, 180) + "...";
                    } else {
                        document.getElementById('video-desc').innerText = "No broadcast description transmitted.";
                    }
                });
            }
        }

        // INTERNAL CATEGORY RESOLUTION (For internal state tracking)
        if (currentVideoId && VIDEO_CATEGORY_MAP[currentVideoId]) {
            currentLoadedPlaylistId = (APP_CONFIG.categories.find(c => c.name === VIDEO_CATEGORY_MAP[currentVideoId]) || {}).id;
        } 
        else if (categorySwitchPending) {
            const url = player.getVideoUrl();
            if (url && url.includes(intendedCategoryId)) {
                categorySwitchPending = false;
                currentLoadedPlaylistId = intendedCategoryId;
            }
        } 

        wakeUpHUD();
    }
    
    if (event.data === YT.PlayerState.ENDED) {
        // playlist natural flow...
    }
}

function onPlayerError(event) {
    console.warn("YouTube Player Error", event.data);
    setTimeout(() => playRandomVideo(), 2000);
}

function playRandomVideo() {
    if(!isPlayerReady || APP_CONFIG.categories.length === 0) return;
    
    showStatic(1200);
    
    let targetCategory;
    if (activeCategoryIdx === -1) {
        const rIndex = Math.floor(Math.random() * APP_CONFIG.categories.length);
        targetCategory = APP_CONFIG.categories[rIndex];
    } else {
        targetCategory = APP_CONFIG.categories[activeCategoryIdx];
    }
    
    intendedCategoryId = targetCategory.id;
    categorySwitchPending = true;
    
    // UI Feedback
    document.getElementById('video-title').innerText = "Loading signal...";
    document.getElementById('video-desc').innerText = "Retuning frequencies...";
    wakeUpHUD();
    
    // isSeekingToRandom logic handled globally by lastVideoId tracker now
    player.loadPlaylist({
        list: targetCategory.id,
        listType: 'playlist',
        index: Math.floor(Math.random() * 20), // Start at a random video in the list
        suggestedQuality: 'hd1080'
    });
}

// Attach Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    
    document.getElementById('btn-power').addEventListener('click', () => {
        isPoweredOn = true;
        // Unmute upon explicit interaction so they hear it
        if(isPlayerReady) player.unMute();
        
        if(isPlayerReady && APP_CONFIG.categories.length > 0) {
            startTV();
        } else {
            document.querySelector('#btn-power div').innerText = "CONNECTING...";
        }
    });
    
    // Remote Toggle Button
    document.getElementById('btn-remote-toggle').addEventListener('click', () => {
        const remoteBox = document.getElementById('remote-box');
        remoteBox.classList.toggle('hidden');
    });

    const handlePowerOff = () => {
        isPoweredOn = false;
        if(isPlayerReady) player.pauseVideo();
        document.getElementById('power-screen').classList.remove('hidden');
        document.getElementById('remote-box').classList.add('hidden');
        document.querySelector('#btn-power div').innerText = "POWER ON";
    };

    document.getElementById('btn-power-off').addEventListener('click', handlePowerOff);
    
    const floatingOff = document.getElementById('btn-power-off-floating');
    if (floatingOff) {
        floatingOff.addEventListener('click', handlePowerOff);
    }
    
    // Look Toggle
    const looks = ['look-retro', 'look-clean', 'look-y2k', 'look-bw'];
    const lookNames = ['LOOK: RETRO', 'LOOK: CLEAN', 'LOOK: Y2K', 'LOOK: NOSTALGIA'];
    let currentLookIdx = 2; // Default to Y2K
    document.body.classList.add(looks[currentLookIdx]);
    
    const btnLook = document.getElementById('btn-look-toggle');
    if (btnLook) {
        btnLook.innerText = lookNames[currentLookIdx];
        btnLook.addEventListener('click', () => {
            document.body.classList.remove(looks[currentLookIdx]);
            currentLookIdx = (currentLookIdx + 1) % looks.length;
            document.body.classList.add(looks[currentLookIdx]);
            btnLook.innerText = lookNames[currentLookIdx];
        });
    }


    
    // Fullscreen Toggle
    document.getElementById('btn-fullscreen-toggle').addEventListener('click', () => {
        const elem = document.documentElement;
        if (!document.fullscreenElement) {
            if (elem.requestFullscreen) elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
            else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            else if (document.msExitFullscreen) document.msExitFullscreen();
        }
    });
    
    document.getElementById('btn-open-video').addEventListener('click', () => {
        if(isPlayerReady) {
            const videoData = player.getVideoData();
            if(videoData && videoData.video_id) {
                window.open('https://youtube.com/watch?v=' + videoData.video_id, '_blank');
            }
        }
    });

    document.getElementById('btn-ch-next').addEventListener('click', () => {
        playRandomVideo();
    });
    
    document.getElementById('btn-ch-prev').addEventListener('click', () => {
        playRandomVideo();
    });

    document.getElementById('btn-ch-prev-mobile').addEventListener('click', () => {
        playRandomVideo();
    });
    
    document.getElementById('btn-ch-next-mobile').addEventListener('click', () => {
        playRandomVideo();
    });
    
    // Volume Controls
    document.getElementById('btn-vol-up').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted()) player.unMute();
            let vol = player.getVolume();
            player.setVolume(Math.min(vol + 10, 100));
        }
    });
    
    document.getElementById('btn-vol-down').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted()) player.unMute();
            let vol = player.getVolume();
            player.setVolume(Math.max(vol - 10, 0));
        }
    });
    
    document.getElementById('btn-mute').addEventListener('click', () => {
        if(isPlayerReady) {
            if(player.isMuted() || player.getVolume() === 0) {
                player.unMute();
                if(player.getVolume() === 0) player.setVolume(100);
                document.getElementById('btn-mute').innerText = 'MUTE';
            } else {
                player.mute();
                document.getElementById('btn-mute').innerText = 'UNMUTE';
            }
        }
    });
});
