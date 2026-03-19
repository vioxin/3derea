const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.get('/ping', (req, res) => res.send('Awake!')); // GAS用

// ゲームの状態を保存する箱
const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ① ルーム作成
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4桁の部屋番号
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: null, p1Hp: 10, p2Hp: 10, p1Card: null, p2Card: null, isCpu: false };
    socket.emit('roomCreated', roomId);
  });

  // ② ルーム参加
  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].p2) {
      socket.join(roomId);
      rooms[roomId].p2 = socket.id;
      io.to(roomId).emit('gameStart', '対人戦が始まりました！');
    } else {
      socket.emit('errorMsg', '部屋がないか、満室です');
    }
  });

  // ③ CPU戦の開始
  socket.on('playCPU', () => {
    const roomId = 'CPU_' + socket.id;
    socket.join(roomId);
    rooms[roomId] = { p1: socket.id, p2: 'CPU', p1Hp: 10, p2Hp: 10, p1Card: null, p2Card: null, isCpu: true };
    socket.emit('gameStart', 'CPU戦が始まりました！');
  });

  // ④ カードを出す処理
  socket.on('playCard', ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (socket.id === room.p1) room.p1Card = card;
    if (socket.id === room.p2) room.p2Card = card;

    // CPU戦の場合、CPUのカードを自動で決める
    if (room.isCpu && socket.id === room.p1) {
      const cpuCards = [0, 1, 2, 3, 4];
      room.p2Card = cpuCards[Math.floor(Math.random() * cpuCards.length)];
    }

    // 両者がカードを出したら勝敗判定！
    if (room.p1Card !== null && room.p2Card !== null) {
      resolveTurn(roomId);
    }
  });

  // ⑤ ターン結果の計算
  function resolveTurn(roomId) {
    const room = rooms[roomId];
    let msg = '';
    let p1Dmg = 0; let p2Dmg = 0;
    const c1 = room.p1Card; const c2 = room.p2Card;

    if (c1 === 0 && c2 > 0) { p2Dmg = c2; msg = 'P1のカウンター発動！'; }
    else if (c2 === 0 && c1 > 0) { p1Dmg = c1; msg = 'P2のカウンター発動！'; }
    else if (c1 > c2) { p2Dmg = c1; msg = 'P1の攻撃成功！'; }
    else if (c2 > c1) { p1Dmg = c2; msg = 'P2の攻撃成功！'; }
    else { msg = '引き分け！'; }

    room.p1Hp -= p1Dmg;
    room.p2Hp -= p2Dmg;

    // 結果をクライアントに送信
    io.to(roomId).emit('turnResult', {
      p1Card: c1, p2Card: c2, p1Hp: room.p1Hp, p2Hp: room.p2Hp, message: msg
    });

    // 終了判定
    if (room.p1Hp <= 0 || room.p2Hp <= 0) {
      let winner = room.p1Hp > 0 ? 'P1' : (room.p2Hp > 0 ? 'P2' : 'Draw');
      io.to(roomId).emit('gameOver', winner);
      delete rooms[roomId]; // 部屋を消す
    } else {
      // 次のターンのためにカードをリセット
      room.p1Card = null; room.p2Card = null;
    }
  }
});
