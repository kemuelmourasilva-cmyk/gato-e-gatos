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

let players = {};
let gameState = {
  boardSize: 5, // Tabuleiro 5x5 por padrão
  positions: {}, // { socketId: { live: {x,y}, dead: {x,y}, ready: bool } }
  turn: null
};

io.on('connection', (socket) => {
  console.log(`Jogador conectado: ${socket.id}`);

  if (Object.keys(players).length < 2) {
    const playerNumber = Object.keys(players).length === 0 ? 1 : 2;
    players[socket.id] = { id: socket.id, number: playerNumber, ready: false };
    socket.emit('init', { playerNumber, boardSize: gameState.boardSize });
    
    if (Object.keys(players).length === 2) {
      io.emit('status', 'Aguardando ambos os jogadores posicionarem os gatos...');
    } else {
      socket.emit('status', 'Aguardando o Jogador 2 entrar...');
    }
  } else {
    socket.emit('errorMsg', 'A sala já está cheia (máximo 2 jogadores).');
    return;
  }

  // Define a posição inicial secreta dos gatos
  socket.on('setInitialPositions', (data) => {
    gameState.positions[socket.id] = {
      live: data.live,
      dead: data.dead
    };
    players[socket.id].ready = true;

    const allReady = Object.values(players).every(p => p.ready);
    if (allReady && Object.keys(players).length === 2) {
      const p1Socket = Object.keys(players)[0];
      gameState.turn = p1Socket;
      io.emit('gameStart', { activeTurn: gameState.turn });
    } else {
      socket.emit('status', 'Posições salvas! Aguardando o oponente posicionar...');
    }
  });

  // Movimento Espelho / Emaranhado
  socket.on('makeMove', (data) => {
    if (gameState.turn !== socket.id) return;

    // Atualiza a posição do jogador atual
    gameState.positions[socket.id].live = data.newLive;
    gameState.positions[socket.id].dead = data.newDead;

    // Alterna o turno
    const playerIds = Object.keys(players);
    gameState.turn = playerIds.find(id => id !== socket.id);

    io.emit('updateBoard', {
      lastPlayer: socket.id,
      nextTurn: gameState.turn
    });
  });

  // Ação de Observar / Adivinhar (Estilo Batalha Naval)
  socket.on('observe', (data) => {
    if (gameState.turn !== socket.id) return;

    const opponentId = Object.keys(players).find(id => id !== socket.id);
    const opponentPos = gameState.positions[opponentId];

    const hitLive = (data.targetLive.x === opponentPos.live.x && data.targetLive.y === opponentPos.live.y);
    const hitDead = (data.targetDead.x === opponentPos.dead.x && data.targetDead.y === opponentPos.dead.y);

    if (hitLive && hitDead) {
      io.emit('gameOver', { winner: players[socket.id].number });
    } else {
      // Alterna turno após tentativa falha
      gameState.turn = opponentId;
      socket.emit('observeResult', { hitLive, hitDead, success: false });
      io.emit('turnChanged', { nextTurn: gameState.turn });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Jogador desconectado: ${socket.id}`);
    delete players[socket.id];
    delete gameState.positions[socket.id];
    io.emit('playerLeft', 'O outro jogador se desconectou.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
