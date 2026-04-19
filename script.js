let APP_CONFIG = { categories: [] };
let player;
let isPlayerReady = false;
let currentPlaylistVideos = [];
let staticTimeout;
let hudTimeout;
let isPoweredOn = true; // Auto-on
let isSeekingToRandom = false;

// -1 means "ALL", 0..N means specific category
let activeCategoryIdx = -1; 
let currentLoadedPlaylistId = null;
let categorySwitchPending = false;

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
            const dropdown = document.getElementById('category-dropdown');
            if (dropdown) {
                data.categories.forEach((cat, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.innerText = cat.name.toUpperCase();
                    dropdown.appendChild(opt);
                });
            }
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
            'mute': 1 // Start muted to bypass autoplay restrictions without interaction
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
    player.setVolume(100); // Force 100% volume on load overriding user cookies
    player.mute(); // Muting enables autoplay without user gesture
    if (APP_CONFIG.categories.length > 0 && isPoweredOn) {
        startTV();
    }
}

async function onPlayerStateChange(event) {
    
    if (event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PLAYING) {
        if (categorySwitchPending) {
            categorySwitchPending = false;
            currentPlaylistVideos = player.getPlaylist();
            
            if (currentPlaylistVideos && currentPlaylistVideos.length > 0) {
                const randomIdx = Math.floor(Math.random() * currentPlaylistVideos.length);
                isSeekingToRandom = true;
                player.playVideoAt(randomIdx);
                
                document.getElementById('channel-display').innerText = 'CH ' + (randomIdx + 1).toString().padStart(2, '0');
            }
        }
    }
    
    if (event.data === YT.PlayerState.PLAYING) {
        if (isSeekingToRandom) {
            isSeekingToRandom = false;
            setTimeout(() => {
                const duration = player.getDuration();
                if (duration > 30) {
                    let minPct = 0.20; // 20% default for short music videos
                    const matchedCat = APP_CONFIG.categories.find(c => c.id === currentLoadedPlaylistId);
                    if (matchedCat && matchedCat.name.toLowerCase().includes('dj set')) {
                        minPct = 0.05; // 5% minimum for live DJ sets
                    }
                    // Max position up to 90%
                    const maxPct = 0.90;
                    const randomTime = Math.floor(duration * minPct + Math.random() * (duration * (maxPct - minPct)));
                    player.seekTo(randomTime, true);
                }
            }, 500);
        }
        
        const videoData = player.getVideoData();
        if(videoData) {
            if (videoData.title) document.getElementById('video-title').innerText = videoData.title;
            
            // Try fetch actual year & description
            if (videoData.video_id) {
                const meta = await fetchVideoMetadata(videoData.video_id);
                document.getElementById('year-display').innerText = meta.year ? meta.year : "";
                if (meta.description) {
                    document.getElementById('video-desc').innerText = meta.description.substring(0, 180) + "...";
                } else {
                    document.getElementById('video-desc').innerText = "No broadcast description transmitted.";
                }
            }
        }
        
        // Find current category name to display
        let catName = "Video";
        let targetId = currentLoadedPlaylistId;
        const matchedCat = APP_CONFIG.categories.find(c => c.id === targetId);
        if(matchedCat) catName = matchedCat.name;
        
        document.getElementById('category-display').innerText = catName.toUpperCase();
        wakeUpHUD();
    }
    
    if (event.data === YT.PlayerState.ENDED) {
        playRandomVideo();
    }
}

function onPlayerError(event) {
    console.warn("YouTube Player Error", event.data);
    setTimeout(playRandomVideo, 2000);
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
    
    if (currentLoadedPlaylistId !== targetCategory.id || !currentPlaylistVideos || currentPlaylistVideos.length === 0) {
        currentLoadedPlaylistId = targetCategory.id;
        categorySwitchPending = true;
        player.loadPlaylist({
            list: targetCategory.id,
            listType: 'playlist',
            index: 0,
            suggestedQuality: 'hd1080'
        });
    } else {
        const randomIdx = Math.floor(Math.random() * currentPlaylistVideos.length);
        document.getElementById('channel-display').innerText = 'CH ' + (randomIdx + 1).toString().padStart(2, '0');
        isSeekingToRandom = true;
        player.playVideoAt(randomIdx);
    }
    wakeUpHUD();
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
    const looks = ['look-retro', 'look-clean', 'look-y2k'];
    const lookNames = ['LOOK: RETRO', 'LOOK: CLEAN', 'LOOK: Y2K'];
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

    // Category Dropdown
    document.getElementById('category-dropdown').addEventListener('change', (e) => {
        activeCategoryIdx = parseInt(e.target.value, 10);
        playRandomVideo(); 
    });
    
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
