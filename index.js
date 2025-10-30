const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors =require('cors');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors()); // Note: app.use(cors()) is good, but socket.io needs its *own* config.
const server = http.createServer(app);

// --- THIS IS THE FIX ---

// 1. PASTE YOUR NETLIFY URL HERE (e.g., "https://jolly-biscuit-123.netlify.app")
const CLIENT_URL = "https://whiteboard-game.netlify.app/"; 

const io = new Server(server, {
  cors: {
    // 2. We now allow *both* localhost and your live Netlify site
    origin: ["http://localhost:3000", CLIENT_URL],
    methods: ["GET", "POST"]
  }
});

// --- END OF FIX ---


// --- SERVER-SIDE STATE ---
const rooms = {};
// (The rest of your server file is 100% correct, no changes needed)
// ... (rest of the file) ...

// Helper function to get the current active user in a room
const getActiveUser = (roomName) => {
  const room = rooms[roomName];
  if (!room || room.users.length === 0) {
    return null;
  }
  return room.users[room.currentTurnIndex];
};

// Helper function to broadcast the current turn to everyone
const broadcastTurnUpdate = (roomName) => {
  const activeSocketId = getActiveUser(roomName);
  console.log(`[SERVER] Broadcasting turn update for ${roomName}. Active user: ${activeSocketId}`);
  io.in(roomName).emit('turn-update', activeSocketId);
};

// Helper function to pass the turn
const passTurn = (roomName) => {
  const room = rooms[roomName];
  if (!room || room.users.length === 0) {
    return;
  }
  // Move to the next user, or wrap around to the beginning
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.users.length;
  broadcastTurnUpdate(roomName);
};

io.on('connection', (socket) => {
  console.log(`[SERVER] User connected: ${socket.id}`);

  socket.on('join-room', (roomName) => {
    socket.join(roomName);
    // Store the room name on the socket for later (like disconnect)
    socket.roomName = roomName;

    // --- Add user to room state ---
    if (!rooms[roomName]) {
      // Create room if it doesn't exist
      rooms[roomName] = {
        users: [],
        currentTurnIndex: 0
      };
    }
    rooms[roomName].users.push(socket.id);
    console.log(`[SERVER] User ${socket.id} joined room ${roomName}. Total users: ${rooms[roomName].users.length}`);
    
    // Broadcast the new turn state to everyone
    broadcastTurnUpdate(roomName);
    // --- END ---
  });

  // --- Listen for a user passing the turn ---
  socket.on('pass-turn', (data) => {
    const roomName = data.room;
    console.log(`[SERVER] User ${socket.id} passed turn in room ${roomName}`);
    passTurn(roomName);
  });
  // --- END ---

  // --- MODIFIED: Add turn-check security ---
  const handleDrawEvent = (handler) => (data) => {
    const roomName = data.room;
    const activeSocketId = getActiveUser(roomName);

    // SECURITY CHECK: Is the person emitting this event the active user?
    if (socket.id === activeSocketId) {
      // Yes, it's their turn. Broadcast the event.
      handler(data);
    } else {
      // No, it's not their turn. Ignore the event.
      console.log(`[SERVER] Blocked draw event from ${socket.id}. Not their turn.`);
    }
  };

  socket.on('start-drawing', handleDrawEvent((data) => {
    socket.to(data.room).emit('server-start-drawing', data);
  }));

  socket.on('drawing', handleDrawEvent((data) => {
    socket.to(data.room).emit('server-drawing', data);
  }));

  socket.on('finish-drawing', handleDrawEvent((data) => {
    socket.to(data.room).emit('server-finish-drawing');
  }));

  socket.on('clear-canvas', handleDrawEvent((data) => {
    io.in(data.room).emit('server-clear-canvas');
  }));
  // --- END MODIFIED ---

  socket.on('disconnect', () => {
    console.log(`[SERVER] User disconnected: ${socket.id}`);
    const roomName = socket.roomName;

    if (rooms[roomName]) {
      // --- Remove user from room state ---
      const wasTheirTurn = getActiveUser(roomName) === socket.id;
      
      // Remove user from the array
      rooms[roomName].users = rooms[roomName].users.filter(id => id !== socket.id);
      
      if (rooms[roomName].users.length === 0) {
        // If room is empty, delete it
        delete rooms[roomName];
        return;
      }

      // If the disconnecting user's turn was active:
      if (wasTheirTurn) {
        // Reset index to 0 (which will be the "next" user) and pass turn
        rooms[roomName].currentTurnIndex = 0;
        broadcastTurnUpdate(roomName);
      } else {
        // If it wasn't their turn, just make sure the index is still valid
        const activeUser = getActiveUser(roomName);
        // Find the new index of the currently active user
        const newIndex = rooms[roomName].users.indexOf(activeUser);
        if (newIndex !== -1) {
          rooms[roomName].currentTurnIndex = newIndex;
        } else {
          // Failsafe: if active user is somehow gone, reset
          rooms[roomName].currentTurnIndex = 0;
        }
        broadcastTurnUpdate(roomName); // Still broadcast, user list changed
      }
      // --- END ---
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});

