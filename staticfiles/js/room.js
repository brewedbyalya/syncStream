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

let timeUpdateInterval;

let ytReady = false;
let pendingVideoId = null;

let typingTimeout;
let isTyping = false;


window.onYouTubeIframeAPIError = function(error) {
    console.error('YouTube API Error:', error);
    showNotification('YouTube player failed to load', 'error');
    youTubeAPILoadCallbacks.forEach(callback => callback());
    youTubeAPILoadCallbacks = [];
};

function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) {
        youTubeAPILoaded = true;
        return Promise.resolve();
    }
    
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        return new Promise(resolve => {
            youTubeAPILoadCallbacks.push(resolve);
        });
    }
    
    return new Promise((resolve, reject) => {
        window.onYouTubeIframeAPIReady = function() {
            youTubeAPILoaded = true;
            resolve();
            youTubeAPILoadCallbacks.forEach(callback => callback());
            youTubeAPILoadCallbacks = [];
        };
        
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = reject;
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    });
}

async function initializeYouTubePlayer() {
    try {
        await loadYouTubeAPI();
        createYouTubePlayer();
    } catch (error) {
        console.error('Failed to load YouTube API:', error);
        showNotification('Failed to load YouTube player', 'error');
    }
}

function createYouTubePlayer() {
  const el = document.getElementById('youtube-player');
  if (!el) { console.error('YouTube player element not found'); return; }

  try {
    if (window.player) window.player.destroy();

    const currentOrigin = window.location.origin;

    window.player = new YT.Player('youtube-player', {
      height: '100%',
      width: '100%',
      host: 'https://www.youtube.com',
      playerVars: {
        playsinline: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        enablejsapi: 1,
        origin: currentOrigin
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
    player = window.player;
  } catch (err) {
    console.error('Error creating YouTube player:', err);
    showNotification('Error creating YouTube player', 'error');
  }
}

function onPlayerReady() {
  ytReady = true;
  console.log('YouTube player ready');

  if (pendingVideoId && player && player.cueVideoById) {
    player.cueVideoById(pendingVideoId);
    pendingVideoId = null;
  }

  const videoControls = document.getElementById('video-controls');
  if (videoControls) videoControls.classList.remove('d-none');
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
    
    const errorMessages = {
        2: 'The request contains an invalid parameter value',
        5: 'The requested content cannot be played in an HTML5 player',
        100: 'The video requested was not found',
        101: 'The owner of the requested video does not allow it to be played in embedded players',
        150: 'The owner of the requested video does not allow it to be played in embedded players'
    };
    
    const errorMessage = errorMessages[event.data] || 'Error loading YouTube video';
    showNotification(errorMessage, 'error');
    
    const placeholder = document.getElementById('player-placeholder');
    if (placeholder) {
        placeholder.classList.remove('d-none');
    }
    
    const videoControls = document.getElementById('video-controls');
    if (videoControls) {
        videoControls.classList.add('d-none');
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}/`;
    console.log('Connecting to WebSocket:', wsUrl);
    
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
    console.log('WebSocket message:', data.type, data);
    
    switch(data.type) {
        case 'chat_message':
            appendMessage(data.username, data.message, data.timestamp);
            if (isTyping) {
                sendTypingStop();
            }
            hideTypingIndicatorByName(data.username);
            break;
            
        case 'typing_indicator': 
            handleTypingIndicator(data);
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

        case 'message_deleted':
            handleMessageDeleted(data);
            break;
            
        case 'pong':
            handlePingPong(data);
            break;

        case 'user_muted':
            handleUserMuted(data);
            break;
            
        case 'user_unmuted':
            handleUserUnmuted(data);
            break;

        case 'banned_word_added':
            handleBannedWordAdded(data);
            break;
            
        case 'banned_word_removed':
            handleBannedWordRemoved(data);

        case 'user_kicked':
            handleUserKicked(data);
            break;
            
        case 'you_were_kicked':
            handleYouWereKicked(data);
            break;

        case 'user_banned':
            handleUserBanned(data);
            break;

        case 'you_were_banned':
            handleYouWereBanned(data);
            break;

        case 'user_unbanned':
            handleUserUnbanned(data);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}


function handleMessageDeleted(data) {
    console.log('Handling message deletion via WebSocket:', data);
    
    const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
    if (messageElement) {
        messageElement.remove();
        updateMessageCount();
        
        if (data.deleted_by !== username) {
            const truncatedContent = data.message_content.length > 100 ? 
                data.message_content.substring(0, 100) + '...' : data.message_content;
            showNotification(`Message "${truncatedContent}" by ${data.message_author} was deleted by ${data.deleted_by}`, 'info');
        }
    }
}


function handleUserMuted(data) {
    showNotification(`${data.username} was muted by ${data.muted_by} for ${data.duration} minutes`, 'warning');
    updateParticipantMuteStatus(data.user_id, true);
}

function handleUserUnmuted(data) {
    showNotification(`${data.username} was unmuted by ${data.unmuted_by}`, 'success');
    updateParticipantMuteStatus(data.user_id, false);
}

function handleBannedWordAdded(data) {
    console.log('Banned word added:', data);
    
    if (isRoomCreator) {
        addBannedWordToUI(data.word);
        if (data.added_by !== username) {
            showNotification(`"${data.word}" added to banned words by ${data.added_by}`, 'success');
        }
    }
}

function handleBannedWordRemoved(data) {
    console.log('Banned word removed:', data);
    
    if (isRoomCreator) {
        removeBannedWordFromUI(data.word);
        if (data.removed_by !== username) {
            showNotification(`"${data.word}" removed from banned words by ${data.removed_by}`, 'info');
        }
    }
}

function handleUserBanned(data) {
    showNotification(`${data.username} was permanently banned by ${data.banned_by}`, 'warning');
    const participantElement = document.querySelector(`.participant-card[data-user-id="${data.user_id}"]`);
    if (participantElement) {
        participantElement.remove();
    }
    updateOnlineCount(-1);
}

function handleYouWereBanned(data) {
    showNotification(`You were permanently banned from "${data.room_name}" by ${data.banned_by}`, 'danger');
    setTimeout(() => {
        window.location.href = '/';
    }, 3000);
}

function handleUserUnbanned(data) {
    showNotification(`${data.username} was unbanned by ${data.unbanned_by}`, 'success');
}

function handleTypingIndicator(data) {
    console.log('Typing indicator received:', data);
    
    if (data.user_id != userId) {
        if (data.is_typing) {
            showTypingIndicator(data.username);
        } else {
            hideTypingIndicatorByName(data.username);
        }
    }
}

function handleUserKicked(data) {
    console.log('User kicked:', data);
    showNotification(`${data.username} was kicked by ${data.kicked_by}`, 'warning');
    
    const participantElement = document.querySelector(`.participant-card[data-user-id="${data.user_id}"]`);
    if (participantElement) {
        participantElement.remove();
    }
    
    if (onlineCount) {
        const count = parseInt(onlineCount.textContent) - 1;
        onlineCount.textContent = count + ' online';
    }
}

function handleYouWereKicked(data) {
    console.log('You were kicked:', data);
    showNotification(`You were kicked from "${data.room_name}" by ${data.kicked_by}`, 'danger');
    
    setTimeout(() => {
        showNotification('Redirecting to home page...', 'info');
        window.location.href = '/';
    }, 3000);
}

function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    const typingUsers = document.getElementById('typing-users');
    
    if (!indicator || !typingUsers) {
        console.error('Typing indicator elements not found');
        return;
    }
    
    clearTimeout(window.typingHideTimeout);
    
    typingUsers.textContent = `${username} is typing`;
    indicator.classList.remove('d-none');
    
    window.typingHideTimeout = setTimeout(() => {
        hideTypingIndicator();
    }, 3000);
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.classList.add('d-none');
    }
}

function hideTypingIndicatorByName(username) {
    const indicator = document.getElementById('typing-indicator');
    const typingUsers = document.getElementById('typing-users');
    
    if (!indicator || !typingUsers) return;
    
    if (typingUsers.textContent.includes(username)) {
        hideTypingIndicator();
    }
}

function sendTypingStart() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN && !isTyping) {
        roomSocket.send(JSON.stringify({
            'type': 'typing_start'
        }));
        isTyping = true;
    }
}

function sendTypingStop() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN && isTyping) {
        roomSocket.send(JSON.stringify({
            'type': 'typing_stop'
        }));
        isTyping = false;
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
    }   else if (e.code === 4005) {  
        showNotification('You are banned from this room', 'error');
        updateChatIndicator('banned', 'Banned');
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


async function loadYouTubeVideo(videoId) {
  const container = document.getElementById('video-container');
  if (!container) return;

  container.innerHTML = '';
  const youtubeDiv = document.createElement('div');
  youtubeDiv.id = 'youtube-player';
  container.appendChild(youtubeDiv);

  try {
    await initializeYouTubePlayer();

    if (!ytReady) {
      pendingVideoId = videoId;
      return;
    }

    if (player && player.cueVideoById) {
      player.cueVideoById({ videoId, startSeconds: 0 });
    } else {
      console.warn('Player not ready to cue; deferring.');
      pendingVideoId = videoId;
    }
  } catch (err) {
    console.error('Error loading YouTube video:', err);
    showNotification('Failed to load YouTube video', 'error');
  }
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

function cleanupYouTubePlayer() {
    if (window.player) {
        try {
            window.player.destroy();
            window.player = null;
        } catch (error) {
            console.error('Error destroying YouTube player:', error);
        }
    }
}

async function loadVideoToPlayer(url) {
    videoUrl = url;
    const videoInfo = extractVideoId(url);
    
    if (!videoInfo) {
        showNotification('Unsupported video format', 'error');
        return;
    }
    
    const videoContainer = document.getElementById('video-container');
    if (!videoContainer) return;
    
    videoContainer.innerHTML = `
        <div class="d-flex justify-content-center align-items-center h-100">
            <div class="spinner-border text-light" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span class="ms-2 text-light">Loading video...</span>
        </div>
    `;
    
    cleanupYouTubePlayer();
    
    videoType = videoInfo.type;
    
    try {
        switch(videoType) {
            case 'youtube':
                await loadYouTubeVideo(videoInfo.id);
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
    } catch (error) {
        console.error('Error loading video:', error);
        showNotification('Error loading video: ' + error.message, 'error');
        
        videoContainer.innerHTML = '';
        const placeholder = document.getElementById('player-placeholder');
        if (placeholder) {
            placeholder.classList.remove('d-none');
        }
    }
}

function loadVideo() {
    const url = videoUrlInput.value.trim();
    if (url && isValidVideoUrl(url)) {
        const videoInfo = extractVideoId(url);
        if (videoInfo) {
            sendVideoControl('load', 0, url);
            loadVideoToPlayer(url);
        } else {
            showNotification('Unsupported video URL format', 'error');
        }
    } else {
        showNotification('Please enter a valid YouTube, Vimeo, or video file URL', 'error');
    }
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

function banUser(userId, userName) {
    if (!confirm(`Permanently ban ${userName} from this room? They will not be able to rejoin even with the invite link.`)) return;
    
    const formData = new FormData();
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));
    
    fetch(`/rooms/${roomId}/users/${userId}/ban/`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(`Permanently banned ${userName} from the room`, 'success');
        } else {
            showNotification('Failed to ban user: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error banning user:', error);
        showNotification('Error banning user', 'error');
    });
}

function unbanUser(userId, userName) {
    if (!confirm(`Unban ${userName}? They will be able to rejoin the room.`)) return;
    
    const formData = new FormData();
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));
    
    fetch(`/rooms/${roomId}/users/${userId}/unban/`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(`Unbanned ${userName}`, 'success');
        } else {
            showNotification('Failed to unban user: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error unbanning user:', error);
        showNotification('Error unbanning user', 'error');
    });
}

function updateOnlineCount(change) {
    const onlineCountElement = document.getElementById('online-count');
    const onlineCountBadge = document.getElementById('online-count-badge');
    
    if (onlineCountElement) {
        const currentText = onlineCountElement.textContent;
        const currentCount = parseInt(currentText) || 0;
        const newCount = Math.max(0, currentCount + change);
        onlineCountElement.textContent = newCount + ' online';
    }
    
    if (onlineCountBadge) {
        const currentText = onlineCountBadge.textContent;
        const currentCount = parseInt(currentText) || 0;
        const newCount = Math.max(0, currentCount + change);
        onlineCountBadge.textContent = newCount + ' online';
    }
}

function isValidVideoUrl(url) {
    if (!url) return false;

    if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return true;
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
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

function extractVideoId(input) {
  if (!input) return null;

  const raw = input.trim();
  const rawMatch = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (rawMatch) return { type: 'youtube', id: rawMatch[0] };

  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1] || '';
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return { type: 'youtube', id };
    }

    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { type: 'youtube', id: v };

      const m1 = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
      if (m1) return { type: 'youtube', id: m1[1] };

      const m2 = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      if (m2) return { type: 'youtube', id: m2[1] };

      const vi = u.searchParams.get('vi');
      if (vi && /^[A-Za-z0-9_-]{11}$/.test(vi)) return { type: 'youtube', id: vi };
    }
  } catch (e) {
  }

  const tail = input.match(/(?:v=|\/)([A-Za-z0-9_-]{11})(?:[?&].*)?$/);
  if (tail) return { type: 'youtube', id: tail[1] };

  return null;
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

function kickUser(userId, userName) {
    if (!confirm(`Kick ${userName} from the room? They can rejoin if they have the link.`)) return;
    
    console.log('Kicking user:', userId, userName);
    
    const formData = new FormData();
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));
    
    fetch(`/rooms/${roomId}/users/${userId}/kick/`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(`Kicked ${userName} from the room`, 'success');
            const participantElement = document.querySelector(`.participant-card[data-user-id="${userId}"]`);
            if (participantElement) {
                participantElement.remove();
            }
            if (onlineCount) {
                const count = parseInt(onlineCount.textContent) - 1;
                onlineCount.textContent = count + ' online';
            }
        } else {
            showNotification('Failed to kick user: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error kicking user:', error);
        showNotification('Error kicking user', 'error');
    });
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
    
        if (chatInput) {
            chatInput.addEventListener('input', function() {
                if (!isTyping) {
                    sendTypingStart();
                }
                
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    if (isTyping) {
                        sendTypingStop();
                    }
                }, 1000);
            });
        
            chatInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    if (isTyping) {
                        sendTypingStop();
                    }
                    sendChatMessage();
                }
            });
            
            chatInput.addEventListener('blur', function() {
                if (isTyping) {
                    sendTypingStop();
                }
            });
        }
    
        if (loadVideoBtn) loadVideoBtn.addEventListener('click', loadVideo);
    if (videoUrlInput) videoUrlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            loadVideo();
        }
    });

        if (isRoomCreator) {
        console.log('Loading banned words for room creator...');
        loadBannedWords();
    }

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
    cleanupYouTubePlayer();
    
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.close(1000, 'Page navigation');
    }
    
    if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
    }
});