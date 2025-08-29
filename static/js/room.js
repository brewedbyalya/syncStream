let roomSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let videoLatency = 0;
let isSyncing = false;

let player;
let isPlaying = false;
let currentTime = 0;
let videoUrl = null;
let videoType = null;
let videoElement = null;

let chatMessages, chatInput, chatSend, videoUrlInput, loadVideoBtn;
let playBtn, pauseBtn, syncBtn, startScreenShare, stopScreenShare;
let screenShareContainer, onlineCount, chatIndicator;

let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    initializeYouTubePlayer();
}

function initializeYouTubePlayer() {
    if (typeof YT !== 'undefined' && YT.Player) {
        player = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            playerVars: {
                'playsinline': 1,
                'controls': 1,
                'modestbranding': 1,
                'rel': 0,
                'enablejsapi': 1
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    } else {
        setTimeout(initializeYouTubePlayer, 100);
    }
}

function onPlayerReady(event) {
    console.log('YouTube player ready');
    document.getElementById('video-controls').classList.remove('d-none');
}

function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        isPlaying = true;
        sendVideoControl('play', player.getCurrentTime());
    } else if (event.data == YT.PlayerState.PAUSED) {
        isPlaying = false;
        sendVideoControl('pause', player.getCurrentTime());
    } else if (event.data == YT.PlayerState.ENDED) {
        isPlaying = false;
    }
    
    if (event.data == YT.PlayerState.PLAYING) {
        clearInterval(timeUpdateInterval);
        timeUpdateInterval = setInterval(() => {
            if (player && player.getCurrentTime) {
                currentTime = player.getCurrentTime();
            }
        }, 1000);
    }
}

function onPlayerError(event) {
    console.error('YouTube player error:', event.data);
    showNotification('Error loading YouTube video', 'error');
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}/`;
    
    roomSocket = new WebSocket(wsUrl);

    roomSocket.onopen = function(e) {
        console.log('WebSocket connection established');
        reconnectAttempts = 0;
        updateChatIndicator('connected', 'Connected');
        showNotification('Connected to room', 'success');
    };

    roomSocket.onmessage = function(e) {
        try {
            const data = JSON.parse(e.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    roomSocket.onclose = function(e) {
        console.log('WebSocket connection closed', e.code, e.reason);
        handleDisconnection(e);
    };

    roomSocket.onerror = function(e) {
        console.error('WebSocket error:', e);
        updateChatIndicator('error', 'Connection Error');
        showNotification('Connection error', 'danger');
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'chat_message':
            appendMessage(data.username, data.message, data.timestamp);
            break;
            
        case 'video_control':
            handleVideoControl(data);
            break;
            
        case 'screen_share_started':
            handleScreenShareStarted(data);
            break;
            
        case 'screen_share_ended':
            handleScreenShareEnded(data);
            break;
            
        case 'user_joined':
            userJoined(data.username);
            break;
            
        case 'user_left':
            userLeft(data.username);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleDisconnection(e) {
    if (e.code === 4001) {
        showNotification('Room not found or inactive', 'error');
        updateChatIndicator('disconnected', 'Room Not Available');
    } else if (e.code === 4002) {
        showNotification('Error connecting to room', 'error');
        updateChatIndicator('error', 'Connection Error');
    } else if (reconnectAttempts < maxReconnectAttempts) {
        updateChatIndicator('connecting', 'Reconnecting...');
        setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
        }, 2000 * reconnectAttempts);
    } else {
        updateChatIndicator('disconnected', 'Disconnected');
        showNotification('Failed to reconnect. Please refresh the page.', 'error');
    }
}

function updateChatIndicator(status, text) {
    const indicator = document.getElementById('chat-indicator');
    if (!indicator) return;
    
    indicator.className = 'badge bg-' + (
        status === 'connected' ? 'success' :
        status === 'connecting' ? 'warning' :
        status === 'error' ? 'danger' : 'secondary'
    );
    indicator.textContent = text;
}

function appendMessage(username, message, timestamp) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('mb-2', 'message');
    
    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    messageElement.innerHTML = `
        <strong class="text-primary">${username}:</strong> ${message}
        <small class="text-muted ms-2">${time}</small>
    `;
    
    if (chatMessages) {
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    
    if (message && roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'chat_message',
            'message': message
        }));
        chatInput.value = '';
    } else if (!message) {
    } else {
        showNotification('Not connected to chat', 'warning');
    }
}

function loadVideo() {
    const url = videoUrlInput.value.trim();
    if (url) {
        const videoInfo = extractVideoId(url);
        if (videoInfo) {
            sendVideoControl('load', 0, url);
            loadVideoToPlayer(url);
        } else {
            showNotification('Unsupported video URL format', 'error');
        }
    }
}

function loadVideoToPlayer(url) {
    videoUrl = url;
    const videoInfo = extractVideoId(url);
    
    if (!videoInfo) {
        showNotification('Unsupported video format', 'error');
        return;
    }
    
    const videoContainer = document.getElementById('video-container');
    videoContainer.innerHTML = '';
    
    videoType = videoInfo.type;
    
    switch(videoType) {
        case 'youtube':
            loadYouTubeVideo(videoInfo.id);
            break;
        case 'vimeo':
            loadVimeoVideo(videoInfo.id);
            break;
        case 'direct':
            loadGenericVideo(videoInfo.id);
            break;
        default:
            showNotification('Unsupported video format', 'error');
            return;
    }
    
    document.getElementById('player-placeholder').classList.add('d-none');
    document.getElementById('video-controls').classList.remove('d-none');
}

function loadYouTubeVideo(videoId) {
    const youtubeDiv = document.createElement('div');
    youtubeDiv.id = 'youtube-player';
    document.getElementById('video-container').appendChild(youtubeDiv);
    
    if (typeof YT !== 'undefined' && YT.Player) {
        if (player) {
            player.loadVideoById(videoId);
        } else {
            initializeYouTubePlayer();
        }
    }
}

function loadVimeoVideo(videoId) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.vimeo.com/video/${videoId}?autoplay=0&title=0&byline=0&portrait=0`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.allow = 'autoplay; fullscreen';
    
    document.getElementById('video-container').appendChild(iframe);
}

