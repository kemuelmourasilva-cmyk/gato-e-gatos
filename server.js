const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

const quantumCards = [
  { id: 1, name: "Tunneling (Efeito Túnel)", desc: "Atravesse uma barreira! Mova seu gato por cima de uma casa sem quebrar o espelho." },
  { id: 2, name: "Quantum Zeno (Efeito Zeno)", desc: "Imobilize o oponente! O oponente perde a chance de observar neste turno." },
  { id: 3, name: "Entanglement Fluctuation", desc: "Desacoplamento! Inverta temporariamente o eixo Y do movimento espelho." },
  { id: 4, name: "Superposition (Superposição)", desc: "O gato esteve em dois lugares! Refaça o movimento de um dos gatos livremente." },
  { id: 5, name: "Radar Quântico (Varredura)", desc: "Varredura de Campo! O sistema revela se há algum gato inimigo nas casas adjacentes." },
  { id: 6, name: "Decoherence (Decoerência)", desc: "Colapso térmico! O oponente sofre interferência e perde a tentativa de medição neste turno." }
];

io.on('connection', (socket) => {
  socket.on('createRoom', (roomCode) => {
    if (rooms[roomCode]) return socket.emit('errorMsg', 'Esta sala já existe.');
    rooms[roomCode] = { players: {}, gameState: { boardSize: 5, positions: {}, turn: null, activeCard: null } };
    joinRoom(socket, roomCode);
  });

  socket.on('joinRoom', (roomCode) => {
    if (!rooms[roomCode]) return socket.emit('errorMsg', 'Sala não encontrada.');
    if (Object.keys(rooms[roomCode].players).length >= 2) return socket.emit('errorMsg', 'Sala cheia.');
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
      io.to(roomCode).emit('status', 'Ambos conectados! Posicionem seus gatos no tabuleiro.');
    } else {
      socket.emit('status', 'Aguardando o segundo jogador entrar na sala...');
    }
  }

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
      socket.emit('status', 'Posições salvas! Aguardando o oponente...');
    }
  });

  socket.on('rollQuantumDice', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    const diceRoll = Math.floor(Math.random() * 6) + 1;
    const drawnCard = quantumCards[diceRoll - 1];
    room.gameState.activeCard = drawnCard;

    socket.emit('diceResult', { diceRoll, card: drawnCard });
    io.to(room.roomCode).emit('status', `Jogador ${room.players[socket.id].number} rolou o dado (🎲 ${diceRoll}) -> [${drawnCard.name}]`);
  });

  socket.on('makeMove', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    room.gameState.positions[socket.id].live = data.newLive;
    room.gameState.positions[socket.id].dead = data.newDead;
  });

  socket.on('observe', (data) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState.turn !== socket.id) return;

    const opponentId = Object.keys(room.players).find(id => id !== socket.id);
    const opponentPos = room.gameState.positions[opponentId];

    // Verifica se a carta ativa é a 6 (Decoerência)
    if (room.gameState.activeCard && room.gameState.activeCard.id === 6) {
      socket.emit('decoherenceHit', 'Decoerência Térmica! A sua medição sofreu interferência e foi anulada neste turno.');
      room.gameState.turn = opponentId;
      room.gameState.activeCard = null;
      io.to(socket.roomCode).emit('turnChanged', { nextTurn: room.gameState.turn });
      return;
    }

    const hitLive = (data.targetLive.x === opponentPos.live.x && data.targetLive.y === opponentPos.live.y);
    const hitDead = (data.targetDead.x === opponentPos.dead.x && data.targetDead.y === opponentPos.dead.y);

    // Vitória total apenas se encontrar ambos os gatos
    if (hitLive && hitDead) {
      io.to(socket.roomCode).emit('gameOver', { winner: room.players[socket.id].number, type: 'BOTH' });
    } else {
      // Caso contrário, informa o resultado e o jogo CONTINUA normalmente
      socket.emit('observeResult', { hitLive, hitDead, targetLive: data.targetLive, targetDead: data.targetDead });
      
      room.gameState.turn = opponentId;
      room.gameState.activeCard = null;
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
