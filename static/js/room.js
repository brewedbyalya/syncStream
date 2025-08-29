let roomSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

let player;
let isPlaying = false;
let currentTime = 0;
let videoUrl = null;
let videoType = null;
let screenStream = null;
let peerConnection = null;

let chatMessages, chatInput, chatSend, videoUrlInput, loadVideoBtn;
let playBtn, pauseBtn, syncBtn, startScreenShare, stopScreenShare;
let screenShareContainer, onlineCount, chatIndicator;

let tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
let firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    player = new YT.Player('video-container', {
        height: '100%',
        width: '100%',
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'modestbranding': 1,
            'rel': 0
        },
        events: {
            'onStateChange': onPlayerStateChange,
            'onReady': onPlayerReady
        }
    });
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
    
    setInterval(() => {
        if (player && player.getCurrentTime) {
            currentTime = player.getCurrentTime();
        }
    }, 1000);
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
    const url = videoUrlInput.value;
    if (url) {
        sendVideoControl('load', 0, url);
        loadVideoToPlayer(url);
    }
}

function loadVideoToPlayer(url) {
    videoUrl = url;
    
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        videoType = 'youtube';
        loadYouTubeVideo(url);
    } else if (url.includes('vimeo.com')) {
        videoType = 'vimeo';
        loadVimeoVideo(url);
    } else {
        videoType = 'generic';
        loadGenericVideo(url);
    }
}

function loadYouTubeVideo(url) {
    const videoId = extractYouTubeId(url);
    if (videoId && player) {
        player.loadVideoById(videoId);
        document.getElementById('player-placeholder').classList.add('d-none');
        document.getElementById('video-controls').classList.remove('d-none');
    }
}

function extractYouTubeId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length == 11) ? match[7] : null;
}

function loadVimeoVideo(url) {
    const videoId = extractVimeoId(url);
    if (videoId) {
        const iframe = document.createElement('iframe');
        iframe.src = `https://player.vimeo.com/video/${videoId}?autoplay=0&title=0&byline=0&portrait=0`;
        iframe.width = '100%';
        iframe.height = '100%';
        iframe.frameBorder = '0';
        iframe.allowFullscreen = true;
        
        const container = document.getElementById('video-container');
        container.innerHTML = '';
        container.appendChild(iframe);
        document.getElementById('player-placeholder').classList.add('d-none');
        document.getElementById('video-controls').classList.remove('d-none');
    }
}

function extractVimeoId(url) {
    const regExp = /(?:vimeo\.com\/)(?:channels\/|groups\/[^\/]*\/videos\/|album\/\d+\/video\/|)(\d+)(?:$|\/|\?)/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

function loadGenericVideo(url) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.style.width = '100%';
    video.style.height = '100%';
    
    video.addEventListener('play', () => {
        isPlaying = true;
        sendVideoControl('play', video.currentTime);
    });
    
    video.addEventListener('pause', () => {
        isPlaying = false;
        sendVideoControl('pause', video.currentTime);
    });
    
    video.addEventListener('timeupdate', () => {
        currentTime = video.currentTime;
    });
    
    const container = document.getElementById('video-container');
    container.innerHTML = '';
    container.appendChild(video);
    document.getElementById('player-placeholder').classList.add('d-none');
    document.getElementById('video-controls').classList.remove('d-none');
}

function playVideo() {
    if (videoType === 'youtube' && player) {
        player.playVideo();
    } else if (videoType === 'vimeo' || videoType === 'generic') {
        const video = document.querySelector('#video-container video');
        if (video) video.play();
    }
    sendVideoControl('play', currentTime);
    isPlaying = true;
}

function pauseVideo() {
    if (videoType === 'youtube' && player) {
        player.pauseVideo();
    } else if (videoType === 'vimeo' || videoType === 'generic') {
        const video = document.querySelector('#video-container video');
        if (video) video.pause();
    }
    sendVideoControl('pause', currentTime);
    isPlaying = false;
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
        switch(data.action) {
            case 'play':
                if (videoType === 'youtube' && player) {
                    player.playVideo();
                } else if (videoType === 'vimeo' || videoType === 'generic') {
                    const video = document.querySelector('#video-container video');
                    if (video) video.play();
                }
                isPlaying = true;
                showNotification(`${data.username} played the video`, 'info');
                break;
                
            case 'pause':
                if (videoType === 'youtube' && player) {
                    player.pauseVideo();
                } else if (videoType === 'vimeo' || videoType === 'generic') {
                    const video = document.querySelector('#video-container video');
                    if (video) video.pause();
                }
                isPlaying = false;
                showNotification(`${data.username} paused the video`, 'info');
                break;
                
            case 'load':
                videoUrlInput.value = data.url;
                loadVideoToPlayer(data.url);
                showNotification(`${data.username} loaded a new video`, 'info');
                break;
                
            case 'sync':
                currentTime = data.timestamp;
                if (videoType === 'youtube' && player) {
                    player.seekTo(data.timestamp, true);
                } else if (videoType === 'vimeo' || videoType === 'generic') {
                    const video = document.querySelector('#video-container video');
                    if (video) video.currentTime = data.timestamp;
                }
                showNotification('Video synced by another user', 'info');
                break;
        }
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
});