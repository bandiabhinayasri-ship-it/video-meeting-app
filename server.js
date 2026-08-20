const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

io.on("connection", (socket) => {
    socket.on("join-room", ({ roomId, userName }) => {
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                hostId: socket.id,
                users: []
            };
        }

        const roomData = rooms[roomId];
        socket.emit("room-assigned", { users: roomData.users, hostId: roomData.hostId });

        roomData.users.push({ userId: socket.id, userName });
        socket.to(roomId).emit("user-joined", { userId: socket.id, userName, hostId: roomData.hostId });

        socket.on("offer", ({ targetId, offer }) => {
            io.to(targetId).emit("offer", { senderId: socket.id, offer });
        });

        socket.on("answer", ({ targetId, answer }) => {
            io.to(targetId).emit("answer", { senderId: socket.id, answer });
        });

        socket.on("ice-candidate", ({ targetId, candidate }) => {
            io.to(targetId).emit("ice-candidate", { senderId: socket.id, candidate });
        });

        socket.on("raise-hand", ({ roomId, userName, handRaised }) => {
            socket.to(roomId).emit("hand-raised", { userId: socket.id, userName, handRaised });
        });

        socket.on("chat-message", ({ roomId, userName, message }) => {
            socket.to(roomId).emit("chat-message", { userName, message });
        });

        socket.on("file-shared", ({ roomId, userName, fileName, fileData, fileType }) => {
            socket.to(roomId).emit("file-shared", { userName, fileName, fileData, fileType });
        });

        socket.on("mute-all", ({ roomId }) => {
            if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
                socket.to(roomId).emit("force-mute");
            }
        });

        socket.on("kick-user", ({ targetId, roomId }) => {
            if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
                io.to(targetId).emit("kicked");
            }
        });

        socket.on("disconnect", () => {
            if (rooms[roomId]) {
                rooms[roomId].users = rooms[roomId].users.filter(user => user.userId !== socket.id);
                
                // Assign new host if host leaves
                if (rooms[roomId].hostId === socket.id && rooms[roomId].users.length > 0) {
                    rooms[roomId].hostId = rooms[roomId].users[0].userId;
                }

                if (rooms[roomId].users.length === 0) {
                    delete rooms[roomId];
                }
            }
            socket.to(roomId).emit("user-disconnected", socket.id);
        });
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running smoothly on http://localhost:${PORT}`);
});