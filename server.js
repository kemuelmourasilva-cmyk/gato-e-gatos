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

let rooms = {};

const quantumCards = [
  { id: 1, name: "Tunneling (Efeito Túnel)", desc: "Atravesse uma barreira! Mova seu gato por cima de uma casa sem quebrar o espelho." },
  { id: 2, name: "Quantum Zeno (Efeito Zeno)", desc: "Imobilize o oponente! O oponente perde a chance de observar neste turno." },
  { id: 3, name: "Entanglement Fluctuation", desc: "Desacoplamento! Inverta temporariamente o eixo Y do movimento espelho." },
  { id: 4, name: "Superposition (Superposição)", desc: "O gato esteve em dois lugares! Refaça o movimento de um dos gatos livremente." },
  { id: 5, name: "Heisenberg Uncertainty", desc: "Princípio da Incerteza! Force o oponente a revelar dicas de posição." },
  { id: 6, name: "Decoherence (Decoerência)", desc: "Colapso térmico! O oponente perde uma tentativa de medição no próximo turno." }
];

io.on('connection', (socket) => {
  console.log(`Usuário conectado: ${socket.id}`);

  socket.on('createRoom', (roomCode) => {
    if (rooms[roomCode]) {
      socket.emit('errorMsg', 'Esta sala já existe.');
      return;
    }
    rooms[roomCode] = {
      players: {},
      gameState: { boardSize: 5, positions: {}, turn: null, activeCard: null }
    };
    joinRoom(socket, roomCode);
  });

  socket.on('joinRoom', (roomCode) => {
    if (!rooms[roomCode]) {
      socket.emit('errorMsg', 'Sala não encontrada.');
      return;
    }
    if (Object.keys(rooms[roomCode].players).length >= 2) {
      socket.emit('errorMsg', 'Sala cheia.');
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
      io.to(roomCode).emit('status', 'Ambos conectados! Posicionem seus gatos antes de iniciar as medições.');
    } else {
      socket.emit('status', 'Aguardando o segundo jogador...');
    }
  }

  // Trava o jogo até ambos posicionarem
  socket.on('setInitialPositions', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.gameState.positions[socket.id] = { live: data.live, dead: data.dead };
    room.players[socket.id].ready = true;

    const allReady = Object.values(room.players).every(p => p.ready);
    if (allReady && Object.keys(room.players).length === 2) {
      const p1Socket = Object.keys(room.players)[0];
      room.gameState.turn = p1Socket;
      io.to(socket.roomCode).emit('gameStart', { activeTurn: room.gameState.turn });
    } else {
      socket.emit('status', 'Posições salvas! Aguardando o oponente terminar de posicionar...');
    }
  });

  socket.on('rollQuantumDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    const diceRoll = Math.floor(Math.random() * 6) + 1;
    const drawnCard = quantumCards[diceRoll - 1];
    room.gameState.activeCard = drawnCard;

    socket.emit('diceResult', { diceRoll, card: drawnCard });
    io.to(socket.roomCode).emit('status', `Jogador ${room.players[socket.id].number} rolou o dado quântico (🎲 ${diceRoll}) -> Carta: [${drawnCard.name}]`);
  });

  socket.on('makeMove', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    room.gameState.positions[socket.id].live = data.newLive;
    room.gameState.positions[socket.id].dead = data.newDead;

    const playerIds = Object.keys(room.players);
    room.gameState.turn = playerIds.find(id => id !== socket.id);
    room.gameState.activeCard = null;

    io.to(socket.roomCode).emit('updateBoard', { nextTurn: room.gameState.turn });
  });

  socket.on('observe', (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const opponentId = Object.keys(room.players).find(id => id !== socket.id);
    const opponentPos = room.gameState.positions[opponentId];

    const hitLive = (data.targetLive.x === opponentPos.live.x && data.targetLive.y === opponentPos.live.y);
    const hitDead = (data.targetDead.x === opponentPos.dead.x && data.targetDead.y === opponentPos.dead.y);

    if (hitLive && hitDead) {
      io.to(room.roomCode || socket.roomCode).emit('gameOver', { winner: room.players[socket.id].number });
    } else {
      socket.emit('observeResult', { hitLive, hitDead });
      room.gameState.turn = opponentId;
      io.to(socket.roomCode).emit('turnChanged', { nextTurn: room.gameState.turn });
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      delete rooms[roomCode].players[socket.id];
      delete rooms[roomCode].gameState.positions[socket.id];
      io.to(roomCode).emit('playerLeft', 'O oponente desconectou.');
      if (Object.keys(rooms[roomCode].players).length === 0) delete rooms[roomCode];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
