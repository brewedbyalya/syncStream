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

let youTubeAPILoaded = false;
let youTubeAPILoadCallbacks = [];

let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    youTubeAPILoaded = true;
    youTubeAPILoadCallbacks.forEach(callback => callback());
    youTubeAPILoadCallbacks = [];
    console.log('YouTube IFrame API ready');
}

function initializeYouTubePlayer() {
    if (youTubeAPILoaded && typeof YT !== 'undefined' && YT.Player) {
        createYouTubePlayer();
    } else {
        youTubeAPILoadCallbacks.push(createYouTubePlayer);
        
        setTimeout(() => {
            if (!youTubeAPILoaded) {
                showNotification('YouTube player failed to load. Please refresh the page.', 'error');
            }
        }, 5000);
    }
}

function createYouTubePlayer() {
    const youtubePlayerElement = document.getElementById('youtube-player');
    if (youtubePlayerElement) {
        try {
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
        } catch (error) {
            console.error('Error creating YouTube player:', error);
            showNotification('Error creating YouTube player', 'error');
        }
    }
}

function onPlayerReady(event) {
    console.log('YouTube player ready');
    const videoControls = document.getElementById('video-controls');
    if (videoControls) {
        videoControls.classList.remove('d-none');
    }
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
            
        case 'webrtc_signal':
            handleWebRTCSignal(data);
            break;
            
        case 'pong':
            handlePingPong(data);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleWebRTCSignal(data) {
    if (typeof webRTCManager !== 'undefined' && webRTCManager && data.user_id !== userId) {
        webRTCManager.handleSignal(data);
    }
}

function handlePingPong(data) {
    if (data.type === 'pong') {
        const roundTripTime = Date.now() - data.client_time;
        videoLatency = roundTripTime / 2000;
        updateLatencyDisplay(roundTripTime);
    }
}

function updateLatencyDisplay(roundTripTime) {
    const latencyDisplay = document.getElementById('latency-display');
    if (latencyDisplay) {
        latencyDisplay.textContent = `${roundTripTime}ms`;
        latencyDisplay.className = roundTripTime < 100 ? 'text-success' : 
                                  roundTripTime < 300 ? 'text-warning' : 'text-danger';
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
    
    const sanitizedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    messageElement.innerHTML = `
        <strong class="text-primary">${username}:</strong> ${sanitizedMessage}
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
        showNotification('Message cannot be empty', 'warning');
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
    if (!videoContainer) return;
    
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
    
    const videoControls = document.getElementById('video-controls');
    if (videoControls) {
        videoControls.classList.remove('d-none');
    }
    
    const placeholder = document.getElementById('player-placeholder');
    if (placeholder) {
        placeholder.classList.add('d-none');
    }
    
    const videoTypeDisplay = document.getElementById('video-type-display');
    if (videoTypeDisplay) {
        videoTypeDisplay.textContent = videoType.charAt(0).toUpperCase() + videoType.slice(1);
    }
}

function loadYouTubeVideo(videoId) {
    const videoContainer = document.getElementById('video-container');
    if (!videoContainer) return;
    
    videoContainer.innerHTML = '';
    
    const youtubeDiv = document.createElement('div');
    youtubeDiv.id = 'youtube-player';
    videoContainer.appendChild(youtubeDiv);
    
    initializeYouTubePlayer();
}

function loadVimeoVideo(videoId) {
    const videoContainer = document.getElementById('video-container');
    if (!videoContainer) return;
    
    videoContainer.innerHTML = '';
    
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.vimeo.com/video/${videoId}?autoplay=0&title=0&byline=0&portrait=0`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.allowFullscreen = true;
    iframe.allow = 'autoplay; fullscreen';
    iframe.style.border = 'none';
    
    videoContainer.appendChild(iframe);
}

function loadGenericVideo(url) {
    const videoContainer = document.getElementById('video-container');
    if (!videoContainer) return;
    
    videoContainer.innerHTML = '';
    
    videoElement = document.createElement('video');
    videoElement.id = 'html5-video';
    videoElement.controls = true;
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'contain';
    videoElement.crossOrigin = 'anonymous';
    
    const source = document.createElement('source');
    source.src = url;
    videoElement.appendChild(source);
    
    videoContainer.appendChild(videoElement);
    
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
            if (player && player.playVideo) {
                player.playVideo();
                sendVideoControl('play', player.getCurrentTime());
            }
            break;
        case 'vimeo':
            showNotification('Vimeo play control not implemented yet', 'info');
            break;
        case 'direct':
            if (videoElement) {
                videoElement.play();
                sendVideoControl('play', videoElement.currentTime);
            }
            break;
    }
}

function pauseVideo() {
    switch(videoType) {
        case 'youtube':
            if (player && player.pauseVideo) {
                player.pauseVideo();
                sendVideoControl('pause', player.getCurrentTime());
            }
            break;
        case 'vimeo':
            showNotification('Vimeo pause control not implemented yet', 'info');
            break;
        case 'direct':
            if (videoElement) {
                videoElement.pause();
                sendVideoControl('pause', videoElement.currentTime);
            }
            break;
    }
}

function syncVideo() {
    let currentTimestamp = 0;
    
    switch(videoType) {
        case 'youtube':
            if (player && player.getCurrentTime) {
                currentTimestamp = player.getCurrentTime();
            }
            break;
        case 'direct':
            if (videoElement) {
                currentTimestamp = videoElement.currentTime;
            }
            break;
    }
    
    sendVideoControl('sync', currentTimestamp);
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

async function startScreenSharing() {
    try {
        if (typeof webRTCManager !== 'undefined' && webRTCManager) {
            const success = await webRTCManager.startScreenShare();
            
            if (success && roomSocket && roomSocket.readyState === WebSocket.OPEN) {
                roomSocket.send(JSON.stringify({
                    'type': 'screen_share',
                    'action': 'start'
                }));
                
                if (startScreenShare) startScreenShare.classList.add('d-none');
                if (stopScreenShare) stopScreenShare.classList.remove('d-none');
                showNotification('Screen sharing started', 'success');
            }
        } else {
            showNotification('Screen sharing not available', 'error');
        }
    } catch (error) {
        console.error('Screen sharing error:', error);
        showNotification('Failed to start screen sharing: ' + error.message, 'error');
    }
}

function stopScreenSharing() {
    if (typeof webRTCManager !== 'undefined' && webRTCManager) {
        webRTCManager.stopScreenShare();
    }
    
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'screen_share',
            'action': 'stop'
        }));
    }
    
    if (stopScreenShare) stopScreenShare.classList.add('d-none');
    if (startScreenShare) startScreenShare.classList.remove('d-none');
    showNotification('Screen sharing stopped', 'info');
}

