class WebRTCManager {
    constructor(roomId, userId) {
        this.roomId = roomId;
        this.userId = userId;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStreams = new Map();
    }

    async startScreenShare() {
        try {
            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            this.createPeerConnection();

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            roomSocket.send(JSON.stringify({
                type: 'webrtc_offer',
                offer: offer,
                userId: this.userId
            }));

            return true;
        } catch (error) {
            console.error('Error starting screen share:', error);
            return false;
        }
    }

    createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        this.peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            const userId = event.transceiver.mid; 
            this.remoteStreams.set(userId, remoteStream);
            this.displayRemoteStream(remoteStream, userId);
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                roomSocket.send(JSON.stringify({
                    type: 'webrtc_ice_candidate',
                    candidate: event.candidate,
                    userId: this.userId
                }));
            }
        };
    }

    displayRemoteStream(stream, userId) {
        const videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.controls = false;
        
        const container = document.getElementById('screen-share-container');
        container.innerHTML = '';
        container.appendChild(videoElement);
    }

    async handleOffer(offer, fromUserId) {
        if (!this.peerConnection) {
            this.createPeerConnection();
        }

        await this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        roomSocket.send(JSON.stringify({
            type: 'webrtc_answer',
            answer: answer,
            toUserId: fromUserId,
            userId: this.userId
        }));
    }

    async handleAnswer(answer, fromUserId) {
        if (this.peerConnection) {
            await this.peerConnection.setRemoteDescription(answer);
        }
    }

    async handleIceCandidate(candidate, fromUserId) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
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
    }
}

const webRTCManager = new WebRTCManager(roomId, userId);