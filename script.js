document.addEventListener("DOMContentLoaded", () => {
    const socket = io();

    let localStream = null;
    let screenStream = null;
    let roomId = "";
    let userName = "";
    let isHost = false;

    const peers = {}; 
    const remoteStreams = {};
    const activeParticipants = {};

    let micOn = true;
    let cameraOn = true;
    let isSharingScreen = false;
    let handRaised = false;
    let isRecording = false;
    let isBlurred = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    let blurInterval = null;

    const joinScreen = document.getElementById("joinScreen");
    const meetingScreen = document.getElementById("meetingScreen");
    const nameInput = document.getElementById("nameInput");
    const roomInput = document.getElementById("roomInput");
    const joinBtn = document.getElementById("joinBtn");
    const localVideo = document.getElementById("localVideo");
    const hiddenCanvas = document.getElementById("hiddenCanvas");
    const localNameTag = document.getElementById("localNameTag");
    const localHandBadge = document.getElementById("localHandBadge");
    const videosContainer = document.getElementById("videosContainer");
    const displayRoomId = document.getElementById("displayRoomId");
    const hostBadge = document.getElementById("hostBadge");
    const hostControlsBar = document.getElementById("hostControlsBar");
    const hostMuteAllBtn = document.getElementById("hostMuteAllBtn");

    const muteBtn = document.getElementById("muteBtn");
    const camBtn = document.getElementById("camBtn");
    const shareScreenBtn = document.getElementById("shareScreenBtn");
    const raiseHandBtn = document.getElementById("raiseHandBtn");
    const leaveBtn = document.getElementById("leaveBtn");
    const recordBtn = document.getElementById("recordBtn");
    const blurBtn = document.getElementById("blurBtn");

    const chatInput = document.getElementById("chatInput");
    const fileInput = document.getElementById("fileInput");
    const sendChatBtn = document.getElementById("sendChatBtn");
    const chatMessages = document.getElementById("chatMessages");
    const participantsList = document.getElementById("participantsList");
    const participantCount = document.getElementById("participantCount");

    const rtcConfig = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ]
    };

    async function startLocalMedia() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideo) localVideo.srcObject = localStream;
        } catch (err) {
            console.error("Camera/Mic permission error:", err);
            alert("Could not access camera or microphone.");
        }
    }

    startLocalMedia();

    if (joinBtn) {
        joinBtn.addEventListener("click", (e) => {
            e.preventDefault();
            userName = nameInput.value.trim();
            roomId = roomInput.value.trim();

            if (!userName || !roomId) {
                alert("Please fill in both your name and room code.");
                return;
            }

            joinScreen.style.display = "none";
            meetingScreen.style.display = "flex";
            displayRoomId.textContent = `Room: ${roomId}`;

            localNameTag.textContent = `${userName} (You)`;
            activeParticipants[socket.id] = { name: userName, isHost: false };
            updateParticipantsUI();

            socket.emit("join-room", { roomId, userName });
        });
    }

    socket.on("room-assigned", ({ users, hostId }) => {
        if (socket.id === hostId) {
            isHost = true;
            hostBadge.style.display = "block";
            hostControlsBar.style.display = "flex";
        }
        users.forEach(({ userId, userName, socketId }) => {
            const targetId = userId || socketId;
            if(targetId !== socket.id) {
                activeParticipants[targetId] = { name: userName, isHost: targetId === hostId };
                createPeerConnection(targetId, true);
            }
        });
        updateParticipantsUI();
    });

    socket.on("user-joined", ({ userId, userName, hostId }) => {
        activeParticipants[userId] = { name: userName, isHost: userId === hostId };
        updateParticipantsUI();
    });

    socket.on("offer", async ({ senderId, offer }) => {
        const peer = createPeerConnection(senderId, false);
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("answer", { targetId: senderId, answer });
    });

    socket.on("answer", async ({ senderId, answer }) => {
        if (peers[senderId]) {
            await peers[senderId].setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on("ice-candidate", async ({ senderId, candidate }) => {
        if (peers[senderId] && candidate) {
            try {
                await peers[senderId].addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error("ICE candidate error:", e);
            }
        }
    });

    socket.on("user-disconnected", (userId) => {
        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }
        delete activeParticipants[userId];
        updateParticipantsUI();

        const box = document.getElementById(`box-${userId}`);
        if (box) box.remove();
    });

    socket.on("kicked", () => {
        alert("You have been removed from the meeting by the host.");
        window.location.reload();
    });

    socket.on("force-mute", () => {
        const audioTrack = localStream?.getAudioTracks()[0];
        if (audioTrack && audioTrack.enabled) {
            audioTrack.enabled = false;
            micOn = false;
            document.getElementById("micIcon").textContent = "mic_off";
            document.getElementById("micLabel").textContent = "Unmute";
            muteBtn.style.background = "#ea4335";
            alert("The host has muted your microphone.");
        }
    });

    socket.on("hand-raised", ({ userId, userName, handRaised }) => {
        const badge = document.getElementById(`hand-${userId}`);
        if (badge) badge.style.display = handRaised ? "block" : "none";
        appendMessage("System", `${userName} has ${handRaised ? "raised their hand ✋" : "lowered their hand"}`);
    });

    socket.on("chat-message", ({ userName, message }) => {
        appendMessage(userName, message);
    });

    socket.on("file-shared", ({ userName, fileName, fileData, fileType }) => {
        appendFileMessage(userName, fileName, fileData, fileType);
    });

    function updateParticipantsUI() {
        if (!participantsList) return;
        participantsList.innerHTML = "";
        const keys = Object.keys(activeParticipants);
        participantCount.textContent = keys.length;

        keys.forEach(id => {
            const data = activeParticipants[id];
            const li = document.createElement("li");
            li.className = "participant-row";
            
            let label = id === socket.id ? `${data.name} (You)` : data.name;
            if (data.isHost) label += " 👑";
            
            const textSpan = document.createElement("span");
            textSpan.textContent = label;
            li.appendChild(textSpan);

            if (isHost && id !== socket.id) {
                const kickBtn = document.createElement("button");
                kickBtn.className = "kick-btn";
                kickBtn.textContent = "Remove";
                kickBtn.onclick = () => socket.emit("kick-user", { targetId: id, roomId });
                li.appendChild(kickBtn);
            }

            participantsList.appendChild(li);
        });
    }

    if (hostMuteAllBtn) {
        hostMuteAllBtn.addEventListener("click", () => {
            socket.emit("mute-all", { roomId });
        });
    }

    function createPeerConnection(userId, isInitiator) {
        const peer = new RTCPeerConnection(rtcConfig);
        peers[userId] = peer;

        if (localStream) {
            localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
        }

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("ice-candidate", { targetId: userId, candidate: event.candidate });
            }
        };

        peer.ontrack = (event) => {
            if (!remoteStreams[userId]) {
                remoteStreams[userId] = event.streams[0];
                
                const videoBox = document.createElement("div");
                videoBox.className = "video-box";
                videoBox.id = `box-${userId}`;

                const videoElement = document.createElement("video");
                videoElement.srcObject = remoteStreams[userId];
                videoElement.autoplay = true;
                videoElement.playsInline = true;

                const nameTag = document.createElement("div");
                nameTag.className = "name-tag";
                nameTag.textContent = activeParticipants[userId]?.name || "Participant";

                const handBadge = document.createElement("div");
                handBadge.className = "hand-badge";
                handBadge.id = `hand-${userId}`;
                handBadge.textContent = "✋";

                videoBox.appendChild(videoElement);
                videoBox.appendChild(nameTag);
                videoBox.appendChild(handBadge);

                if (videosContainer) videosContainer.appendChild(videoBox);
            }
        };

        if (isInitiator) {
            peer.createOffer().then(offer => {
                peer.setLocalDescription(offer);
                socket.emit("offer", { targetId: userId, offer });
            });
        }

        return peer;
    }

    // Controls
    if (muteBtn) {
        muteBtn.addEventListener("click", () => {
            const audioTrack = localStream?.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                micOn = audioTrack.enabled;
                document.getElementById("micIcon").textContent = micOn ? "mic" : "mic_off";
                document.getElementById("micLabel").textContent = micOn ? "Mute" : "Unmute";
                muteBtn.style.background = micOn ? "#3c4043" : "#ea4335";
            }
        });
    }

    if (camBtn) {
        camBtn.addEventListener("click", () => {
            const videoTrack = localStream?.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                cameraOn = videoTrack.enabled;
                document.getElementById("camIcon").textContent = cameraOn ? "videocam" : "videocam_off";
                document.getElementById("camLabel").textContent = cameraOn ? "Cam Off" : "Cam On";
                camBtn.style.background = cameraOn ? "#3c4043" : "#ea4335";
            }
        });
    }

    // Virtual Blur Feature using Canvas
    if (blurBtn) {
        blurBtn.addEventListener("click", () => {
            isBlurred = !isBlurred;
            document.getElementById("blurLabel").textContent = isBlurred ? "Blur On" : "Blur Off";
            blurBtn.style.background = isBlurred ? "#1a73e8" : "#3c4043";

            if (isBlurred) {
                hiddenCanvas.width = 640;
                hiddenCanvas.height = 480;
                const ctx = hiddenCanvas.getContext("2d");
                
                blurInterval = setInterval(() => {
                    if (localVideo && localVideo.readyState >= 2) {
                        ctx.filter = 'blur(10px)';
                        ctx.drawImage(localVideo, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
                    }
                }, 100);

                const blurredStream = hiddenCanvas.captureStream(30);
                const videoTrack = blurredStream.getVideoTracks()[0];
                
                for (let userId in peers) {
                    const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(videoTrack);
                }
            } else {
                clearInterval(blurInterval);
                const videoTrack = localStream?.getVideoTracks()[0];
                for (let userId in peers) {
                    const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender && videoTrack) sender.replaceTrack(videoTrack);
                }
            }
        });
    }

    // Recording Feature
    if (recordBtn) {
        recordBtn.addEventListener("click", async () => {
            if (!isRecording) {
                try {
                    const mixStream = new MediaStream([
                        ...localStream.getVideoTracks(),
                        ...(localStream.getAudioTracks())
                    ]);
                    
                    mediaRecorder = new MediaRecorder(mixStream, { mimeType: 'video/webm' });
                    recordedChunks = [];

                    mediaRecorder.ondataavailable = (e) => {
                        if (e.data.size > 0) recordedChunks.push(e.data);
                    };

                    mediaRecorder.onstop = () => {
                        const blob = new Blob(recordedChunks, { type: 'video/webm' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = "meeting-recording-" + Date.now() + ".webm";
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                    };

                    mediaRecorder.start();
                    isRecording = true;
                    document.getElementById("recordLabel").textContent = "Stop Rec";
                    recordBtn.style.background = "#ea4335";
                } catch (err) {
                    console.error("Recording failed:", err);
                    alert("Could not start recording.");
                }
            } else {
                mediaRecorder.stop();
                isRecording = false;
                document.getElementById("recordLabel").textContent = "Record";
                recordBtn.style.background = "#3c4043";
            }
        });
    }

    if (shareScreenBtn) {
        shareScreenBtn.addEventListener("click", async () => {
            try {
                if (!isSharingScreen) {
                    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                    const screenTrack = screenStream.getVideoTracks()[0];

                    for (let userId in peers) {
                        const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(screenTrack);
                    }

                    if (localVideo) localVideo.srcObject = screenStream;
                    isSharingScreen = true;
                    document.getElementById("screenLabel").textContent = "Stop";
                    shareScreenBtn.style.background = "#1a73e8";

                    screenTrack.onended = () => stopScreenSharing();
                } else {
                    stopScreenSharing();
                }
            } catch (err) {
                console.error("Screen share error:", err);
            }
        });
    }

    function stopScreenSharing() {
        if (screenStream) screenStream.getTracks().forEach(track => track.stop());
        const videoTrack = localStream?.getVideoTracks()[0];
        for (let userId in peers) {
            const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && videoTrack) sender.replaceTrack(videoTrack);
        }
        if (localVideo) localVideo.srcObject = localStream;
        isSharingScreen = false;
        document.getElementById("screenLabel").textContent = "Present";
        shareScreenBtn.style.background = "#3c4043";
    }

    if (raiseHandBtn) {
        raiseHandBtn.addEventListener("click", () => {
            handRaised = !handRaised;
            raiseHandBtn.style.background = handRaised ? "#fbbc04" : "#3c4043";
            localHandBadge.style.display = handRaised ? "block" : "none";
            socket.emit("raise-hand", { roomId, userName, handRaised });
        });
    }

    if (sendChatBtn && chatInput) {
        sendChatBtn.addEventListener("click", () => {
            const message = chatInput.value.trim();
            if (message) {
                socket.emit("chat-message", { roomId, userName, message });
                appendMessage("You", message);
                chatInput.value = "";
            }
        });
        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") sendChatBtn.click();
        });
    }

    // File Sharing Handler
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (event) {
                const fileData = event.target.result;
                socket.emit("file-shared", { roomId, userName, fileName: file.name, fileData, fileType: file.type });
                appendFileMessage("You", file.name, fileData, file.type);
            };
            reader.readAsDataURL(file);
        });
    }

    function appendMessage(sender, message) {
        if (chatMessages) {
            const msgDiv = document.createElement("div");
            msgDiv.style.background = "#3c4043";
            msgDiv.style.padding = "8px 10px";
            msgDiv.style.borderRadius = "6px";
            msgDiv.innerHTML = `<strong>${sender}</strong><br>${message}`;
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    function appendFileMessage(sender, fileName, fileData, fileType) {
        if (chatMessages) {
            const msgDiv = document.createElement("div");
            msgDiv.style.background = "#3c4043";
            msgDiv.style.padding = "8px 10px";
            msgDiv.style.borderRadius = "6px";
            msgDiv.innerHTML = `<strong>${sender} shared a file:</strong><br><a href="${fileData}" download="${fileName}" style="color: #8ab4f8; text-decoration: underline;">📄 ${fileName}</a>`;
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    if (leaveBtn) {
        leaveBtn.addEventListener("click", () => {
            socket.disconnect();
            if (localStream) localStream.getTracks().forEach(track => track.stop());
            if (screenStream) screenStream.getTracks().forEach(track => track.stop());
            window.location.reload();
        });
    }
});