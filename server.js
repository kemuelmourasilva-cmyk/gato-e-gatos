const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {}; // { roomCode: { players: {}, gameState: {} } }

io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  // Criar uma nova sala com código
  socket.on('createRoom', (roomCode) => {
    if (rooms[roomCode]) {
      socket.emit('errorMsg', 'Esta sala já existe. Escolha outro código.');
      return;
    }

    rooms[roomCode] = {
      players: {},
      gameState: {
        boardSize: 5,
        positions: {},
        turn: null
      }
    };

    joinRoom(socket, roomCode);
  });

  // Entrar em uma sala existente
  socket.on('joinRoom', (roomCode) => {
    if (!rooms[roomCode]) {
      socket.emit('errorMsg', 'Sala não encontrada. Verifique o código.');
      return;
    }

    if (Object.keys(rooms[roomCode].players).length >= 2) {
      socket.emit('errorMsg', 'A sala já está cheia.');
      return;
    }

    joinRoom(socket, roomCode);
  });

  function joinRoom(socket, roomCode) {
    socket.roomCode = roomCode;
    socket.join(roomCode);

    const room = rooms[roomCode];
    const playerNumber = Object.keys(room.players).length === 0 ? 1 : 2;

    room.players[socket.id] = { id: socket.id, number: playerNumber, ready: false };
    
    socket.emit('init', { playerNumber, boardSize: room.gameState.boardSize, roomCode });

    if (Object.keys(room.players).length === 2) {
      io.to(roomCode).emit('status', 'Ambos conectados! Posicionem seus gatos (Vivo e Morto).');
    } else {
      socket.emit('status', 'Aguardando o segundo jogador entrar na sala...');
    }
  }

  // Posicionamento inicial
  socket.on('setInitialPositions', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    room.gameState.positions[socket.id] = {
      live: data.live,
      dead: data.dead
    };
    room.players[socket.id].ready = true;

    const allReady = Object.values(room.players).every(p => p.ready);
    if (allReady && Object.keys(room.players).length === 2) {
      const p1Socket = Object.keys(room.players)[0];
      room.gameState.turn = p1Socket;
      io.to(socket.roomCode).emit('gameStart', { activeTurn: room.gameState.turn });
    } else {
      socket.emit('status', 'Posições salvas! Aguardando o oponente...');
    }
  });

  // Movimento Espelho
  socket.on('makeMove', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    room.gameState.positions[socket.id].live = data.newLive;
    room.gameState.positions[socket.id].dead = data.newDead;

    const playerIds = Object.keys(room.players);
    room.gameState.turn = playerIds.find(id => id !== socket.id);

    io.to(socket.roomCode).emit('updateBoard', {
      nextTurn: room.gameState.turn
    });
  });

  // Ação de Medição / Observação clicando no Tabuleiro do Oponente
  socket.on('observe', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    const opponentId = Object.keys(room.players).find(id => id !== socket.id);
    const opponentPos = room.gameState.positions[opponentId];

    const hitLive = (data.targetLive.x === opponentPos.live.x && data.targetLive.y === opponentPos.live.y);
    const hitDead = (data.targetDead.x === opponentPos.dead.x && data.targetDead.y === opponentPos.dead.y);

    if (hitLive && hitDead) {
      io.to(socket.roomCode).emit('gameOver', { winner: room.players[socket.id].number });
    } else {
      room.gameState.turn = opponentId;
      socket.emit('observeResult', { hitLive, hitDead });
      io.to(socket.roomCode).emit('turnChanged', { nextTurn: room.gameState.turn });
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      delete rooms[roomCode].players[socket.id];
      delete rooms[roomCode].gameState.positions[socket.id];
      io.to(roomCode).emit('playerLeft', 'O oponente se desconectou da sala.');
      if (Object.keys(rooms[roomCode].players).length === 0) {
        delete rooms[roomCode];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
