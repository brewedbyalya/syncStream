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
        showNotification('Failed to load YouTube player', 'error');
    }
}

function createYouTubePlayer() {
    const el = document.getElementById('youtube-player');
    if (!el) {
        showNotification('YouTube player element not found', 'error');
        return;
    }

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
        showNotification('Error creating YouTube player', 'error');
    }
}

function onPlayerReady() {
    ytReady = true;
    showNotification('Video player ready!', 'success');

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
    const errorMessages = {
        2: 'Invalid parameter value',
        5: 'Content cannot be played',
        100: 'Video not found',
        101: 'Embedding not allowed',
        150: 'Embedding not allowed'
    };
    
    const errorMessage = errorMessages[event.data] || 'Error loading YouTube video';
    showNotification(errorMessage, 'error');
    
    const placeholder = document.getElementById('player-placeholder');
    if (placeholder) placeholder.classList.remove('d-none');
    
    const videoControls = document.getElementById('video-controls');
    if (videoControls) videoControls.classList.add('d-none');
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomId}/`;
    
    roomSocket = new WebSocket(wsUrl);

    roomSocket.onopen = function(e) {
        reconnectAttempts = 0;
        updateChatIndicator('connected', 'Connected');
        showNotification('Connected to room', 'success');
    };

    roomSocket.onmessage = function(e) {
        try {
            const data = JSON.parse(e.data);
            handleWebSocketMessage(data);
        } catch (error) {
            showNotification('Cannot process message', 'error');
        }
    };

    roomSocket.onclose = function(e) {
        handleDisconnection(e);
    };

    roomSocket.onerror = function(e) {
        updateChatIndicator('error', 'Connection Error');
        showNotification('Connection error', 'danger');
    };
}

async function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'chat_message':
            appendMessage(data.username, data.message, data.timestamp, data.message_id);
            if (isTyping) sendTypingStop();
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
            break;
        case 'user_kicked':
            handleUserKicked(data);
            break;
        case 'you_were_kicked':
            await handleYouWereKicked(data);
            break;
        case 'user_banned':
            handleUserBanned(data);
            break;
        case 'you_were_banned':
            await handleYouWereBanned(data);
            break;
        case 'user_unbanned':
            handleUserUnbanned(data);
            break;
        default:
            showNotification('Unknown message type', 'warning');
    }
}

function handleMessageDeleted(data) {
    const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
    if (messageElement) {
        messageElement.remove();
        updateMessageCount();
        if (data.deleted_by !== username) {
            showNotification(`Message was deleted by ${data.deleted_by}`, 'info');
        }
    }
}

function handleUserJoined(data) {
    const existingParticipant = document.querySelector(`.participant-card[data-user-id="${data.user_id}"]`);
    if (existingParticipant) {
        existingParticipant.classList.remove('participant-card-offline');
        existingParticipant.classList.add('participant-card-online');
        const statusElement = existingParticipant.querySelector('.status-online, .status-offline');
        if (statusElement) {
            statusElement.className = 'status-online';
            statusElement.textContent = '● Online';
        }
    } else {
        addParticipantToUI({
            id: data.user_id,
            username: data.username,
            is_online: true,
            is_creator: false,
            is_muted: false,
            is_banned: false
        });
    }
    updateOnlineCount(1);
    showNotification(`${data.username} joined the room`, 'success');
}

function handleUserLeft(data) {
    const participantElement = document.querySelector(`.participant-card[data-user-id="${data.user_id}"]`);
    if (participantElement) {
        participantElement.classList.remove('participant-card-online');
        participantElement.classList.add('participant-card-offline');
        const statusElement = participantElement.querySelector('.status-online, .status-offline');
        if (statusElement) {
            statusElement.className = 'status-offline';
            statusElement.textContent = '● Offline';
        }
    }
    updateOnlineCount(-1);
    showNotification(`${data.username} left the room`, 'warning');
}

function addParticipantToUI(participant) {
    const participantsGrid = document.querySelector('.participants-grid');
    if (!participantsGrid) return;
    
    const participantCard = document.createElement('div');
    participantCard.className = `participant-card ${participant.is_online ? 'participant-card-online' : 'participant-card-offline'} ${participant.is_creator ? 'participant-card-creator' : ''} ${participant.is_muted ? 'participant-muted' : ''} ${participant.is_banned ? 'participant-banned' : ''}`;
    participantCard.setAttribute('data-user-id', participant.id);
    
    participantCard.innerHTML = `
        <div class="participant-avatar">
            <i class="fas fa-user"></i>
            ${participant.is_muted ? '<span class="muted-badge" title="Muted"><i class="fas fa-volume-mute"></i></span>' : ''}
            ${participant.is_banned ? '<span class="banned-badge" title="Banned"><i class="fas fa-ban"></i></span>' : ''}
        </div>
        <strong class="participant-name">${participant.username}</strong>
        ${participant.is_creator ? '<div class="text-warning small"><i class="fas fa-crown" title="Room Creator"></i> Creator</div>' : ''}
        <div class="small">
            <span class="${participant.is_online ? 'status-online' : 'status-offline'}" title="${participant.is_online ? 'Online' : 'Offline'}">
                ● ${participant.is_online ? 'Online' : 'Offline'}
            </span>
        </div>
        ${room.creator == user && participant.id != userId ? `
        <div class="participant-actions">
            ${participant.is_muted ? `
            <button class="btn btn-sm btn-success" 
                    onclick="unmuteUser('${participant.id}', '${participant.username.replace(/'/g, "\\'")}')"
                    title="Unmute user">
                <i class="fas fa-volume-up"></i>
            </button>
            ` : `
            <button class="btn btn-sm btn-warning" 
                    onclick="showMuteModal('${participant.id}', '${participant.username.replace(/'/g, "\\'")}')"
                    title="Mute user">
                <i class="fas fa-volume-mute"></i>
            </button>
            `}
            <button class="btn btn-sm btn-danger" 
                    onclick="kickUser('${participant.id}', '${participant.username.replace(/'/g, "\\'")}')"
                    title="Kick user from room">
                <i class="fas fa-user-times"></i>
            </button>
            ${participant.is_banned ? `
            <button class="btn btn-sm btn-success" 
                    onclick="unbanUser('${participant.id}', '${participant.username.replace(/'/g, "\\'")}')"
                    title="Unban user">
                <i class="fas fa-user-check"></i>
            </button>
            ` : `
            <button class="btn btn-sm btn-danger" 
                    onclick="banUser('${participant.id}', '${participant.username.replace(/'/g, "\\'")}')"
                    title="Permanently ban user">
                <i class="fas fa-ban"></i>
            </button>
            `}
        </div>
        ` : ''}
    `;
    
    participantsGrid.appendChild(participantCard);
}

function removeParticipantFromUI(userId) {
    const participantElement = document.querySelector(`.participant-card[data-user-id="${userId}"]`);
    if (participantElement) participantElement.remove();
    updateOnlineCount(-1);
}

function handleUserMuted(data) {
    showNotification(`${data.username} was muted by ${data.muted_by}`, 'warning');
    updateParticipantMuteStatus(data.user_id, true);
}

function handleUserUnmuted(data) {
    showNotification(`${data.username} was unmuted by ${data.unmuted_by}`, 'success');
    updateParticipantMuteStatus(data.user_id, false);
}

function handleBannedWordAdded(data) {
    if (isRoomCreator) {
        addBannedWordToUI(data.word);
        if (data.added_by !== username) {
            showNotification(`"${data.word}" added to banned words`, 'success');
        }
    }
}

function handleBannedWordRemoved(data) {
    if (isRoomCreator) {
        removeBannedWordFromUI(data.word);
        if (data.removed_by !== username) {
            showNotification(`"${data.word}" removed from banned words`, 'info');
        }
    }
}

function handleUserBanned(data) {
    showNotification(`${data.username} was permanently banned`, 'warning');
    removeParticipantFromUI(data.user_id);
}

function handleUserUnbanned(data) {
    showNotification(`${data.username} was unbanned`, 'success');
}

function handleTypingIndicator(data) {
    if (data.user_id != userId) {
        if (data.is_typing) {
            showTypingIndicator(data.username);
        } else {
            hideTypingIndicatorByName(data.username);
        }
    }
}

function handleUserKicked(data) {
    showNotification(`${data.username} was kicked`, 'warning');
    removeParticipantFromUI(data.user_id);
}

async function handleYouWereKicked(data) {
    showNotification(`You were kicked from "${data.room_name}"`, 'danger');
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.close(1000, 'User was kicked');
    }
    disableRoomFeatures('kicked');
    setTimeout(() => {
        window.location.href = data.redirect_url || '/';
    }, 2500);
}

async function handleYouWereBanned(data) {
    showNotification(`You were permanently banned from "${data.room_name}"`, 'danger');
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.close(1000, 'User was banned');
    }
    disableRoomFeatures('banned');
    setTimeout(() => {
        window.location.href = data.redirect_url || `/rooms/youre-banned/?room_name=${encodeURIComponent(data.room_name)}&banned_by=${encodeURIComponent(data.banned_by)}`;
    }, 2500);
}

function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    const typingUsers = document.getElementById('typing-users');
    if (!indicator || !typingUsers) return;
    
    clearTimeout(window.typingHideTimeout);
    typingUsers.textContent = `${username} is typing`;
    indicator.classList.remove('d-none');
    window.typingHideTimeout = setTimeout(hideTypingIndicator, 3000);
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.classList.add('d-none');
}

function hideTypingIndicatorByName(username) {
    const indicator = document.getElementById('typing-indicator');
    const typingUsers = document.getElementById('typing-users');
    if (!indicator || !typingUsers) return;
    if (typingUsers.textContent.includes(username)) hideTypingIndicator();
}

function sendTypingStart() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN && !isTyping) {
        roomSocket.send(JSON.stringify({'type': 'typing_start'}));
        isTyping = true;
    }
}

function sendTypingStop() {
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN && isTyping) {
        roomSocket.send(JSON.stringify({'type': 'typing_stop'}));
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
        latencyDisplay.className = roundTripTime < 100 ? 'text-success' : roundTripTime < 300 ? 'text-warning' : 'text-danger';
    }
}

function handleDisconnection(e) {
    if (e.code === 4001) {
        showNotification('Room not found', 'error');
        updateChatIndicator('disconnected', 'Room Not Available');
    } else if (e.code === 4002) {
        showNotification('Error connecting to room', 'error');
        updateChatIndicator('error', 'Connection Error');
    } else if (e.code === 4005) {
        showNotification('You are banned from this room', 'error');
        updateChatIndicator('banned', 'Banned');
    } else if (e.code === 4006 || e.code === 4007) {
        return;
    } else if (reconnectAttempts < maxReconnectAttempts) {
        updateChatIndicator('connecting', 'Reconnecting...');
        setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
        }, 2000 * reconnectAttempts);
    } else {
        updateChatIndicator('disconnected', 'Disconnected');
        showNotification('Failed to reconnect. Please refresh.', 'error');
    }
}

function updateChatIndicator(status, text) {
    const indicator = document.getElementById('chat-indicator');
    if (!indicator) return;
    indicator.className = 'badge bg-' + (status === 'connected' ? 'success' : status === 'connecting' ? 'warning' : status === 'error' ? 'danger' : 'secondary');
    indicator.textContent = text;
}

function appendMessage(username, message, timestamp, messageId) {
    const messageContainer = document.createElement('div');
    messageContainer.className = 'message-container';
    messageContainer.setAttribute('data-message-id', messageId);
    
    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const sanitizedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `mb-2 message ${username === "{{ user.username }}" ? 'message-self' : username === 'System' ? 'message-system' : 'message-other'} fade-in`;
    
    const usernameLink = document.createElement('a');
    usernameLink.href = `/accounts/profile/${username}/`;
    usernameLink.className = 'text-primary';
    usernameLink.innerHTML = `<strong>${username}:</strong>`;
    
    const messageContent = document.createElement('span');
    messageContent.className = 'message-content';
    messageContent.textContent = sanitizedMessage;
    
    const timeSpan = document.createElement('small');
    timeSpan.className = 'text-muted ms-2';
    timeSpan.innerHTML = `<i class="fas fa-clock me-1"></i>${time}`;
    
    messageDiv.appendChild(usernameLink);
    messageDiv.appendChild(document.createTextNode(' '));
    messageDiv.appendChild(messageContent);
    messageDiv.appendChild(timeSpan);
    
    if (isRoomCreator) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-link text-danger delete-message-btn ms-2';
        deleteBtn.title = 'Delete message';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            deleteMessage(messageId);
    };
                messageDiv.appendChild(deleteBtn);
}
    
    messageContainer.appendChild(messageDiv);
    
    if (chatMessages) {
        chatMessages.appendChild(messageContainer);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    updateMessageCount();
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
            pendingVideoId = videoId;
        }
    } catch (err) {
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
        showNotification('Error loading video', 'error');
    });
}

function cleanupYouTubePlayer() {
    if (window.player) {
        try {
            window.player.destroy();
            window.player = null;
        } catch (error) {
            showNotification('Error cleaning up player', 'error');
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
            case 'youtube': await loadYouTubeVideo(videoInfo.id); break;
            case 'vimeo': loadVimeoVideo(videoInfo.id); break;
            case 'direct': loadGenericVideo(videoInfo.id); break;
            default: showNotification('Unsupported video format', 'error'); return;
        }

        const videoControls = document.getElementById('video-controls');
        if (videoControls) videoControls.classList.remove('d-none');
        const placeholder = document.getElementById('player-placeholder');
        if (placeholder) placeholder.classList.add('d-none');
        const videoTypeDisplay = document.getElementById('video-type-display');
        if (videoTypeDisplay) videoTypeDisplay.textContent = videoType.charAt(0).toUpperCase() + videoType.slice(1);
    } catch (error) {
        showNotification('Error loading video', 'error');
        videoContainer.innerHTML = '';
        const placeholder = document.getElementById('player-placeholder');
        if (placeholder) placeholder.classList.remove('d-none');
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
        showNotification('Please enter a valid video URL', 'error');
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
            showNotification('Vimeo play control not implemented', 'info');
            break;
        case 'direct':
            if (videoElement) {
                videoElement.play();
                sendVideoControl('play', videoElement.currentTime());
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
            showNotification('Vimeo pause control not implemented', 'info');
            break;
        case 'direct':
            if (videoElement) {
                videoElement.pause();
                sendVideoControl('pause', videoElement.currentTime());
            }
            break;
    }
}

function syncVideo() {
    let currentTimestamp = 0;
    switch(videoType) {
        case 'youtube':
            if (player && player.getCurrentTime) currentTimestamp = player.getCurrentTime();
            break;
        case 'direct':
            if (videoElement) currentTimestamp = videoElement.currentTime;
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
            case 'play': executeVideoAction('play', adjustedTimestamp, data.username); break;
            case 'pause': executeVideoAction('pause', adjustedTimestamp, data.username); break;
            case 'load':
                videoUrlInput.value = data.url;
                loadVideoToPlayer(data.url);
                showNotification(`${data.username} loaded a new video`, 'info');
                break;
            case 'sync': executeVideoAction('sync', adjustedTimestamp, data.username); break;
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
                roomSocket.send(JSON.stringify({'type': 'screen_share', 'action': 'start'}));
                if (startScreenShare) startScreenShare.classList.add('d-none');
                if (stopScreenShare) stopScreenShare.classList.remove('d-none');
                showNotification('Screen sharing started', 'success');
            }
        } else {
            showNotification('Screen sharing not available', 'error');
        }
    } catch (error) {
        showNotification('Failed to start screen sharing', 'error');
    }
}

function stopScreenSharing() {
    if (typeof webRTCManager !== 'undefined' && webRTCManager) {
        webRTCManager.stopScreenShare();
    }
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({'type': 'screen_share', 'action': 'stop'}));
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
    updateOnlineCount(1);
    appendMessage('System', `${username} joined the room`);
    showNotification(`${username} joined the room`, 'success');
}

function userLeft(username) {
    updateOnlineCount(-1);
    appendMessage('System', `${username} left the room`);
    showNotification(`${username} left the room`, 'warning');
}

function banUser(userId, userName) {
    if (!confirm(`Permanently ban ${userName} from this room? This cannot be undone.`)) return;
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
            showNotification(`Permanently banned ${userName}`, 'success');
            removeParticipantFromUI(userId);
        } else {
            showNotification('Failed to ban user: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showNotification('Error banning user', 'error');
    });
}

function unbanUser(userId, userName) {
    if (!confirm(`Unban ${userName}?`)) return;
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
        showNotification('Error unbanning user', 'error');
    });
}

function updateOnlineCount(change) {
    const onlineCountElement = document.getElementById('online-count');
    const onlineCountBadge = document.getElementById('online-count-badge');
    if (onlineCountElement) {
        const currentCount = parseInt(onlineCountElement.textContent) || 0;
        const newCount = Math.max(0, currentCount + change);
        onlineCountElement.textContent = newCount;
    }
    if (onlineCountBadge) {
        const currentCount = parseInt(onlineCountBadge.textContent) || 0;
        const newCount = Math.max(0, currentCount + change);
        onlineCountBadge.textContent = newCount + ' online';
    }
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.send(JSON.stringify({
            'type': 'chat_message',
            'message': message
        }));
        chatInput.value = '';
    } else {
        showNotification('Not connected to chat', 'error');
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
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode) notification.remove();
    }, 5000);
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
    } catch (e) {}
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
            removeParticipantFromUI(userId);
        } else {
            showNotification('Failed to kick user: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showNotification('Error kicking user', 'error');
    });
}

function updateParticipantMuteStatus(userId, isMuted) {
    const participantElement = document.querySelector(`.participant-card[data-user-id="${userId}"]`);
    if (participantElement) {
        if (isMuted) {
            participantElement.classList.add('participant-muted');
            if (!participantElement.querySelector('.muted-badge')) {
                const avatar = participantElement.querySelector('.participant-avatar');
                if (avatar) {
                    const mutedBadge = document.createElement('span');
                    mutedBadge.className = 'muted-badge';
                    mutedBadge.title = 'Muted';
                    mutedBadge.innerHTML = '<i class="fas fa-volume-mute"></i>';
                    avatar.appendChild(mutedBadge);
                }
            }
            const muteBtn = participantElement.querySelector('.btn-warning');
            if (muteBtn) {
                muteBtn.classList.replace('btn-warning', 'btn-success');
                muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                const userName = participantElement.querySelector('.participant-name').textContent;
                muteBtn.onclick = function() {
                    unmuteUser(userId, userName);
                };
            }
        } else {
            participantElement.classList.remove('participant-muted');
            const mutedBadge = participantElement.querySelector('.muted-badge');
            if (mutedBadge) mutedBadge.remove();
            const unmuteBtn = participantElement.querySelector('.btn-success');
            if (unmuteBtn) {
                unmuteBtn.classList.replace('btn-success', 'btn-warning');
                unmuteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
                const userName = participantElement.querySelector('.participant-name').textContent;
                unmuteBtn.onclick = function() {
                    showMuteModal(userId, userName);
                };
            }
        }
    }
}

function deleteMessage(messageId) {    
    if (!messageId || messageId === 'undefined') {
        showNotification('Cannot delete message: Invalid message ID', 'error');
        return;
    }
    
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    let messageContent = '';
    let username = '';
    
    if (messageElement) {
        const contentElement = messageElement.querySelector('.message-content');
        const usernameElement = messageElement.querySelector('strong');
        if (contentElement) messageContent = contentElement.textContent;
        if (usernameElement) username = usernameElement.textContent;
    }
    
    const truncatedMessage = messageContent.length > 50 ? 
        messageContent.substring(0, 50) + '...' : messageContent;
    
    if (!confirm(`Are you sure you want to delete this message?\n\n"${truncatedMessage}"\n- by ${username}`)) {
        return;
    }
    
    const deleteBtn = messageElement?.querySelector('.delete-message-btn');
    if (deleteBtn) {
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        deleteBtn.disabled = true;
    }
    
    fetch(`/rooms/${roomId}/messages/${messageId}/delete/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCookie('csrftoken'),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        credentials: 'same-origin'
    })
    .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    })
    .then(data => {
        if (data.success) {
            if (messageElement) {
                messageElement.remove();
                updateMessageCount();
            }
            showNotification('Message deleted successfully', 'success');
        } else {
            showNotification('Failed to delete message: ' + data.error, 'error');
            if (deleteBtn) {
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                deleteBtn.disabled = false;
            }
        }
    })
    .catch(error => {
        showNotification('Error deleting message: ' + error.message, 'error');
        if (deleteBtn) {
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
            deleteBtn.disabled = false;
        }
    });
}

