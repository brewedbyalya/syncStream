const roomSocket = new WebSocket(
    'ws://' + window.location.host + '/ws/room/' + roomId + '/'
);

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const videoUrl = document.getElementById('video-url');
const loadVideo = document.getElementById('load-video');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const syncBtn = document.getElementById('sync-btn');
const startScreenShare = document.getElementById('start-screen-share');
const stopScreenShare = document.getElementById('stop-screen-share');
const screenShareContainer = document.getElementById('screen-share-container');
const onlineCount = document.getElementById('online-count');
const chatIndicator = document.getElementById('chat-indicator');

let player;
let isPlaying = false;
let currentTime = 0;
let screenStream = null;
let peerConnection = null;

roomSocket.onmessage = function(e) {
    const data = JSON.parse(e.data);
    
    switch(data.type) {
        case 'chat_message':
            appendMessage(data.username, data.message);
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
    }
};

roomSocket.onclose = function(e) {
    console.error('Room socket closed unexpectedly');
    chatIndicator.className = 'badge bg-danger';
    chatIndicator.textContent = 'Disconnected';
};

function appendMessage(username, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('mb-2');
    messageElement.innerHTML = `<strong>${username}:</strong> ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatSend.onclick = function() {
    const message = chatInput.value;
    if (message) {
        roomSocket.send(JSON.stringify({
            'type': 'chat_message',
            'message': message
        }));
        chatInput.value = '';
    }
};

chatInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        chatSend.click();
    }
});

loadVideo.onclick = function() {
    const url = videoUrl.value;
    if (url) {
        roomSocket.send(JSON.stringify({
            'type': 'video_control',
            'action': 'load',
            'url': url
        }));
        loadVideoToPlayer(url);
    }
};

function loadVideoToPlayer(url) {
    document.getElementById('player-placeholder').innerHTML = `
        <i class="fas fa-play-circle fa-3x mb-2"></i>
        <p>Playing: ${url}</p>
    `;
}

playBtn.onclick = function() {
    roomSocket.send(JSON.stringify({
        'type': 'video_control',
        'action': 'play',
        'timestamp': currentTime
    }));
    isPlaying = true;
};

pauseBtn.onclick = function() {
    roomSocket.send(JSON.stringify({
        'type': 'video_control',
        'action': 'pause',
        'timestamp': currentTime
    }));
    isPlaying = false;
};

syncBtn.onclick = function() {
    roomSocket.send(JSON.stringify({
        'type': 'video_control',
        'action': 'sync',
        'timestamp': currentTime
    }));
};

function handleVideoControl(data) {
    if (data.user_id != userId) { 
        switch(data.action) {
            case 'play':
                isPlaying = true;
                break;
            case 'pause':
                isPlaying = false;
                break;
            case 'load':
                videoUrl.value = data.url;
                loadVideoToPlayer(data.url);
                break;
            case 'sync':
                currentTime = data.timestamp;
                break;
        }
    }
}

startScreenShare.onclick = async function() {
    try {
        roomSocket.send(JSON.stringify({
            'type': 'screen_share',
            'action': 'start'
        }));
        
        startScreenShare.classList.add('d-none');
        stopScreenShare.classList.remove('d-none');
        screenShareContainer.classList.remove('d-none');
        
        screenShareContainer.innerHTML = '<p class="text-white">Screen sharing active</p>';
    } catch (error) {
        console.error('Error starting screen share:', error);
    }
};

stopScreenShare.onclick = function() {
    roomSocket.send(JSON.stringify({
        'type': 'screen_share',
        'action': 'stop'
    }));
    
    stopScreenShare.classList.add('d-none');
    startScreenShare.classList.remove('d-none');
    screenShareContainer.classList.add('d-none');
};

function handleScreenShareStarted(data) {
    if (data.user_id != userId) {
        screenShareContainer.classList.remove('d-none');
        screenShareContainer.innerHTML = `
            <p class="text-white">${data.username} is sharing their screen</p>
        `;
    }
}

function handleScreenShareEnded(data) {
    if (data.user_id != userId) {
        screenShareContainer.classList.add('d-none');
    }
}

function userJoined(username) {
    const count = parseInt(onlineCount.textContent) + 1;
    onlineCount.textContent = count + ' online';
    
    appendMessage('System', `${username} joined the room`);
}

function userLeft(username) {
    const count = parseInt(onlineCount.textContent) - 1;
    onlineCount.textContent = count + ' online';
    
    appendMessage('System', `${username} left the room`);
}

document.addEventListener('DOMContentLoaded', function() {
});