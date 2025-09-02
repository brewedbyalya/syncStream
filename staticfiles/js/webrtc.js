class WebRTCManager {
    constructor(roomId, userId, username) {
        this.roomId = roomId;
        this.userId = userId;
        this.username = username;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStreams = new Map();
        this.dataChannel = null;
        this.isInitiator = false;
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
        
    }

    async startScreenShare() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Screen sharing is not supported in this browser');
            }

            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: true
            });

            this.localStream.getTracks().forEach(track => {
                track.onended = () => {
                    this.stopScreenShare();
                    if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
                        roomSocket.send(JSON.stringify({
                            'type': 'screen_share',
                            'action': 'stop'
                        }));
                    }
                };
            });

            this.createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this.sendWebRTCSignal({
                type: 'offer',
                sdp: offer.sdp,
                userId: this.userId,
                username: this.username
            });

            return true;

        } catch (error) {
            this.handleError(error);
            return false;
        }
    }

    createPeerConnection() {
        try {
            this.peerConnection = new RTCPeerConnection(this.configuration);

            this.peerConnection.ontrack = (event) => {
                const remoteStream = event.streams[0];
                if (remoteStream) {
                    const trackId = event.track.id;
                    this.remoteStreams.set(trackId, remoteStream);
                    this.displayRemoteStream(remoteStream, trackId);
                }
            };

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendWebRTCSignal({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        userId: this.userId,
                        username: this.username
                    });
                }
            };

            this.peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', this.peerConnection.connectionState);
                this.updateConnectionStatus(this.peerConnection.connectionState);
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            };

            this.peerConnection.onsignalingstatechange = () => {
                console.log('Signaling state:', this.peerConnection.signalingState);
            };

            this.setupDataChannel();

        } catch (error) {
            this.handleError(error);
        }
    }

    setupDataChannel() {
        try {
            this.dataChannel = this.peerConnection.createDataChannel('syncstream-data', {
                ordered: true,
                maxPacketLifeTime: 3000
            });

            this.dataChannel.onopen = () => {
                showNotification('Screen sharing connection established', 'success');
            };

            this.dataChannel.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                } catch (error) {
                    console.error('Error parsing data channel message:', error);
                }
            };

            this.dataChannel.onclose = () => {
                console.log('Data channel closed');
            };

            this.dataChannel.onerror = (error) => {
                console.error('Data channel error:', error);
            };

        } catch (error) {
            console.error('Error setting up data channel:', error);
        }
    }

    async handleSignal(data) {
        try {
            
            switch(data.type) {
                case 'offer':
                    await this.handleOffer(data);
                    break;
                case 'answer':
                    await this.handleAnswer(data);
                    break;
                case 'ice-candidate':
                    await this.handleIceCandidate(data);
                    break;
                default:
                    console.warn('Unknown WebRTC signal type:', data.type);
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    async handleOffer(offerData) {
        try {            
            if (!this.peerConnection) {
                this.createPeerConnection();
            }

            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };

            const offer = {
                type: 'offer',
                sdp: offerData.sdp
            };

            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.sendWebRTCSignal({
                type: 'answer',
                sdp: answer.sdp,
                toUserId: offerData.userId,
                userId: this.userId,
                username: this.username
            });

        } catch (error) {
            this.handleError(error);
        }
    }

    async handleAnswer(answerData) {
        try {
            
            if (this.peerConnection) {
                const answer = {
                    type: 'answer',
                    sdp: answerData.sdp
                };
                await this.peerConnection.setRemoteDescription(answer);
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    async handleIceCandidate(candidateData) {
        try {
            if (this.peerConnection && candidateData.candidate) {
                await this.peerConnection.addIceCandidate(candidateData.candidate);
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    displayRemoteStream(stream, trackId) {
        try {
            const container = document.getElementById('screen-share-container');
            if (!container) {
                console.error('Screen share container not found');
                return;
            }

            container.querySelectorAll('video').forEach(video => video.remove());

            const videoElement = document.createElement('video');
            videoElement.srcObject = stream;
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.controls = false;
            videoElement.style.width = '100%';
            videoElement.style.height = '100%';
            videoElement.style.objectFit = 'contain';
            
            container.appendChild(videoElement);
            container.classList.remove('d-none');

            const infoDiv = document.createElement('div');
            infoDiv.className = 'screen-share-info';
            infoDiv.innerHTML = `
                <div class="alert alert-info mb-0">
                    <i class="fas fa-desktop me-2"></i>
                    ${candidateData.username || 'Someone'} is sharing their screen
                </div>
            `;
            container.appendChild(infoDiv);


        } catch (error) {
            console.error('Error displaying remote stream:', error);
        }
    }

    sendWebRTCSignal(data) {
        if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
            roomSocket.send(JSON.stringify({
                type: 'webrtc_signal',
                data: data
            }));
        } else {
            showNotification('Connection lost. Cannot share screen.', 'error');
        }
    }

    stopScreenShare() {
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                track.onended = null;
            });
            this.localStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.remoteStreams.clear();
        
        const container = document.getElementById('screen-share-container');
        if (container) {
            container.innerHTML = '';
            container.classList.add('d-none');
        }

        const stopBtn = document.getElementById('stop-screen-share');
        const startBtn = document.getElementById('start-screen-share');
        if (stopBtn) stopBtn.classList.add('d-none');
        if (startBtn) startBtn.classList.remove('d-none');

    }

    updateConnectionStatus(state) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = state.charAt(0).toUpperCase() + state.slice(1);
            
            const statusClass = {
                'connected': 'success',
                'connecting': 'warning',
                'disconnected': 'danger',
                'failed': 'danger',
                'closed': 'secondary'
            }[state] || 'secondary';
            
            statusElement.className = `badge bg-${statusClass}`;
        }
    }

    handleError(error) {
        
        let errorMessage = 'Screen sharing error: ';
        switch(error.name) {
            case 'NotAllowedError':
                errorMessage += 'Permission denied. Please allow screen sharing.';
                break;
            case 'NotFoundError':
                errorMessage += 'No screen sharing source found.';
                break;
            case 'NotReadableError':
                errorMessage += 'Could not access screen. Another application might be blocking access.';
                break;
            case 'OverconstrainedError':
                errorMessage += 'Screen sharing constraints cannot be satisfied.';
                break;
            default:
                errorMessage += error.message || 'Unknown error occurred.';
        }
        
        showNotification(errorMessage, 'error');
        this.stopScreenShare();
    }
}

let webRTCManager;

document.addEventListener('DOMContentLoaded', function() {
    if (typeof roomId !== 'undefined' && typeof userId !== 'undefined' && typeof username !== 'undefined') {
        webRTCManager = new WebRTCManager(roomId, userId, username);
    } else {
        console.error('WebRTC manager: Missing required variables (roomId, userId, username)');
    }
});

function handleWebRTCSignal(data) {
    if (typeof webRTCManager !== 'undefined' && webRTCManager) {
        webRTCManager.handleSignal(data.data);
    } else {
        console.warn('WebRTC manager not initialized, cannot handle signal');
    }
}