function copyInviteLink() {
    const copyText = document.getElementById("inviteLink");
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    document.execCommand("copy");
    showNotification("Invite link copied to clipboard!", "success");
}

function copyRoomUrl() {
    navigator.clipboard.writeText(roomUrl).then(() => {
        showNotification('Room link copied to clipboard!', 'success');
    }).catch(err => {
        showNotification('Failed to copy room link', 'error');
    });
}

function copyVideoUrl() {
    const videoUrl = document.getElementById('video-url-input').value;
    if (videoUrl) {
        navigator.clipboard.writeText(videoUrl).then(() => {
            showNotification('Video URL copied to clipboard!', 'success');
        }).catch(err => {
            showNotification('Failed to copy video URL', 'error');
        });
    } else {
        showNotification('No video URL to copy', 'warning');
    }
}

function showKeyboardShortcuts() {
    new bootstrap.Modal(document.getElementById('keyboardShortcutsModal')).show();
}

function disableRoomFeatures(reason = 'kicked') {
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const syncBtn = document.getElementById('sync-btn');
    const loadBtn = document.getElementById('load-video');
    
    if (chatInput) chatInput.disabled = true;
    if (chatSend) chatSend.disabled = true;
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    if (loadBtn) loadBtn.disabled = true;
    
    if (reason === 'banned') showBannedOverlay();
    else showKickedOverlay();
}

function showBannedOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.95);
        color: white;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        font-family: Arial, sans-serif;
    `;
    overlay.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <i class="fas fa-ban" style="font-size: 4rem; color: #dc3545; margin-bottom: 20px;"></i>
            <h2 style="color: #dc3545; margin-bottom: 10px;">You've Been Permanently Banned</h2>
            <p style="margin-bottom: 15px; font-size: 1.2rem;">You can no longer access this room.</p>
            <p style="margin-bottom: 10px; color: #ff6b6b;">This is a permanent ban.</p>
            <p style="margin-bottom: 30px;">Redirecting to ban information page...</p>
            <div class="spinner-border text-light" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

function showKickedOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        color: white;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        font-family: Arial, sans-serif;
    `;
    overlay.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <i class="fas fa-user-times" style="font-size: 4rem; color: #ffc107; margin-bottom: 20px;"></i>
            <h2 style="color: #ffc107; margin-bottom: 10px;">You've Been Kicked</h2>
            <p style="margin-bottom: 20px; font-size: 1.2rem;">You can no longer participate in this room.</p>
            <p style="margin-bottom: 30px;">Redirecting to home page...</p>
            <div class="spinner-border text-light" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

function addBannedWord() {
    const wordInput = document.getElementById('banned-word-input');
    const word = wordInput.value.trim();
    if (!word) {
        showNotification('Please enter a word to ban', 'warning');
        return;
    }
    if (word.length < 2) {
        showNotification('Word must be at least 2 characters', 'warning');
        return;
    }
    const formData = new FormData();
    formData.append('word', word);
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));
    fetch(`/rooms/${roomId}/banned-words/add/`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            wordInput.value = '';
            showNotification(data.message, 'success');
        } else {
            showNotification('Failed to add banned word: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showNotification('Error adding banned word', 'error');
    });
}