function handleScreenShareStarted(data) {
    if (data.user_id != userId) {
        showNotification(`${data.username} started screen sharing`, 'info');
    }
}

function handleScreenShareEnded(data) {
    if (data.user_id != userId) {
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

function isValidVideoUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/,
        /^(https?:\/\/)?(www\.)?vimeo\.com\/.+/,
        /^(https?:\/\/).+\.(mp4|webm|ogg|mov|avi|wmv|flv|mkv)(\?.*)?$/i
    ];
    
    return patterns.some(pattern => pattern.test(url));
}

function loadVideo() {
    const url = videoUrlInput.value.trim();
    if (url && isValidVideoUrl(url)) {
    } else {
        showNotification('Please enter a valid YouTube, Vimeo, or video file URL', 'error');
    }
}

function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification-container').forEach(alert => alert.remove());
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show notification-container`;  
    
    const icons = {
        'success': 'check-circle',
        'danger': 'exclamation-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };
    
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${icons[type] || 'info-circle'} me-2"></i>
            <div>${message}</div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            `;
    
    document.body.appendChild(notification);

    const closeButton = notification.querySelector('.btn-close');
    if (closeButton) {
        closeButton.addEventListener('click', function() {
            notification.remove();
        });
    }
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);

    return notification;

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

    setInterval(calculateLatency, 30000);
    calculateLatency();

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