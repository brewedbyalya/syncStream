class WebRTCManager {
    constructor(roomId, userId) {
        this.roomId = roomId;
        this.userId = userId;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStreams = new Map();
        this.dataChannel = null;
        this.isInitiator = false;
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    async startScreenShare() {
        try {
            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: true
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
                userId: this.userId
            });

            return true;
        } catch (error) {
            console.error('Error starting screen share:', error);
            this.handleError(error);
            return false;
        }
    }

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.configuration);

        this.peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            const userId = event.transceiver.mid;
            this.remoteStreams.set(userId, remoteStream);
            this.displayRemoteStream(remoteStream, userId);
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendWebRTCSignal({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    userId: this.userId
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
        };

        this.dataChannel = this.peerConnection.createDataChannel('chat');
        this.setupDataChannel();
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
        };

        this.dataChannel.onmessage = (event) => {
            console.log('Data channel message:', event.data);
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
        };
    }

    async handleOffer(offer, fromUserId) {
        if (!this.peerConnection) {
            this.createPeerConnection();
        }

        await this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        this.sendWebRTCSignal({
            type: 'answer',
            sdp: answer.sdp,
            toUserId: fromUserId,
            userId: this.userId
        });
    }

    async handleAnswer(answer) {
        if (this.peerConnection) {
            await this.peerConnection.setRemoteDescription(answer);
        }
    }

    async handleIceCandidate(candidate) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
        }
    }

    displayRemoteStream(stream, userId) {
        const videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.controls = false;
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        
        const container = document.getElementById('screen-share-container');
        container.innerHTML = '';
        container.appendChild(videoElement);
    }

    sendWebRTCSignal(data) {
        if (roomSocket && roomSocket.readyState === WebSocket.OPEN) {
            roomSocket.send(JSON.stringify({
                type: 'webrtc_signal',
                data: data
            }));
        }
    }

    stopScreenShare() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.remoteStreams.clear();
        
        const container = document.getElementById('screen-share-container');
        container.innerHTML = '';
    }

    handleError(error) {
        console.error('WebRTC error:', error);
        showNotification('Screen sharing failed: ' + error.message, 'error');
    }
}

const webRTCManager = new WebRTCManager(roomId, userId);

function handleWebRTCSignal(data) {
    switch(data.type) {
        case 'offer':
            webRTCManager.handleOffer(data.sdp, data.userId);
            break;
        case 'answer':
            webRTCManager.handleAnswer(data.sdp);
            break;
        case 'ice-candidate':
            webRTCManager.handleIceCandidate(data.candidate);
            break;
    }
}