function removeBannedWord(word) {
    if (!confirm(`Remove "${word}" from banned words?`)) return;
    const formData = new FormData();
    formData.append('word', word);
    formData.append('csrfmiddlewaretoken', getCookie('csrftoken'));
    fetch(`/rooms/${roomId}/banned-words/remove/`, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(data.message, 'success');
        } else {
            showNotification('Failed to remove banned word: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showNotification('Error removing banned word', 'error');
    });
}

function addBannedWordToUI(word) {
    const container = document.getElementById('banned-words-list');
    const emptyState = document.getElementById('no-banned-words');
    if (emptyState && emptyState.style.display !== 'none') emptyState.style.display = 'none';
    const existingWords = container.querySelectorAll('.banned-word-text');
    for (const element of existingWords) {
        if (element.textContent === word) return;
    }
    const wordElement = document.createElement('div');
    wordElement.className = 'banned-word-item';
    wordElement.innerHTML = `
        <span class="banned-word-text">${word}</span>
        <button class="btn btn-sm btn-outline-danger" 
                onclick="removeBannedWord('${word.replace(/'/g, "\\'")}')"
                title="Remove banned word">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(wordElement);
}

function removeBannedWordFromUI(word) {
    const container = document.getElementById('banned-words-list');
    const wordElements = container.querySelectorAll('.banned-word-item');
    wordElements.forEach(element => {
        const wordText = element.querySelector('.banned-word-text').textContent;
        if (wordText === word) element.remove();
    });
    if (container.children.length === 0) {
        const emptyState = document.getElementById('no-banned-words');
        if (emptyState) emptyState.style.display = 'block';
    }
}

function loadBannedWords() {
    if (!isRoomCreator) return;
    fetch(`/rooms/${roomId}/banned-words/`, {credentials: 'same-origin'})
    .then(response => response.json())
    .then(data => {
        if (data.success) displayBannedWords(data.banned_words);
    })
    .catch(error => {
        showNotification('Error loading banned words', 'error');
    });
}

function displayBannedWords(words) {
    const container = document.getElementById('banned-words-list');
    const emptyState = document.getElementById('no-banned-words');
    if (!container) return;
    if (!words || words.length === 0) {
        if (emptyState) {
            emptyState.style.display = 'block';
            container.innerHTML = '';
            container.appendChild(emptyState);
        }
    } else {
        if (emptyState) emptyState.style.display = 'none';
        container.innerHTML = '';
        words.forEach(word => {
            const wordElement = document.createElement('div');
            wordElement.className = 'banned-word-item';
            wordElement.innerHTML = `
                <span class="banned-word-text">${word}</span>
                <button class="btn btn-sm btn-outline-danger" 
                        onclick="removeBannedWord('${word.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')"
                        title="Remove banned word">
                    <i class="fas fa-times"></i>
                </button>
            `;
            container.appendChild(wordElement);
        });
    }
}

function toggleCollapsible(sectionId) {
    const section = document.getElementById(sectionId);
    const icon = document.getElementById(sectionId.replace('section', 'icon'));
    section.classList.toggle('active');
    icon.classList.toggle('rotated');
    if (section.classList.contains('active')) {
        document.querySelectorAll('.collapsible-content').forEach(content => {
            if (content.id !== sectionId && content.classList.contains('active')) {
                content.classList.remove('active');
                const otherIcon = document.getElementById(content.id.replace('section', 'icon'));
                if (otherIcon) otherIcon.classList.remove('rotated');
            }
        });
    }
}

function updateMessageCount() {
    const count = document.querySelectorAll('.message-container').length;
    const countElement = document.getElementById('message-count');
    if (countElement) countElement.textContent = count;
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
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
            if (!isTyping) sendTypingStart();
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                if (isTyping) sendTypingStop();
            }, 1000);
        });
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                if (isTyping) sendTypingStop();
                sendChatMessage();
            }
        });
        chatInput.addEventListener('blur', function() {
            if (isTyping) sendTypingStop();
        });
    }

    if (loadVideoBtn) loadVideoBtn.addEventListener('click', loadVideo);
    if (videoUrlInput) videoUrlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') loadVideo();
    });

    if (isRoomCreator) loadBannedWords();

    if (playBtn) playBtn.addEventListener('click', playVideo);
    if (pauseBtn) pauseBtn.addEventListener('click', pauseVideo);
    if (syncBtn) syncBtn.addEventListener('click', syncVideo);

    if (startScreenShare) startScreenShare.addEventListener('click', startScreenSharing);
    if (stopScreenShare) stopScreenShare.addEventListener('click', stopScreenSharing);

     document.addEventListener('click', function(e) {
        if (e.target.closest('.delete-message-btn')) {
            const messageContainer = e.target.closest('.message-container');
            if (messageContainer) {
                const messageId = messageContainer.getAttribute('data-message-id');
                if (messageId) {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteMessage(messageId);
                }
            }
        }
    });

    connectWebSocket();
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    setInterval(calculateLatency, 30000);
    calculateLatency();
    initializeParticipants();
});

window.addEventListener('beforeunload', function() {
    cleanupYouTubePlayer();
    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
        roomSocket.close(1000, 'Page navigation');
    }
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
});

function initializeParticipants() {
    const participantsHeader = document.querySelector('.collapsible-header[onclick*="participants-section"]');
    if (participantsHeader) {
        participantsHeader.addEventListener('click', function() {
            setTimeout(() => {
                const participantsSection = document.getElementById('participants-section');
                if (participantsSection && participantsSection.classList.contains('active')) {
                }
            }, 100);
        });
    }
    
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    const tooltipList = tooltipTriggerList.map(function(tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}