function loadGenericVideo(url) {
    videoElement = document.createElement('video');
    videoElement.id = 'html5-video';
    videoElement.controls = true;
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.crossOrigin = 'anonymous';
    
    const source = document.createElement('source');
    source.src = url;
    videoElement.appendChild(source);
    
    document.getElementById('video-container').appendChild(videoElement);
    
    videoElement.addEventListener('play', () => {
        isPlaying = true;
        sendVideoControl('play', videoElement.currentTime);
    });
    
    videoElement.addEventListener('pause', () => {
        isPlaying = false;
        sendVideoControl('pause', videoElement.currentTime);
    });
    
    videoElement.addEventListener('seeked', () => {
        sendVideoControl('sync', videoElement.currentTime);
    });
    
    videoElement.addEventListener('timeupdate', () => {
        currentTime = videoElement.currentTime;
    });
    
    videoElement.addEventListener('error', (e) => {
        console.error('Video error:', e);
        showNotification('Error loading video', 'error');
    });
    
    videoElement.addEventListener('canplay', () => {
        console.log('Video can play');
    });
}

function playVideo() {
    switch(videoType) {
        case 'youtube':
            if (player && player.playVideo) player.playVideo();
            break;
        case 'vimeo':
            showNotification('Vimeo play control not implemented yet', 'info');
            break;
        case 'direct':
            if (videoElement) videoElement.play();
            break;
    }
    sendVideoControl('play', currentTime);
}

function pauseVideo() {
    switch(videoType) {
        case 'youtube':
            if (player && player.pauseVideo) player.pauseVideo();
            break;
        case 'vimeo':
            showNotification('Vimeo pause control not implemented yet', 'info');
            break;
        case 'direct':
            if (videoElement) videoElement.pause();
            break;
    }
    sendVideoControl('pause', currentTime);
}

function syncVideo() {
    sendVideoControl('sync', currentTime);
    showNotification('Video synced with other users', 'info');
}

function sendVideoControl(action, timestamp, url = '') {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'video_control',
            'action': action,
            'timestamp': timestamp,
            'url': url
        }));
    } else {
        showNotification('Not connected to room', 'warning');
    }
}

function handleVideoControl(data) {
    if (data.user_id != userId) {
        const currentTime = Date.now() / 1000;
        const serverTime = data.server_timestamp || 0;
        const messageLatency = data.latency || 0;
        const totalLatency = messageLatency + videoLatency;
        const adjustedTimestamp = data.timestamp + totalLatency;

        switch(data.action) {
            case 'play':
                executeVideoAction('play', adjustedTimestamp, data.username);
                break;
                
            case 'pause':
                executeVideoAction('pause', adjustedTimestamp, data.username);
                break;
                
            case 'load':
                videoUrlInput.value = data.url;
                loadVideoToPlayer(data.url);
                showNotification(`${data.username} loaded a new video`, 'info');
                break;
                
            case 'sync':
                executeVideoAction('sync', adjustedTimestamp, data.username);
                break;
        }
    }
}


function executeVideoAction(action, timestamp, username) {
    if (isSyncing) return;
    
    isSyncing = true;
    
    switch(action) {
        case 'play':
            if (videoType === 'youtube' && player) {
                player.seekTo(timestamp, true);
                player.playVideo();
            } else if (videoType === 'direct' && videoElement) {
                videoElement.currentTime = timestamp;
                videoElement.play();
            }
            isPlaying = true;
            showNotification(`${username} played the video`, 'info');
            break;
            
        case 'pause':
            if (videoType === 'youtube' && player) {
                player.seekTo(timestamp, true);
                player.pauseVideo();
            } else if (videoType === 'direct' && videoElement) {
                videoElement.currentTime = timestamp;
                videoElement.pause();
            }
            isPlaying = false;
            showNotification(`${username} paused the video`, 'info');
            break;
            
        case 'sync':
            if (videoType === 'youtube' && player) {
                player.seekTo(timestamp, true);
            } else if (videoType === 'direct' && videoElement) {
                videoElement.currentTime = timestamp;
            }
            showNotification('Video synced by another user', 'info');
            break;
    }
    
    setTimeout(() => { isSyncing = false; }, 100);
}

function calculateLatency() {
    const startTime = Date.now();
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'ping',
            'client_time': startTime
        }));
    }
}

function handlePingPong(data) {
    if (data.type === 'pong') {
        const roundTripTime = Date.now() - data.client_time;
        videoLatency = roundTripTime / 2000;
    }
}

async function startScreenSharing() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'screen_share',
            'action': 'start'
        }));
        
        startScreenShare.classList.add('d-none');
        stopScreenShare.classList.remove('d-none');
        screenShareContainer.classList.remove('d-none');
        
        screenShareContainer.innerHTML = '<p class="text-white">Screen sharing active</p>';
        showNotification('Screen sharing started', 'success');
    } else {
        showNotification('Not connected to room', 'warning');
    }
}

function stopScreenSharing() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'screen_share',
            'action': 'stop'
        }));
        
        stopScreenShare.classList.add('d-none');
        startScreenShare.classList.remove('d-none');
        screenShareContainer.classList.add('d-none');
        showNotification('Screen sharing stopped', 'info');
    }
}

function handleScreenShareStarted(data) {
    if (data.user_id != userId) {
        screenShareContainer.classList.remove('d-none');
        screenShareContainer.innerHTML = `
            <div class="d-flex justify-content-center align-items-center text-white h-100">
                <div class="text-center">
                    <i class="fas fa-desktop fa-3x mb-2"></i>
                    <p>${data.username} is sharing their screen</p>
                </div>
            </div>
        `;
        showNotification(`${data.username} started screen sharing`, 'info');
    }
}

function handleScreenShareEnded(data) {
    if (data.user_id != userId) {
        screenShareContainer.classList.add('d-none');
        showNotification(`${data.username} stopped screen sharing`, 'info');
    }
}

function userJoined(username) {
    if (onlineCount) {
        const count = parseInt(onlineCount.textContent) + 1;
        onlineCount.textContent = count + ' online';
    }
    
    appendMessage('System', `${username} joined the room`);
    showNotification(`${username} joined the room`, 'success');
}

function userLeft(username) {
    if (onlineCount) {
        const count = parseInt(onlineCount.textContent) - 1;
        onlineCount.textContent = count + ' online';
    }
    
    appendMessage('System', `${username} left the room`);
    showNotification(`${username} left the room`, 'warning');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 80px; right: 20px; z-index: 1050; min-width: 300px;';
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
            <div>${message}</div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

function extractVideoId(url) {
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const youtubeMatch = url.match(youtubeRegex);
    if (youtubeMatch) return { type: 'youtube', id: youtubeMatch[1] };
    
    const vimeoRegex = /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([0-9]+)/;
    const vimeoMatch = url.match(vimeoRegex);
    if (vimeoMatch) return { type: 'vimeo', id: vimeoMatch[1] };
    
    if (url.match(/\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)(?:\?.*)?$/i)) {
        return { type: 'direct', id: url };
    }
    
    return null;
}

function toggleFullscreen() {
    const videoContainer = document.getElementById('video-container');
    
    if (!document.fullscreenElement) {
        if (videoContainer.requestFullscreen) {
            videoContainer.requestFullscreen().catch(err => {
                console.error('Error attempting to enable fullscreen:', err);
            });
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('msfullscreenchange', handleFullscreenChange);

function handleFullscreenChange() {
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        if (document.fullscreenElement) {
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
            fullscreenBtn.title = 'Exit Fullscreen';
        } else {
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
            fullscreenBtn.title = 'Fullscreen';
        }
    }
}

let timeUpdateInterval;

document.addEventListener('DOMContentLoaded', function() {
    chatMessages = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    chatSend = document.getElementById('chat-send');
    videoUrlInput = document.getElementById('video-url-input');
    loadVideoBtn = document.getElementById('load-video');
    playBtn = document.getElementById('play-btn');
    pauseBtn = document.getElementById('pause-btn');
    syncBtn = document.getElementById('sync-btn');
    startScreenShare = document.getElementById('start-screen-share');
    stopScreenShare = document.getElementById('stop-screen-share');
    screenShareContainer = document.getElementById('screen-share-container');
    onlineCount = document.getElementById('online-count');
    chatIndicator = document.getElementById('chat-indicator');

    if (chatSend) chatSend.addEventListener('click', sendChatMessage);
    if (chatInput) chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    if (loadVideoBtn) loadVideoBtn.addEventListener('click', loadVideo);
    if (videoUrlInput) videoUrlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            loadVideo();
        }
    });
    
    if (playBtn) playBtn.addEventListener('click', playVideo);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseVideo);
    if (syncBtn) syncBtn.addEventListener('click', syncVideo);

    if (startScreenShare) startScreenShare.addEventListener('click', startScreenSharing);
    if (stopScreenShare) stopScreenShare.addEventListener('click', stopScreenSharing);

    connectWebSocket();

    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    console.log('SyncStream room initialized');
});

window.addEventListener('beforeunload', function() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.close(1000, 'Page navigation');
    }
    
    if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
    }
});